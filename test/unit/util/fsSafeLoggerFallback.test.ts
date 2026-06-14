/**
 * Proves fsSafe wrappers still return their safe fallback values
 * (undefined / false) when the Logger cannot be resolved — i.e. the
 * dynamic import('./log') or Logger.getInstance() throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// Make the Logger import always throw so getLogger() exercises its catch path.
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
  let testDir: string;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `fssafe-nolog-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch { /* cleanup */ }
  });

  it('readFileSafe returns undefined for a permission error without rejecting', async () => {
    const filePath = path.join(testDir, 'no-read.txt');
    await fs.writeFile(filePath, 'secret', 'utf-8');
    await fs.chmod(filePath, 0o000);

    const result = await readFileSafe(filePath);

    expect(result).toBeUndefined();
    // Restore permission so afterEach cleanup works
    await fs.chmod(filePath, 0o644);
  });

  it('createBackup returns undefined for non-existent file without rejecting', async () => {
    const result = await createBackup(path.join(testDir, 'missing.txt'));
    expect(result).toBeUndefined();
  });

  it('ensureDir returns false for invalid path without rejecting', async () => {
    // Null byte in path is invalid on all OSes
    const result = await ensureDir('/dev/null/impossible');
    expect(result).toBe(false);
  });

  it('safeCopyFile returns false for non-existent source without rejecting', async () => {
    const result = await safeCopyFile(
      path.join(testDir, 'gone.txt'),
      path.join(testDir, 'dest.txt')
    );
    expect(result).toBe(false);
  });

  it('safeWriteFile returns false for unwritable path without rejecting', async () => {
    const result = await safeWriteFile('/dev/null/impossible/file.txt', 'x');
    expect(result).toBe(false);
  });

  it('writeFileAtomic returns false for unwritable path without rejecting', async () => {
    const result = await writeFileAtomic('/dev/null/impossible/file.txt', 'x');
    expect(result).toBe(false);
  });
});
