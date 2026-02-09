/**
 * Unit tests for fsSafe utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  readFileSafe,
  safeReadFile,
  writeFileAtomic,
  safeWriteFile,
  createBackup,
  ensureDir,
  fileExists,
  safeCopyFile,
  backupFile
} from '../../../src/util/fsSafe';

describe('fsSafe', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a unique test directory in temp
    testDir = path.join(os.tmpdir(), `fssafe-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('readFileSafe', () => {
    it('should read an existing file', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Hello, World!', 'utf-8');

      const content = await readFileSafe(filePath);
      expect(content).toBe('Hello, World!');
    });

    it('should return undefined for non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');
      const content = await readFileSafe(filePath);
      expect(content).toBeUndefined();
    });

    it('should handle UTF-8 content', async () => {
      const filePath = path.join(testDir, 'unicode.txt');
      const unicodeContent = 'Hello 世界 🌍';
      await fs.writeFile(filePath, unicodeContent, 'utf-8');

      const content = await readFileSafe(filePath);
      expect(content).toBe(unicodeContent);
    });
  });

  describe('safeReadFile', () => {
    it('should be an alias for readFileSafe', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'Test content', 'utf-8');

      const content = await safeReadFile(filePath);
      expect(content).toBe('Test content');
    });
  });

  describe('writeFileAtomic', () => {
    it('should write content to a file', async () => {
      const filePath = path.join(testDir, 'output.txt');
      const success = await writeFileAtomic(filePath, 'Test content');

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Test content');
    });

    it('should create parent directories', async () => {
      const filePath = path.join(testDir, 'nested', 'dir', 'file.txt');
      const success = await writeFileAtomic(filePath, 'Nested content');

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Nested content');
    });

    it('should handle unicode content', async () => {
      const filePath = path.join(testDir, 'unicode.txt');
      const unicodeContent = 'Hello 世界 🌍';
      const success = await writeFileAtomic(filePath, unicodeContent);

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe(unicodeContent);
    });
  });

  describe('safeWriteFile', () => {
    it('should write content to a file', async () => {
      const filePath = path.join(testDir, 'output.txt');
      const success = await safeWriteFile(filePath, 'Test content');

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Test content');
    });

    it('should create parent directories', async () => {
      const filePath = path.join(testDir, 'a', 'b', 'c', 'file.txt');
      const success = await safeWriteFile(filePath, 'Deep content');

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('Deep content');
    });

    it('should overwrite existing files', async () => {
      const filePath = path.join(testDir, 'overwrite.txt');
      await fs.writeFile(filePath, 'Old content', 'utf-8');
      
      const success = await safeWriteFile(filePath, 'New content');

      expect(success).toBe(true);
      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('New content');
    });
  });

  describe('createBackup', () => {
    it('should create a backup of an existing file', async () => {
      const filePath = path.join(testDir, 'original.txt');
      await fs.writeFile(filePath, 'Original content', 'utf-8');

      const backupPath = await createBackup(filePath);

      expect(backupPath).toBeDefined();
      expect(backupPath).toContain('.backup.');
      
      const backupContent = await fs.readFile(backupPath!, 'utf-8');
      expect(backupContent).toBe('Original content');
    });

    it('should return undefined for non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');
      const backupPath = await createBackup(filePath);

      expect(backupPath).toBeUndefined();
    });

    it('should preserve file content in backup', async () => {
      const filePath = path.join(testDir, 'data.json');
      const originalData = JSON.stringify({ key: 'value' }, null, 2);
      await fs.writeFile(filePath, originalData, 'utf-8');

      const backupPath = await createBackup(filePath);

      expect(backupPath).toBeDefined();
      const backupContent = await fs.readFile(backupPath!, 'utf-8');
      expect(backupContent).toBe(originalData);
    });
  });

  describe('ensureDir', () => {
    it('should create a new directory', async () => {
      const dirPath = path.join(testDir, 'newdir');
      const success = await ensureDir(dirPath);

      expect(success).toBe(true);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(testDir, 'a', 'b', 'c', 'd');
      const success = await ensureDir(dirPath);

      expect(success).toBe(true);
      const stats = await fs.stat(dirPath);
      expect(stats.isDirectory()).toBe(true);
    });

    it('should succeed for existing directory', async () => {
      const dirPath = path.join(testDir, 'existing');
      await fs.mkdir(dirPath);

      const success = await ensureDir(dirPath);
      expect(success).toBe(true);
    });
  });

  describe('fileExists', () => {
    it('should return true for existing file', async () => {
      const filePath = path.join(testDir, 'exists.txt');
      await fs.writeFile(filePath, 'content', 'utf-8');

      const exists = await fileExists(filePath);
      expect(exists).toBe(true);
    });

    it('should return true for existing directory', async () => {
      const dirPath = path.join(testDir, 'existingdir');
      await fs.mkdir(dirPath);

      const exists = await fileExists(dirPath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const filePath = path.join(testDir, 'noexist.txt');
      const exists = await fileExists(filePath);
      expect(exists).toBe(false);
    });
  });

  describe('safeCopyFile', () => {
    it('should copy a file', async () => {
      const source = path.join(testDir, 'source.txt');
      const destination = path.join(testDir, 'destination.txt');
      await fs.writeFile(source, 'Source content', 'utf-8');

      const success = await safeCopyFile(source, destination);

      expect(success).toBe(true);
      const destContent = await fs.readFile(destination, 'utf-8');
      expect(destContent).toBe('Source content');
    });

    it('should create parent directories for destination', async () => {
      const source = path.join(testDir, 'source.txt');
      const destination = path.join(testDir, 'nested', 'dest.txt');
      await fs.writeFile(source, 'Content', 'utf-8');

      const success = await safeCopyFile(source, destination);

      expect(success).toBe(true);
      const destContent = await fs.readFile(destination, 'utf-8');
      expect(destContent).toBe('Content');
    });

    it('should return false for non-existent source', async () => {
      const source = path.join(testDir, 'nosource.txt');
      const destination = path.join(testDir, 'dest.txt');

      const success = await safeCopyFile(source, destination);
      expect(success).toBe(false);
    });
  });

  describe('backupFile', () => {
    it('should create a backup with timestamp', async () => {
      const filePath = path.join(testDir, 'file.txt');
      await fs.writeFile(filePath, 'File content', 'utf-8');

      const backupPath = await backupFile(filePath);

      expect(backupPath).toBeDefined();
      expect(backupPath).toContain('.backup-');
      
      const backupContent = await fs.readFile(backupPath!, 'utf-8');
      expect(backupContent).toBe('File content');
    });

    it('should return undefined for non-existent file', async () => {
      const filePath = path.join(testDir, 'nofile.txt');
      const backupPath = await backupFile(filePath);

      expect(backupPath).toBeUndefined();
    });
  });

  describe('symlink handling', () => {
    it('should resolve symlinks before writing (safeWriteFile)', async () => {
      const realFile = path.join(testDir, 'real.txt');
      const symlink = path.join(testDir, 'link.txt');
      
      await fs.writeFile(realFile, 'Original', 'utf-8');
      
      // Create symlink (skip on Windows if permission issues)
      try {
        await fs.symlink(realFile, symlink);
      } catch {
        // Skip test on Windows if symlink creation fails
        return;
      }

      const success = await safeWriteFile(symlink, 'Updated');

      expect(success).toBe(true);
      const realContent = await fs.readFile(realFile, 'utf-8');
      expect(realContent).toBe('Updated');
    });

    it('should resolve symlinks before backup', async () => {
      const realFile = path.join(testDir, 'real.txt');
      const symlink = path.join(testDir, 'link.txt');
      
      await fs.writeFile(realFile, 'Content', 'utf-8');
      
      // Create symlink (skip on Windows if permission issues)
      try {
        await fs.symlink(realFile, symlink);
      } catch {
        // Skip test on Windows if symlink creation fails
        return;
      }

      const backupPath = await createBackup(symlink);

      expect(backupPath).toBeDefined();
      // Backup should be based on the real file path
      expect(backupPath).toContain(path.basename(realFile));
    });
  });
});
