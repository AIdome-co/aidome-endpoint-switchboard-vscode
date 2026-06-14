/**
 * Proves fsSafe wrappers still return their safe fallback values
 * (undefined / false) when the Logger cannot be resolved — i.e. the
 * dynamic import('./log') or Logger.getInstance() throws.
 *
 * The FS layer is mocked so tests are fully cross-platform.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- hoisted mocks ----------
const { fsMocks } = vi.hoisted(() => ({
  fsMocks: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
    realpath: vi.fn(),
  },
}));

vi.mock('fs/promises', () => fsMocks);

// Logger always throws — exercises getLogger() catch path.
vi.mock('../../../src/util/log', () => {
  throw new Error('Logger unavailable in test');
});

import {
  readFileSafe,
  createBackup,
  ensureDir,
  safeCopyFile,
  safeWriteFile,
  writeFileAtomic
} from '../../../src/util/fsSafe';

describe('fsSafe — logger unavailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: realpath passes through
    fsMocks.realpath.mockImplementation(async (p: string) => p);
    // Default: unlink succeeds (cleanup in writeFileAtomic)
    fsMocks.unlink.mockResolvedValue(undefined);
  });

  it('readFileSafe returns undefined on EACCES without rejecting', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    fsMocks.readFile.mockRejectedValue(err);

    const result = await readFileSafe('/some/file.txt');

    expect(result).toBeUndefined();
  });

  it('createBackup returns undefined on EACCES without rejecting', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    fsMocks.copyFile.mockRejectedValue(err);

    const result = await createBackup('/some/protected.txt');

    expect(result).toBeUndefined();
  });

  it('ensureDir returns false on EACCES without rejecting', async () => {
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    fsMocks.mkdir.mockRejectedValue(err);

    const result = await ensureDir('/protected/dir');

    expect(result).toBe(false);
  });

  it('safeCopyFile returns false on ENOENT without rejecting', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    fsMocks.copyFile.mockRejectedValue(err);

    const result = await safeCopyFile('/a.txt', '/b.txt');

    expect(result).toBe(false);
  });

  it('safeWriteFile returns false on EACCES without rejecting', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    fsMocks.writeFile.mockRejectedValue(err);

    const result = await safeWriteFile('/protected/file.txt', 'x', 0);

    expect(result).toBe(false);
  });

  it('writeFileAtomic returns false on EACCES without rejecting', async () => {
    fsMocks.mkdir.mockResolvedValue(undefined);
    const err = Object.assign(new Error('EACCES'), { code: 'EACCES' });
    fsMocks.writeFile.mockRejectedValue(err);

    const result = await writeFileAtomic('/protected/file.txt', 'x', 0);

    expect(result).toBe(false);
  });
});
