/**
 * Generic dotenv file driver.
 *
 * Provider-neutral capability for upstream-supported `.env` credential
 * targets: parse dotenv, fail closed on malformed existing content, preserve
 * unrelated variables and comments, update only the managed variables,
 * backup before mutation, atomic write, idempotent result.
 *
 * Extracted from the Codex adapter (GAP 1): generic orchestration must not
 * import provider modules; providers delegate to this generic driver
 * instead. The observable `.env` behavior is byte-for-byte the one Codex
 * shipped before the extraction.
 */

import { createBackup, readFileSafe, writeFileAtomic } from '../../util/fsSafe';

/** Options for the generic env-file driver. */
export interface EnvFileDriverOptions {
  /**
   * Human-facing file label used in fail-closed error messages
   * (e.g. "Codex .env file"). Defaults to "env file".
   */
  fileLabel?: string;
}

/** Parses a .env file into key/value records. */
export function parseDotEnv(
  content: string | undefined,
  options: EnvFileDriverOptions = {}
): Record<string, string> {
  const fileLabel = options.fileLabel ?? 'env file';
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
    // silently rewritten and provider credentials could be lost.
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new Error(
        `${fileLabel} is malformed at line ${index + 1}: "${line}". ` +
        'Fix or remove the file manually, then retry — the original file was left untouched.'
      );
    }
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length === 0) {
      throw new Error(`${fileLabel} has an empty variable name at line ${index + 1}.`);
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
  vars: Record<string, string>,
  options: EnvFileDriverOptions = {}
): string {
  const existing = parseDotEnv(existingContent, options);
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
 * Patches a dotenv file with the managed variables.
 * Backup-before-modify, atomic write, unrelated variables preserved.
 *
 * @returns The backup path, or undefined when the file did not exist.
 */
export async function patchEnvFile(
  envFilePath: string,
  vars: Record<string, string>,
  options: EnvFileDriverOptions = {}
): Promise<string | undefined> {
  const existingContent = await readFileSafe(envFilePath);
  // Fail closed on malformed input before any mutation.
  parseDotEnv(existingContent, options);

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
    throw new Error(`Failed to write ${options.fileLabel ?? 'env file'} to ${envFilePath}`);
  }
  return backupPath;
}

/** Reads a managed variable value from a dotenv file. */
export async function readEnvFileValue(
  envFilePath: string,
  key: string,
  options: EnvFileDriverOptions = {}
): Promise<string | undefined> {
  const content = await readFileSafe(envFilePath);
  return parseDotEnv(content, options)[key];
}
