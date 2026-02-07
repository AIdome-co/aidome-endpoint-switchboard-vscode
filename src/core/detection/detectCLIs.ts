/**
 * CLI detection using PATH probing.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { AssistantRegistry } from '../registry/registryTypes';

const execFileAsync = promisify(execFile);

/**
 * Detected CLI information.
 */
export interface DetectedCLI {
  assistantKey: string;
  command: string;
  version?: string;
  path?: string;
}

/**
 * Detects installed CLI tools from registry.
 * @param registry The assistant registry
 * @returns Promise resolving to array of detected CLIs
 */
export async function detectCLIs(registry: AssistantRegistry): Promise<DetectedCLI[]> {
  const detected: DetectedCLI[] = [];
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where' : 'which';
  
  for (const entry of registry.assistants) {
    const cliCommands = entry.detection.cliCommands || [];
    
    for (const command of cliCommands) {
      try {
        // Check if command exists with timeout
        const { stdout } = await execFileAsync(whichCommand, [command], {
          timeout: 2000,
          encoding: 'utf8'
        });
        
        const path = stdout.trim().split('\n')[0]; // Get first path on Windows
        
        // Try to get version
        let version: string | undefined;
        try {
          const { stdout: versionOutput } = await execFileAsync(command, ['--version'], {
            timeout: 2000,
            encoding: 'utf8'
          });
          version = versionOutput.trim().split('\n')[0];
        } catch {
          // Version command not supported, continue without it
        }
        
        detected.push({
          assistantKey: entry.key,
          command,
          version,
          path
        });
        
        // Only detect once per assistant (use first matching command)
        break;
      } catch {
        // Command not found, continue to next
      }
    }
  }
  
  return detected;
}

/**
 * Checks if a CLI command exists in PATH.
 * @param command The command name
 * @returns Promise resolving to true if command exists
 */
export async function detectCli(command: string): Promise<boolean> {
  try {
    const checkCmd = process.platform === 'win32' ? 'where' : 'which';
    const execAsync = promisify(execFile);
    await execAsync(checkCmd, [command], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
