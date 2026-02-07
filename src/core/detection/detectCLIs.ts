/**
 * CLI tool detection by probing PATH.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Checks if a CLI command exists in PATH.
 * @param command The command name
 * @returns Promise resolving to true if command exists
 */
export async function detectCli(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    await execAsync(`${checkCmd} ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets CLI version if available.
 * @param command The command name
 * @param versionFlag The version flag (default: --version)
 * @returns Promise resolving to version string or undefined
 */
export async function getCliVersion(command: string, versionFlag = '--version'): Promise<string | undefined> {
  try {
    const { stdout } = await execAsync(`${command} ${versionFlag}`);
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/**
 * Detects multiple CLI tools.
 * @param commands Array of command names
 * @returns Promise resolving to array of detected commands
 */
export async function detectClis(commands: string[]): Promise<string[]> {
  const results = await Promise.all(
    commands.map(async cmd => ({
      cmd,
      exists: await detectCli(cmd)
    }))
  );
  
  return results.filter(r => r.exists).map(r => r.cmd);
}
