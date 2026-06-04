/**
 * Unit tests for src/adapters/continue/paths.ts
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('os', () => ({
  homedir: () => '/home/testuser'
}));

import { getContinueConfigDir, getContinueConfigPath, getContinueBackupDir } from '../../src/adapters/continue/paths';

describe('continue/paths', () => {
  describe('getContinueConfigDir', () => {
    it('returns path under home directory', () => {
      const dir = getContinueConfigDir();
      expect(dir).toBe('/home/testuser/.continue');
    });
  });

  describe('getContinueConfigPath', () => {
    it('returns config.json inside config dir', () => {
      const configPath = getContinueConfigPath();
      expect(configPath).toBe('/home/testuser/.continue/config.json');
    });
  });

  describe('getContinueBackupDir', () => {
    it('returns backups directory inside config dir', () => {
      const backupDir = getContinueBackupDir();
      expect(backupDir).toBe('/home/testuser/.continue/backups');
    });
  });
});
