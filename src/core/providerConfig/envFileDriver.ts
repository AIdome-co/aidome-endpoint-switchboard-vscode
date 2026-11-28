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
 *
 * Gemini CLI round (PR 159) semantics honored here:
 * - `export KEY=value` and `KEY=value` are assignments to the SAME key
 *   (Gemini CLI loads the file with dotenv, which accepts the export
 *   prefix) — a stale `export GEMINI_API_KEY=...` line must be removed and
 *   replaced like any other assignment.
 * - Unrelated lines are preserved BYTE-IDENTICALLY (no reserialization,
 *   no reordering, no quote normalization) — the writer only touches the
 *   managed lines.
 * - Credential files are private: the write narrows an existing file's
 *   permissions to 0600 (never widens) and creates a missing one with 0600.
 */

import { createBackup, readFileSafe, writeFileAtomic } from '../../util/fsSafe';

/** Options for the generic env-file driver. */
export interface EnvFileDriverOptions {
  /**
   * Human-facing file label used in fail-closed error messages
   * (e.g. "Codex .env file"). Defaults to "env file".
   */
  fileLabel?: string;
  /**
   * Managed keys to REMOVE from the file. Unrelated variables and comments
   * are always preserved; removing a key that does not exist is a no-op.
   */
  removeKeys?: readonly string[];
}

/** Strips an optional `export ` prefix from a parsed dotenv key. */
function stripExportPrefix(key: string): string {
  return key.replace(/^export\s+/, '');
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
    const key = stripExportPrefix(line.slice(0, separator).trim());
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length === 0 || key === 'export') {
      throw new Error(`${fileLabel} has an empty variable name at line ${index + 1}.`);
    }
    output[key] = value;
  }
  return output;
}

/** Matches an assignment line and returns its unexported key, or null. */
function assignmentKeyOf(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null;
  }
  const separator = trimmed.indexOf('=');
  if (separator <= 0) {
    return null;
  }
  return stripExportPrefix(trimmed.slice(0, separator).trim());
}

/**
 * Builds the merged .env content with LINE-PRESERVING semantics: only the
 * managed assignment lines are touched; every unrelated line (comments,
 * blank lines, quoting, ordering) is emitted byte-identically.
 *
 * Managed-key reconciliation: when a key appears multiple times (in either
 * `KEY=` or `export KEY=` form), the LAST occurrence — the one dotenv's
 * obj[key]=value semantics make effective — is updated and earlier
 * duplicates are dropped, so switching profiles can never leave an older
 * duplicate effective. Keys absent from the file are appended (sorted for
 * deterministic output). Keys listed in removeKeys have every occurrence
 * removed.
 */
export function buildDotEnvContent(
  existingContent: string | undefined,
  vars: Record<string, string>,
  options: EnvFileDriverOptions = {}
): string {
  // Fail closed on malformed existing content BEFORE any line is produced.
  parseDotEnv(existingContent, options);

  const removeKeys = new Set(options.removeKeys ?? []);
  const managedKeys = new Set([...Object.keys(vars), ...removeKeys]);

  const rawLines = existingContent === undefined || existingContent.trim().length === 0
    ? []
    : existingContent.split('\n');
  // A trailing newline is structure, not a line: strip it before splitting,
  // so appended managed keys land BEFORE it (preserved byte-identically
  // through the join below).
  const hadTrailingNewline = rawLines.length > 0 && rawLines[rawLines.length - 1] === '';
  if (hadTrailingNewline) {
    rawLines.pop();
  }

  // First pass: collect, per managed key, the indices of ALL its assignment
  // lines (both `KEY=` and `export KEY=` forms).
  const occurrences = new Map<string, number[]>();
  rawLines.forEach((rawLine, index) => {
    const key = assignmentKeyOf(rawLine);
    if (key !== null && managedKeys.has(key)) {
      const list = occurrences.get(key);
      if (list) {
        list.push(index);
      } else {
        occurrences.set(key, [index]);
      }
    }
  });

  // Second pass: replace the LAST occurrence of an updated key with the new
  // value, remove every other occurrence (updates and removals alike).
  const outputLines: string[] = [];
  rawLines.forEach((rawLine, index) => {
    const key = assignmentKeyOf(rawLine);
    if (key === null || !managedKeys.has(key)) {
      // Unrelated line — preserved byte-identically.
      outputLines.push(rawLine);
      return;
    }
    if (removeKeys.has(key)) {
      return;
    }
    const list = occurrences.get(key);
    if (list && list[list.length - 1] === index) {
      outputLines.push(`${key}=${serializeDotEnvValue(vars[key])}`);
    }
  });

  // Append managed keys the file did not contain (deterministic order).
  const appended = Object.keys(vars)
    .filter(key => !occurrences.has(key))
    .sort();
  for (const key of appended) {
    outputLines.push(`${key}=${serializeDotEnvValue(vars[key])}`);
  }
  if (hadTrailingNewline && outputLines.length > 0) {
    outputLines.push('');
  }

  const result = outputLines.join('\n');
  return result.endsWith('\n') || result.length === 0 ? result : `${result}\n`;
}

/**
 * Serializes a value for a dotenv assignment (Codex PR 159 round 15):
 * dotenv.parse truncates unquoted values at a `#` inline comment, treats
 * quotes/newlines specially, and a literal newline creates ADDITIONAL
 * assignments. Values made only of dotenv-safe characters are emitted
 * verbatim; anything else is double-quoted with dotenv escape sequences so
 * the parsed value is byte-identical to the stored credential.
 */
function serializeDotEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]*$/.test(value)) {
    return value;
  }
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\r|\n/g, '\\n');
  return `"${escaped}"`;
}

/**
 * Patches a dotenv file with the managed variables.
 * - Backup-before-modify, atomic write, unrelated lines preserved
 * byte-identically. Credential files are PRIVATE: the write NARROWS an
 * existing file's permissions down to 0600 (never widens; a legacy 0644
 * credential file becomes 0600 so the freshly written secret is not
 * readable by other local users — Codex PR 159 round 8) and creates a
 * missing file with 0600.
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

  const updated = buildDotEnvContent(existingContent, vars, options);
  // `narrow` makes the credential write enforce owner-only permissions even
  // on a pre-existing file with a wider mode (0644): writeFileAtomic's
  // default preserves the existing mode, which would leave the new secret
  // world-readable (Codex PR 159 round 8).
  const success = await writeFileAtomic(envFilePath, updated, 1, { mode: 0o600, narrow: true });
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
