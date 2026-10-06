/** Tests for Codex .env credential persistence. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fsSafe from '../../src/util/fsSafe';
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

  it('fails closed on malformed lines', () => {
    expect(() => parseDotEnv('OPENAI_API_KEY=ok\nbroken-line-without-equals\n'))
      .toThrow('malformed');
    expect(() => parseDotEnv('=no-key\n')).toThrow('malformed');
  });
});

describe('buildDotEnvContent', () => {
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
    vi.spyOn(fsSafe, 'createBackup').mockResolvedValue('/backup/path');

    const backup = await patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'new-secret' });

    expect(backup).toBe('/backup/path');
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

  it('fails closed BEFORE any backup/write on a malformed existing file', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('broken line\n');

    await expect(patchCodexEnvFile('/tmp/codex/.env', { OPENAI_API_KEY: 'x' }))
      .rejects.toThrow('malformed');
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
