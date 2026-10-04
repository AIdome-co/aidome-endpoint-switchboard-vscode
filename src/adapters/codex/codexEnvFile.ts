/**
 * Codex `.env` credential persistence.
 *
 * Codex upstream (`codex-rs/arg0/src/lib.rs`, `load_dotenv`) loads
 * `<codex_home>/.env` at every startup and injects the variables into the
 * process environment — this is the upstream-supported on-disk location for
 * provider credentials (`env_key = "OPENAI_API_KEY"` in config.toml points at
 * it). Only variables prefixed `CODEX_` are filtered out; OPENAI_API_KEY is
 * honored.
 *
 * This makes Codex's auth automation the exact parallel of Claude Code's
 * settings.json contract: the secret is persisted at apply time
 * (`target-persisted-at-apply`), never in config.toml.
 */

import { createBackup, readFileSafe, writeFileAtomic } from '../../util/fsSafe';

/** Parses a .env file into key/value records. */
export function parseDotEnv(content: string | undefined): Record<string, string> {
  const output: Record<string, string> = {};
  if (content === undefined || content.trim().length === 0) {
    return output;
  }

  for (const [index, rawLine] of content.split('\n').entries()) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    // Fail closed on malformed lines: a corrupted .env would otherwise be
    // silently rewritten and Codex credentials could be lost.
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(
        `Codex .env file is malformed at line ${index + 1}: "${line}". ` +
        'Fix or remove ~/.codex/.env manually, then retry — the original file was left untouched.'
      );
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length === 0) {
      throw new Error(`Codex .env file has an empty variable name at line ${index + 1}.`);
    }
    output[key] = value;
  }
  return output;
}

/**
 * Builds the merged .env content: managed variables are updated, unrelated
 * variables and comments are preserved.
 */
export function buildDotEnvContent(
  existingContent: string | undefined,
  vars: Record<string, string>
): string {
  const existing = parseDotEnv(existingContent);
  const merged: Record<string, string> = { ...existing, ...vars };

  // Preserve comment lines from the original file where the library contract
  // allows; keys are re-emitted sorted for deterministic idempotent output.
  const comments = (existingContent ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('#'));

  const lines = [
    ...comments,
    ...Object.keys(merged).sort().map(key => `${key}=${merged[key]}`)
  ];
  return `${lines.join('\n')}\n`;
}

/**
 * Patches the Codex .env file with the managed variables.
 * Backup-before-modify, atomic write, unrelated variables preserved.
 *
 * @returns The backup path, or undefined when the file did not exist.
 */
export async function patchCodexEnvFile(
  envFilePath: string,
  vars: Record<string, string>
): Promise<string | undefined> {
  const existingContent = await readFileSafe(envFilePath);
  // Fail closed on malformed input before any mutation.
  parseDotEnv(existingContent);

  let backupPath: string | undefined;
  if (existingContent !== undefined) {
    backupPath = await createBackup(envFilePath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${envFilePath}`);
    }
  }

  const updated = buildDotEnvContent(existingContent, vars);
  const success = await writeFileAtomic(envFilePath, updated);
  if (!success) {
    throw new Error(`Failed to write Codex .env file to ${envFilePath}`);
  }
  return backupPath;
}

/** Reads a managed variable value from the Codex .env file. */
export async function readCodexEnvValue(
  envFilePath: string,
  key: string
): Promise<string | undefined> {
  const content = await readFileSafe(envFilePath);
  return parseDotEnv(content)[key];
}
