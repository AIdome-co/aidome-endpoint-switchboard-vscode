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
import * as fs from 'node:fs';

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
/** The quote characters dotenv accepts around values. */
const DOTENV_QUOTES = `"'` + '`';

export function parseDotEnv(
  content: string | undefined,
  options: EnvFileDriverOptions = {}
): Record<string, string> {
  const fileLabel = options.fileLabel ?? 'env file';
  const output: Record<string, string> = {};
  if (content === undefined || content.trim().length === 0) {
    return output;
  }

  // dotenv-compatible semantics (Codex PR 159 round 17): Gemini loads the
  // file through dotenv.parse (upstream settings.ts:645-650), which accepts
  // `KEY: value` (colon separators), MULTILINE quoted values, and silently
  // skips lines it cannot parse — so a file Gemini considers valid must not
  // make profile application fail here.
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    // Earliest separator wins (dotenv's KEY[:=] pattern). A separator inside
    // a quoted value comes after the assignment, so this is safe.
    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    const separator = eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon);
    if (separator <= 0) {
      // dotenv.parse skips lines without a separator — mirror that instead
      // of failing: such a line cannot carry a managed key anyway.
      continue;
    }
    const key = stripExportPrefix(line.slice(0, separator).trim());
    let value = line.slice(separator + 1).trim();
    // dotenv accepts THREE quote forms — double, single, and backtick — and
    // single-quoted values are LITERAL (no \n expansion). Multiline applies
    // to any form whose opening quote is unclosed on the line (Codex PR 159
    // round 19; dotenv v16.4.5 lib/main.js).
    const quote = value.length > 0 && DOTENV_QUOTES.includes(value[0]) ? value[0] : undefined;
    if (quote !== undefined && !hasClosingQuote(value, quote)) {
      // MULTILINE only when a closing quote actually EXISTS later in the file
      // (Codex PR 159 round 20): dotenv treats an UNMATCHED opening quote as
      // a single-line unquoted value, not as consuming the rest of the file.
      const closing = lines.findIndex(
        (l, i) => i > index && hasClosingQuote(l.trim(), quote)
      );
      if (closing > index) {
        // MULTILINE quoted value: consume continuation lines until the closing
        // quote (dotenv's multiline mode), joining with newlines.
        const builder: string[] = [value];
        for (let k = index + 1; k <= closing; k++) {
          builder.push(lines[k]);
        }
        const joined = builder.join('\n').trim();
        value = joined.startsWith(quote) && joined.endsWith(quote) && joined.length >= 2
          ? joined.slice(1, -1)
          : joined;
        index = closing;
      }
    } else if (quote !== undefined && value.endsWith(quote) && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (quote === '"' && value.includes('\\')) {
      // dotenv EXPANDS \n and \r escape sequences inside double quotes
      // (v16.4.5 lib/main.js:29-38) — mirror that so round-trip checks in
      // tests use the same bytes Gemini will receive.
      value = value.replace(/\\r\\n|\\r|\\n/g, m => (m === '\\r\\n' ? '\n' : m === '\\n' ? '\n' : '\r'));
    }
    if (key.length === 0 || key === 'export') {
      throw new Error(`${fileLabel} has an empty variable name at line ${index + 1}.`);
    }
    output[key] = value;
  }
  return output;
}

/** True when the trimmed value contains an unescaped closing quote. */
function hasClosingQuote(value: string, quote: string): boolean {
  const escaped = value.slice(1).replace(/\\./g, '');
  return escaped.includes(quote);
}

/** Matches an assignment line and returns its unexported key, or null. */
function assignmentKeyOf(rawLine: string): string | null {
  const trimmed = rawLine.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) {
    return null;
  }
  // dotenv accepts both `KEY=value` and `KEY: value` — a managed key defined
  // with a colon separator must still be replaced in place, not appended
  // twice (dotenv.parse is last-wins, but in-place is truthful).
  const eq = trimmed.indexOf('=');
  const colon = trimmed.indexOf(':');
  const separator = eq === -1 ? colon : colon === -1 ? eq : Math.min(eq, colon);
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

  // First pass: collect, per managed key, the indices of ALL its LOGICAL
  // assignment starts. Continuation lines of a MULTILINE quoted value are
  // NOT independent assignments (Codex PR 159 round 18): a `GEMINI_API_KEY=`
  // inside an unrelated quoted multiline value must never be treated as a
  // managed line, and updating a multiline managed value must replace the
  // WHOLE span.
  const spanEnd = new Map<number, number>();
  {
    let i = 0;
    while (i < rawLines.length) {
      const line = rawLines[i].trim();
      const valueStart = line.indexOf('=') === -1
        ? line.indexOf(':')
        : line.indexOf(':') !== -1
          ? Math.min(line.indexOf('='), line.indexOf(':'))
          : line.indexOf('=');
      let value = valueStart > 0 ? line.slice(valueStart + 1).trim() : '';
      // All three dotenv quote forms open multiline spans (round 19).
      const openQuote = value.length > 0 && DOTENV_QUOTES.includes(value[0]) ? value[0] : undefined;
      if (openQuote !== undefined && !hasClosingQuote(value, openQuote)) {
        // MULTILINE open: consume continuation lines until the FIRST line
        // whose content contains the closing quote. The opening line itself
        // must NOT be re-checked — its raw text contains the opening quote
        // (Codex PR 159 round 18, follow-up to the missed-continuation fix).
        // An UNMATCHED opening quote forms NO span (round 20): dotenv treats
        // it as a single-line unquoted value, so following managed lines
        // must stay reconcilable.
        const closingLine = rawLines.findIndex(
          (l, j) => j > i && hasClosingQuote(l.trim(), openQuote)
        );
        if (closingLine > i) {
          const end = closingLine;
          spanEnd.set(i, end);
          i = end + 1;
          continue;
        }
        i++;
        continue;
      }
      i++;
    }
  }
  const occurrences = new Map<string, number[]>();
  rawLines.forEach((rawLine, index) => {
    // Continuation lines of a multiline span are not assignment starts.
    let isContinuation = false;
    for (const [start, end] of spanEnd) {
      if (index > start && index <= end) {
        isContinuation = true;
        break;
      }
    }
    if (isContinuation) {
      return;
    }
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

  // Second pass: replace the LAST logical occurrence of an updated key with
  // the new value (a single line — serializeDotEnvValue escapes newlines),
  // remove every other occurrence (updates and removals alike). Unrelated
  // spans are preserved byte-identically.
  const spanOf = new Map<number, number>(); // line index -> span start (ALL spans)
  for (const [start, end] of spanEnd) {
    for (let k = start; k <= end; k++) {
      spanOf.set(k, start);
    }
  }
  const outputLines: string[] = [];
  rawLines.forEach((rawLine, index) => {
    const spanStart = spanOf.get(index);
    if (spanStart !== undefined) {
      const spanKey = assignmentKeyOf(rawLines[spanStart]);
      const managedSpan = spanKey !== null && managedKeys.has(spanKey);
      if (!managedSpan) {
        // Unrelated multiline span: preserve byte-identically, emit raw only
        // on the START line so continuations are not re-emitted.
        if (index === spanStart) {
          for (let k = spanStart; k <= (spanEnd.get(spanStart) as number); k++) {
            outputLines.push(rawLines[k]);
          }
        }
        return;
      }
      if (index !== spanStart) {
        return; // continuation of a managed multiline span: replaced
      }
      const key = spanKey as string;
      if (removeKeys.has(key)) {
        return;
      }
      const list = occurrences.get(key);
      if (list && list[list.length - 1] === index) {
        outputLines.push(`${key}=${serializeDotEnvValue(vars[key])}`);
      }
      return;
    }
    // Ordinary assignment or unrelated line.
    const key = assignmentKeyOf(rawLine);
    if (key !== null && managedKeys.has(key)) {
      if (removeKeys.has(key)) {
        return;
      }
      const list = occurrences.get(key);
      if (list && list[list.length - 1] === index) {
        outputLines.push(`${key}=${serializeDotEnvValue(vars[key])}`);
      }
      return;
    }
    // Unrelated line — preserved byte-identically.
    outputLines.push(rawLine);
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
  // SINGLE-quoted dotenv values are LITERAL: no \n/\r expansion, no escape
  // processing — dotenv only strips the first and last quote (v16.4.5
  // lib/main.js). That holds even with EMBEDDED single quotes (an embedded
  // ' does not end the form: the value still starts and ends with one, so
  // slice(1,-1) reconstructs the exact bytes), which makes single-quoting
  // the round-trip-exact representation for EVERY unsafe value — including
  // literal backslash-n sequences that a double-quoted form would wrongly
  // expand into newlines (Codex PR 159 rounds 19-20). The double-quoted
  // escape form cannot represent a literal backslash-n at all, so it is
  // never used.
  return `'${value}'`;
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
    // The backup contains the OLD credential: createBackup preserves the
    // source mode, so a legacy 0644 file would leave a world-readable secret
    // copy even though the patched file itself is narrowed to 0600 — narrow
    // the backup to owner-only as well (Codex PR 159 round 16).
    await fs.promises.chmod(backupPath, 0o600);
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
