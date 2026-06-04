/**
 * Unit tests for src/adapters/continue/paths.ts
 */

import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';

vi.mock('os', () => ({
  homedir: () => '/home/testuser'
}));

import { getContinueConfigDir, getContinueConfigPath, getContinueBackupDir } from '../../src/adapters/continue/paths';

describe('continue/paths', () => {
  describe('getContinueConfigDir', () => {
    it('returns path under home directory', () => {
      const dir = getContinueConfigDir();
      expect(dir).toBe(path.join('/home/testuser', '.continue'));
    });
  });

  describe('getContinueConfigPath', () => {
    it('returns config.json inside config dir', () => {
      const configPath = getContinueConfigPath();
      expect(configPath).toBe(path.join('/home/testuser', '.continue', 'config.json'));
    });
  });

  describe('getContinueBackupDir', () => {
    it('returns backups directory inside config dir', () => {
      const backupDir = getContinueBackupDir();
      expect(backupDir).toBe(path.join('/home/testuser', '.continue', 'backups'));
    });
  });
});
