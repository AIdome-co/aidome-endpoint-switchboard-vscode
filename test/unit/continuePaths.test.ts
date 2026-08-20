/**
 * Unit tests for src/adapters/continue/paths.ts
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import * as path from 'path';

const { mockExistsSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(() => false)
}));

vi.mock('fs', () => ({
  existsSync: mockExistsSync
}));

vi.mock('os', () => ({
  homedir: () => '/home/testuser'
}));

import {
  getContinueConfigDir,
  getContinueConfigJsonPath,
  getContinueConfigPath,
  getContinueConfigYamlPath,
  getContinueBackupDir
} from '../../src/adapters/continue/paths';

beforeEach(() => {
  mockExistsSync.mockReturnValue(false);
});

describe('continue/paths', () => {
  describe('getContinueConfigDir', () => {
    it('returns path under home directory', () => {
      const dir = getContinueConfigDir();
      expect(dir).toBe(path.join('/home/testuser', '.continue'));
    });
  });

  describe('getContinueConfigPath', () => {
    it('prefers an existing YAML config', () => {
      mockExistsSync.mockImplementation(filePath => filePath.endsWith('config.yaml'));

      expect(getContinueConfigPath()).toBe(getContinueConfigYamlPath());
    });

    it('uses an existing JSON config when YAML is absent', () => {
      mockExistsSync.mockImplementation(filePath => filePath.endsWith('config.json'));

      expect(getContinueConfigPath()).toBe(getContinueConfigJsonPath());
    });

    it('defaults new installations to YAML', () => {
      const configPath = getContinueConfigPath();
      expect(configPath).toBe(path.join('/home/testuser', '.continue', 'config.yaml'));
    });
  });

  describe('getContinueBackupDir', () => {
    it('returns backups directory inside config dir', () => {
      const backupDir = getContinueBackupDir();
      expect(backupDir).toBe(path.join('/home/testuser', '.continue', 'backups'));
    });
  });
});
