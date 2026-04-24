/**
 * CLI detection using PATH probing.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { AssistantRegistry } from '../registry/registryTypes';
import { getRuntimeSettings } from '../../config/runtimeSettings';

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
 * Uses parallel detection with configurable per-process timeouts for performance.
 * @param registry The assistant registry
 * @param earlyExitTargets Optional array of assistant keys to find - will exit early if all found
 * @returns Promise resolving to array of detected CLIs
 */
export async function detectCLIs(registry: AssistantRegistry, earlyExitTargets?: string[]): Promise<DetectedCLI[]> {
  const isWindows = process.platform === 'win32';
  const whichCommand = isWindows ? 'where' : 'which';
  const { cliDetectionTimeoutMs } = getRuntimeSettings();
  
  // Build list of detection tasks
  const detectionTasks = registry.assistants.map(async (entry) => {
    const cliCommands = entry.detection.cliCommands || [];
    
    for (const command of cliCommands) {
      try {
        // Check if command exists with timeout
        const { stdout } = await execFileAsync(whichCommand, [command], {
          timeout: cliDetectionTimeoutMs,
          encoding: 'utf8'
        });
        
        const path = stdout.trim().split('\n')[0]; // Get first path on Windows
        
        // Try to get version
        let version: string | undefined;
        try {
          const { stdout: versionOutput } = await execFileAsync(command, ['--version'], {
            timeout: cliDetectionTimeoutMs,
            encoding: 'utf8'
          });
          version = versionOutput.trim().split('\n')[0];
        } catch {
          // Version command not supported, continue without it
        }
        
        return {
          assistantKey: entry.key,
          command,
          version,
          path
        };
      } catch {
        // Command not found, continue to next
      }
    }
    
    return null;
  });
  
  // Run all detections in parallel
  const results = await Promise.all(detectionTasks);
  const detected: DetectedCLI[] = [];
  
  for (const result of results) {
    if (result !== null) {
      detected.push(result);
    }
  }
  
  // Early exit optimization: if we found all target assistants, return immediately
  if (earlyExitTargets && earlyExitTargets.length > 0) {
    const foundKeys = new Set(detected.map(d => d.assistantKey));
    const allTargetsFound = earlyExitTargets.every(target => foundKeys.has(target));
    if (allTargetsFound) {
      return detected;
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
    await execAsync(checkCmd, [command], { timeout: getRuntimeSettings().cliDetectionTimeoutMs });
    return true;
  } catch {
    return false;
  }
}
