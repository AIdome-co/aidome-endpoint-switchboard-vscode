/**
 * Safe file system operations with error handling.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Safely reads a file.
 * @param filePath The file path
 * @returns Promise resolving to file content or undefined
 */
export async function readFileSafe(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

/**
 * Safely reads a file (alias for compatibility).
 * @param filePath The file path
 * @returns Promise resolving to file content or undefined
 */
export async function safeReadFile(filePath: string): Promise<string | undefined> {
  return readFileSafe(filePath);
}

/**
 * Writes a file atomically using a temporary file.
 * @param filePath The file path
 * @param content The content to write
 * @returns Promise resolving to true if successful
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<boolean> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  
  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    // Write to temporary file
    await fs.writeFile(tmpPath, content, 'utf-8');
    
    // Rename to target (atomic on most systems)
    await fs.rename(tmpPath, filePath);
    
    return true;
  } catch {
    // Clean up temp file if it exists
    try {
      await fs.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Safely writes a file.
 * @param filePath The file path
 * @param content The content to write
 * @returns Promise resolving to true if successful
 */
export async function safeWriteFile(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a backup of a file with timestamp.
 * @param filePath The file path
 * @returns Promise resolving to backup path or undefined
 */
export async function createBackup(filePath: string): Promise<string | undefined> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup.${timestamp}`;
  
  try {
    await fs.copyFile(filePath, backupPath);
    return backupPath;
  } catch {
    return undefined;
  }
}

/**
 * Ensures a directory exists, creating it if necessary.
 * @param dirPath The directory path
 * @returns Promise resolving to true if successful
 */
export async function ensureDir(dirPath: string): Promise<boolean> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if a file exists.
 * @param filePath The file path
 * @returns Promise resolving to true if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copies a file.
 * @param source Source file path
 * @param destination Destination file path
 * @returns Promise resolving to true if successful
 */
export async function safeCopyFile(source: string, destination: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a backup of a file.
 * @param filePath The file path
 * @returns Promise resolving to backup path or undefined
 */
export async function backupFile(filePath: string): Promise<string | undefined> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup-${timestamp}`;
  
  const success = await safeCopyFile(filePath, backupPath);
  return success ? backupPath : undefined;
}
