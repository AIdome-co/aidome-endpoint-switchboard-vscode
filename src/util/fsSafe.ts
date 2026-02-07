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
export async function safeReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
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
