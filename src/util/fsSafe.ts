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
 * Handles file locked errors (EBUSY/EACCES) with retry.
 * @param filePath The file path
 * @param content The content to write
 * @param retries Number of retries on lock errors (default: 1)
 * @returns Promise resolving to true if successful
 */
export async function writeFileAtomic(filePath: string, content: string, retries: number = 1): Promise<boolean> {
  const tmpPath = `${filePath}.tmp.${Date.now()}`;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Resolve symlinks before writing
      let realPath = filePath;
      try {
        realPath = await fs.realpath(filePath);
      } catch {
        // File doesn't exist yet, use original path
      }
      
      // Ensure directory exists
      await fs.mkdir(path.dirname(realPath), { recursive: true });
      
      // Write to temporary file
      await fs.writeFile(tmpPath, content, 'utf-8');
      
      // Rename to target (atomic on most systems)
      await fs.rename(tmpPath, realPath);
      
      return true;
    } catch (error) {
      const isLockError = error && typeof error === 'object' && 'code' in error && 
                         (error.code === 'EBUSY' || error.code === 'EACCES');
      
      // Clean up temp file if it exists
      try {
        await fs.unlink(tmpPath);
      } catch {
        // Ignore cleanup errors
      }
      
      // Retry on lock errors
      if (isLockError && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      
      // User-friendly error message for lock errors
      if (isLockError) {
        const logger = await import('./log').then(m => m.Logger.getInstance());
        logger.error(`File is locked and cannot be written: ${filePath}. Please close any applications using this file and try again.`);
      }
      
      return false;
    }
  }
  
  return false;
}

/**
 * Safely writes a file.
 * Handles file locked errors (EBUSY/EACCES) with retry.
 * Resolves symlinks before writing.
 * @param filePath The file path
 * @param content The content to write
 * @param retries Number of retries on lock errors (default: 1)
 * @returns Promise resolving to true if successful
 */
export async function safeWriteFile(filePath: string, content: string, retries: number = 1): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Resolve symlinks before writing
      let realPath = filePath;
      try {
        realPath = await fs.realpath(filePath);
      } catch {
        // File doesn't exist yet, use original path
      }
      
      await fs.mkdir(path.dirname(realPath), { recursive: true });
      await fs.writeFile(realPath, content, 'utf-8');
      return true;
    } catch (error) {
      const isLockError = error && typeof error === 'object' && 'code' in error && 
                         (error.code === 'EBUSY' || error.code === 'EACCES');
      
      // Retry on lock errors
      if (isLockError && attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 500));
        continue;
      }
      
      // User-friendly error message for lock errors
      if (isLockError) {
        const logger = await import('./log').then(m => m.Logger.getInstance());
        logger.error(`File is locked and cannot be written: ${filePath}. Please close any applications using this file and try again.`);
      }
      
      return false;
    }
  }
  
  return false;
}

/**
 * Creates a backup of a file with timestamp.
 * Resolves symlinks before backing up.
 * @param filePath The file path
 * @returns Promise resolving to backup path or undefined
 */
export async function createBackup(filePath: string): Promise<string | undefined> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  try {
    // Resolve symlinks before backup
    let realPath = filePath;
    try {
      realPath = await fs.realpath(filePath);
    } catch {
      // If realpath fails, use original path
    }
    
    const backupPath = `${realPath}.backup.${timestamp}`;
    await fs.copyFile(realPath, backupPath);
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
