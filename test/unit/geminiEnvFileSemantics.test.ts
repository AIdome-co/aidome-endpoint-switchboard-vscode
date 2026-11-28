/**
 * Gemini CLI env-file writer semantics (PR 159 review regressions).
 *
 * - `export KEY=value` and `KEY=value` are assignments to the SAME key
 *   (Gemini CLI loads its .env with dotenv): a stale `export GEMINI_API_KEY`
 *   line must be replaced/removed like any other assignment.
 * - Unrelated lines are preserved BYTE-IDENTICALLY — no reserialization.
 * - Duplicate managed-key occurrences reconcile to the LAST (effective)
 *   assignment; clear-not-replay removes every occurrence.
 * - Credential file permissions: narrowed to 0600 (existing wider modes
 *   are narrowed, narrower ones never widened), new files 0600.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  parseDotEnv,
  buildDotEnvContent,
  patchEnvFile,
} from '../../src/core/providerConfig/envFileDriver';

describe('parseDotEnv export-prefix semantics', () => {
  it('treats `export KEY=` as an assignment to KEY', () => {
    const parsed = parseDotEnv('export GEMINI_API_KEY=old-token\nexport OTHER=a\nPLAIN=b\n');
    expect(parsed).toEqual({ GEMINI_API_KEY: 'old-token', OTHER: 'a', PLAIN: 'b' });
  });

  it('skips unparseable lines like dotenv.parse does', () => {
    // dotenv (upstream settings.ts:645-650) skips lines without a separator
    // instead of failing — a line Gemini tolerates cannot fail application.
    expect(parseDotEnv('GEMINI_API_KEY=ok\nexport broken-line\n')).toEqual({ GEMINI_API_KEY: 'ok' });
  });

  it('throws on an export statement without a variable name', () => {
    expect(() => parseDotEnv('export =oops\n')).toThrow('empty variable name');
  });
});

describe('buildDotEnvContent line-preserving semantics', () => {
  it('updates a managed key through its `export` form in place', () => {
    const out = buildDotEnvContent(
      '# user comment\nexport GEMINI_API_KEY=old\nUNRELATED="keep quoted"\n',
      { GEMINI_API_KEY: 'new' }
    );
    expect(out).toBe('# user comment\nGEMINI_API_KEY=new\nUNRELATED="keep quoted"\n');
    expect(parseDotEnv(out).GEMINI_API_KEY).toBe('new');
  });

  it('preserves unrelated lines byte-identically (quoting, order, comments, blanks)', () => {
    const original = '# header\n\nA_PLAIN=plain\n  SPACED = spaced  \nQ="quoted # value"\n';
    const out = buildDotEnvContent(original, { MANAGED: '1' });
    // MANAGED is appended; everything else untouched.
    expect(out).toBe(original + 'MANAGED=1\n');
  });

  it('reconciles duplicate managed-key occurrences to the last effective one', () => {
    const out = buildDotEnvContent(
      'GEMINI_API_KEY=first\nexport GEMINI_API_KEY=second\n',
      { GEMINI_API_KEY: 'new' }
    );
    // Last assignment wins under dotenv semantics; earlier duplicates dropped.
    expect(out).toBe('GEMINI_API_KEY=new\n');
    const occurrences = out.split('GEMINI_API_KEY').length - 1;
    expect(occurrences).toBe(1);
  });

  it('removeKeys removes every occurrence in both forms', () => {
    const out = buildDotEnvContent(
      'export GEMINI_API_KEY=a\nOTHER=keep\nGEMINI_API_KEY=b\n',
      {},
      { removeKeys: ['GEMINI_API_KEY'] }
    );
    expect(out).toBe('OTHER=keep\n');
  });

  it('is idempotent: reapplying the same vars is byte-identical', () => {
    const first = buildDotEnvContent('# c\nA=1\nexport B=2\n', { A: '1', B: '2' });
    const second = buildDotEnvContent(first, { A: '1', B: '2' });
    expect(second).toBe(first);
  });

  it('is deterministic when appending several new keys', () => {
    const first = buildDotEnvContent(undefined, { B: '2', A: '1' });
    const second = buildDotEnvContent(first, { B: '2', A: '1' });
    expect(second).toBe(first);
    expect(first).toBe('A=1\nB=2\n');
  });
});

describe('patchEnvFile credential-file permissions', () => {
  let tempDir: string;

  async function createWithMode(name: string, content: string, mode?: number): Promise<string> {
    const filePath = path.join(tempDir, name);
    await fs.writeFile(filePath, content, mode !== undefined ? { mode } : undefined);
    if (mode !== undefined) {
      await fs.chmod(filePath, mode);
    }
    return filePath;
  }

  async function fileMode(filePath: string): Promise<string> {
    return ((await fs.stat(filePath)).mode & 0o777).toString(8);
  }

  it.skipIf(process.platform === 'win32')('preserves an existing 0600 file through an update (no widening by atomic rename)', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-env-'));
    try {
      const envPath = await createWithMode('.env', 'export GEMINI_API_KEY=old\nOTHER=keep\n', 0o600);

      await patchEnvFile(envPath, { GEMINI_API_KEY: 'new' });

      const content = await fs.readFile(envPath, 'utf-8');
      expect(content).toContain('GEMINI_API_KEY=new');
      expect(content).toContain('OTHER=keep');
      expect(await fileMode(envPath)).toBe('600');
      // The backup keeps the original (private) mode too.
      const backupPath = (await fs.readdir(tempDir)).find(name => name.startsWith('.env.backup'));
      expect(backupPath).toBeDefined();
      expect(await fileMode(path.join(tempDir, backupPath as string))).toBe('600');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('narrows an existing 0644 credential file to 0600 (secret not left world-readable)', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-env-'));
    try {
      const envPath = await createWithMode('.env', 'KEEP=1\n', 0o644);

      await patchEnvFile(envPath, { NEW: '2' });

      // Credential-env writes narrow a wider existing mode down to 0600
      // (Codex PR 159 round 8): preserving 0644 would leave the secret
      // readable by other local users.
      expect(await fileMode(envPath)).toBe('600');
      expect(await fs.readFile(envPath, 'utf-8')).toContain('KEEP=1');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('never widens an already-narrower file (0400 stays 0400)', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-env-'));
    try {
      const envPath = await createWithMode('.env', 'KEEP=1\n', 0o400);

      await patchEnvFile(envPath, { NEW: '2' });

      expect(await fileMode(envPath)).toBe('400');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('creates a missing credential file with 0600', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-env-'));
    try {
      const envPath = path.join(tempDir, 'new.env');

      await patchEnvFile(envPath, { GEMINI_API_KEY: 'fresh' });

      expect(await fileMode(envPath)).toBe('600');
      expect(await fs.readFile(envPath, 'utf-8')).toBe('GEMINI_API_KEY=fresh\n');
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
