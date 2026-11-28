/** Tests for Codex .env credential persistence. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsSafe from '../../src/util/fsSafe';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import {
  parseDotEnv,
  buildDotEnvContent,
  patchCodexEnvFile
} from '../../src/adapters/codex/codexEnvFile';

vi.mock('../../src/util/fsSafe');

describe('parseDotEnv', () => {
  it('parses KEY=VALUE lines, comments, blank lines, and quoted values', () => {
    const parsed = parseDotEnv('# comment\n\nOPENAI_API_KEY="secret value"\nOTHER=plain\n');
    expect(parsed).toEqual({ OPENAI_API_KEY: 'secret value', OTHER: 'plain' });
  });

  it('returns empty for missing or empty files', () => {
    expect(parseDotEnv(undefined)).toEqual({});
    expect(parseDotEnv('')).toEqual({});
  });

  it('parses with dotenv semantics: skips unparseable lines, rejects empty keys', () => {
    // dotenv.parse silently skips lines without a separator (Codex PR 159
    // round 17) — Gemini itself loads such files successfully, so a
    // no-separator line cannot fail profile application.
    expect(parseDotEnv('OPENAI_API_KEY=ok\nbroken-line-without-equals\n')).toEqual({ OPENAI_API_KEY: 'ok' });
    expect(parseDotEnv('=no-key\n')).toEqual({});
    expect(() => parseDotEnv('export =value\n')).toThrow('empty variable name');
    // Colon separator and multiline quoted values are valid dotenv syntax.
    expect(parseDotEnv('KEY: value\nOTHER="multi\nline"\n')).toEqual({ KEY: 'value', OTHER: 'multi\nline' });
  });
});

describe('buildDotEnvContent', () => {
  it('treats a quoted KEY= inside an unrelated multiline value as NON-assignment (round 18)', () => {
    const existing = 'NOTE="first line\nGEMINI_API_KEY=inside\nlast"\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toBe('first line\nGEMINI_API_KEY=inside\nlast');
    expect(parsed.GEMINI_API_KEY).toBe('real');
    // The unrelated multiline value's interior is byte-identical.
    expect(out).toContain('GEMINI_API_KEY=inside');
  });

  it('replaces a MULTILINE managed value with a single escaped line (round 18)', () => {
    const existing = 'GEMINI_API_KEY="old\nmultiline"\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'new-secret' });
    const parsed = parseDotEnv(out);
    expect(parsed.GEMINI_API_KEY).toBe('new-secret');
    expect(parsed.KEEP).toBe('yes');
    expect(out).not.toContain('old');
  });

  it('parses all three dotenv quote forms, multiline, with dotenv escape semantics (round 19)', () => {
    expect(parseDotEnv("A='single\nquoted'\nB=`tick\nline`\n")).toEqual({ A: 'single\nquoted', B: 'tick\nline' });
    // Single-quoted: literal — no \n expansion (file has backslash + n).
    expect(parseDotEnv(String.raw`C='lit\nkept'` + '\n')).toEqual({ C: 'lit\\nkept' });
    // Double-quoted: dotenv EXPANDS \n inside double quotes.
    expect(parseDotEnv(String.raw`D="exp\nanded"` + '\n')).toEqual({ D: 'exp\nanded' });
  });

  it('round-trips a literal backslash-n credential through serialize+parse (rounds 19-20)', () => {
    // A credential containing the literal two characters \ + n must survive:
    // single-quoted form is literal in dotenv (no \n expansion).
    const credential = 'abc\\ndef';
    const out = buildDotEnvContent(undefined, { GEMINI_API_KEY: credential });
    expect(parseDotEnv(out).GEMINI_API_KEY).toBe(credential);
    // Even with an embedded single quote the literal form round-trips.
    const tricky = "ab'c\\ndef";
    const outT = buildDotEnvContent(undefined, { GEMINI_API_KEY: tricky });
    expect(parseDotEnv(outT).GEMINI_API_KEY).toBe(tricky);
    // And a backtick/single-quote multiline interior is not an assignment.
    const existing = "NOTE=`first\nGEMINI_API_KEY=inside\nlast`\n";
    const out2 = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    expect(parseDotEnv(out2).NOTE).toBe('first\nGEMINI_API_KEY=inside\nlast');
    expect(parseDotEnv(out2).GEMINI_API_KEY).toBe('real');
  });

  it('detects a quote-ONLY multiline terminator line (round 21)', () => {
    // The closing quote as the FIRST character of its own line is a valid
    // terminator — hasClosingQuote must not discard it.
    const existing = 'NOTE="first\nGEMINI_API_KEY=inside\n"\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toBe('first\nGEMINI_API_KEY=inside\n');
    expect(parsed.GEMINI_API_KEY).toBe('real');
    expect(out).toContain('GEMINI_API_KEY=inside');
  });

  it('fails closed when a credential combines an apostrophe with # or a newline (round 21)', () => {
    // That combination has NO faithful dotenv representation — refuse
    // instead of silently writing bytes Gemini would receive differently.
    expect(() => buildDotEnvContent(undefined, { GEMINI_API_KEY: "ab'c#d" })).toThrow('cannot be represented faithfully');
    expect(() => buildDotEnvContent(undefined, { GEMINI_API_KEY: "ab'c\nd" })).toThrow('cannot be represented faithfully');
    // Apostrophe WITHOUT #/newline still round-trips literally.
    const ok = "ab'cd";
    const out = buildDotEnvContent(undefined, { GEMINI_API_KEY: ok });
    expect(parseDotEnv(out).GEMINI_API_KEY).toBe(ok);
  });

  it('ignores ESCAPED quotes when finding multiline terminators (round 22)', () => {
    // `\"` inside a multiline double-quoted value is CONTENT (dotenv's quoted
    // alternatives consume escaped quotes), not a terminator.
    const existing = 'NOTE="first \\"quoted\nGEMINI_API_KEY=inside\nlast"\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toBe('first \\"quoted\nGEMINI_API_KEY=inside\nlast');
    expect(parsed.GEMINI_API_KEY).toBe('real');
    expect(out).toContain('GEMINI_API_KEY=inside');
  });

  it('consumes a quote after ANY backslash run as content (round 23, verified vs dotenv v16.4.5)', () => {
    // dotenv's quoted alternative is (?:\\"|[^"])* — the escape pair matches
    // from the BACKSLASH, so a quote immediately preceded by a backslash is
    // content even after two consecutive backslashes (no parity rule).
    const existing = 'NOTE="a\\\\\\"b\nGEMINI_API_KEY=inside\nlast"\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toBe('a\\\\\\"b\nGEMINI_API_KEY=inside\nlast');
    expect(parsed.GEMINI_API_KEY).toBe('real');
  });

  it('reconciles past a grammar-invalid junk line that only looks like a span opener (round 24)', () => {
    // `junk:"first` fails dotenv's assignment grammar (`:\s+?` requires
    // whitespace after the colon), so it is a junk line — the stale key
    // after it must still be cleared on a credential-less profile switch.
    const existing = 'junk:"first\nGEMINI_API_KEY=stale\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, {}, { removeKeys: ['GEMINI_API_KEY'] });
    const parsed = parseDotEnv(out);
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
    expect(parsed.KEEP).toBe('yes');
    expect(out).not.toContain('GEMINI_API_KEY');
  });

  it('lets the FINAL backslash-prefixed quote terminate via regex backtracking (round 24)', () => {
    // No later plain quote exists: the greedy escape-pair match backtracks,
    // the quote closes the value, and BOTH backslashes stay as content.
    const existing = 'NOTE="first\nGEMINI_API_KEY=inside\nlast\\\\"\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toBe('first\nGEMINI_API_KEY=inside\nlast\\\\');
    expect(parsed.GEMINI_API_KEY).toBe('real');
  });

  it('rejects a fallback terminator whose line has trailing non-comment text (round 25)', () => {
    // dotenv v16.4.5 cannot backtrack to a backslash-prefixed quote when
    // non-comment text follows it — the value stays unmatched, so the stale
    // key after the false-span candidate must stay reconcilable.
    const existing = 'NOTE="first\nGEMINI_API_KEY=stale\nlast\\\\"junk\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, {}, { removeKeys: ['GEMINI_API_KEY'] });
    const parsed = parseDotEnv(out);
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
    expect(parsed.KEEP).toBe('yes');
  });

  it('accepts an EARLIER fallback quote when a later one sits in a comment with junk (round 26)', () => {
    // Backtracking runs from the end backward: `last\"` leaves only a comment
    // after it (`# c \"junk`), so IT is the terminator even though the last
    // quote on the line has an invalid `junk` suffix.
    const existing = 'NOTE="first\nGEMINI_API_KEY=inside\nlast\\\\" # c \\"junk\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    // The multiline value survives with its interior intact (the terminator
    // quote is stripped, dotenv-style) and the managed credential is written
    // separately — structural assertions avoid escape drift.
    expect(parsed.NOTE).toContain('GEMINI_API_KEY=inside');
    expect(parsed.NOTE).toContain('# c');
    expect(parsed.GEMINI_API_KEY).toBe('real');
  });

  it('scans fallback candidates across ALL lines, not just the last (round 27)', () => {
    // An earlier line can close via backtracking (`last\\" # comment`) while
    // a later line holds an INVALID candidate (`foo\\"junk`). The span must
    // close on the earlier line, preserving the interior, and the later
    // assignment stays independent.
    const existing = 'NOTE="first\nGEMINI_API_KEY=inside\nlast\\\\" # comment\nNEXT=foo\\\\"junk\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, { GEMINI_API_KEY: 'real' });
    const parsed = parseDotEnv(out);
    expect(parsed.NOTE).toContain('GEMINI_API_KEY=inside');
    expect(parsed.NEXT).toBe(String.raw`foo\\"junk`);
    expect(parsed.KEEP).toBe('yes');
    expect(parsed.GEMINI_API_KEY).toBe('real');
  });

  it('treats an UNMATCHED opening quote as a single-line value, not a file-consuming span (round 20)', () => {
    // dotenv treats an unmatched quote as an unquoted single-line value, so
    // the following stale managed key must still be reconcilable.
    const existing = 'NOTE="unmatched\nGEMINI_API_KEY=stale\nKEEP=yes\n';
    const out = buildDotEnvContent(existing, {}, { removeKeys: ['GEMINI_API_KEY'] });
    const parsed = parseDotEnv(out);
    expect(parsed.GEMINI_API_KEY).toBeUndefined();
    expect(parsed.KEEP).toBe('yes');
    expect(out).not.toContain('GEMINI_API_KEY');
  });

  it('updates managed variables and preserves unrelated ones', () => {
    const out = buildDotEnvContent('KEEP_ME=yes\nOPENAI_API_KEY=old\n# note\n', { OPENAI_API_KEY: 'new' });
    const parsed = parseDotEnv(out);
    expect(parsed.KEEP_ME).toBe('yes');
    expect(parsed.OPENAI_API_KEY).toBe('new');
    expect(out).toContain('# note');
  });

  it('is deterministic (sorted keys) for idempotent reapply', () => {
    const first = buildDotEnvContent(undefined, { B: '2', A: '1' });
    const second = buildDotEnvContent(first, { B: '2', A: '1' });
    expect(second).toBe(first);
  });
});

describe('patchCodexEnvFile (backup-before-modify, atomic write)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);
  });

  it('backs up an existing file before writing and preserves unrelated vars', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('KEEP=me\nOPENAI_API_KEY=old\n');
    // A REAL temp file: the driver narrows the credential-bearing backup to
    // 0600 with a real chmod (Codex PR 159 round 16).
    const backupTarget = nodePath.join(os.tmpdir(), `codex-env-backup-${Date.now()}`);
    await fs.promises.writeFile(backupTarget, 'stale');
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(backupTarget);

    const backup = await patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'new-secret' });

    expect(backup).toBe(backupTarget);
    // POSIX only: Windows (NTFS) fakes permission bits, so the narrowed
    // backup cannot be asserted there.
    if (process.platform !== 'win32') {
      expect((await fs.promises.stat(backupTarget)).mode & 0o777).toBe(0o600);
    }
    expect(fsSafe.createBackup).toHaveBeenCalledWith('/tmp/codex/.env');
    const written = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
    expect(written).toContain('OPENAI_API_KEY=new-secret');
    expect(written).toContain('KEEP=me');
    expect(written).not.toContain('old');
  });

  it('creates a new file without backup when none exists', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);

    const backup = await patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'new-secret' });

    expect(backup).toBeUndefined();
    expect(fsSafe.createBackup).not.toHaveBeenCalled();
    const written = (fsSafe.writeFileAtomic as any).mock.calls[0][1];
    expect(written).toBe('OPENAI_API_KEY=new-secret\n');
  });

  it('does not write when the existing file has an empty variable name (undecodable)', async () => {
    // Lines without a separator are valid-to-skip (dotenv semantics), but an
    // assignment with an EMPTY key cannot be classified — fail before any
    // mutation.
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('export =value\n');

    await expect(patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'x' }))
      .rejects.toThrow('empty variable name');
    expect(fsSafe.createBackup).not.toHaveBeenCalled();
    expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('throws when the backup cannot be created', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('A=1\n');
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue(undefined);

    await expect(patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'x' }))
      .rejects.toThrow('Failed to create backup');
    expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
  });
});
