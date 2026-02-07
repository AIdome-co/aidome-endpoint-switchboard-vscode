/**
 * Remote context detection for VS Code.
 */

import * as vscode from 'vscode';

/**
 * Remote context information.
 */
export interface RemoteContext {
  isRemote: boolean;
  remoteName?: string;
  remoteType?: 'ssh-remote' | 'dev-container' | 'codespaces' | 'wsl' | 'other';
  hostInfo?: string;
}

/**
 * Detects remote development context.
 * @returns Remote context information
 */
export function detectRemote(): RemoteContext {
  const remoteName = vscode.env.remoteName;
  
  if (!remoteName) {
    return {
      isRemote: false
    };
  }
  
  // Determine remote type based on remoteName
  let remoteType: RemoteContext['remoteType'] = 'other';
  if (remoteName.includes('ssh-remote') || remoteName === 'ssh') {
    remoteType = 'ssh-remote';
  } else if (remoteName.includes('dev-container') || remoteName === 'attached-container') {
    remoteType = 'dev-container';
  } else if (remoteName.includes('codespaces')) {
    remoteType = 'codespaces';
  } else if (remoteName.includes('wsl')) {
    remoteType = 'wsl';
  }
  
  return {
    isRemote: true,
    remoteName,
    remoteType,
    hostInfo: vscode.env.remoteName
  };
}

// Keep legacy functions for backward compatibility
/**
 * Remote assistant detection result.
 */
export interface RemoteDetectionResult {
  assistantKey: string;
  detected: boolean;
  method: 'process' | 'port' | 'file';
  details?: string;
}

/**
 * Detects remote assistants like AnythingLLM.
 * @param assistantKey The assistant key
 * @returns Promise resolving to detection result
 */
export async function detectRemoteAssistant(assistantKey: string): Promise<RemoteDetectionResult> {
  // Skeleton implementation
  return {
    assistantKey,
    detected: false,
    method: 'process'
  };
}
