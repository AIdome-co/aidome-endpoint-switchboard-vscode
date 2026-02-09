/**
 * Remote context detection for VS Code.
 */

import * as vscode from 'vscode';

/**
 * Remote context information.
 */
export interface RemoteContext {
  isRemote: boolean;
  remoteName: string | undefined;
  remoteType: 'ssh' | 'dev-container' | 'codespaces' | 'wsl' | 'tunnel' | 'local';
  hostInfo: string;             // hostname or container name
  isLocalhost: boolean;         // true if running on local machine
  warningMessages: string[];    // populated with relevant warnings
}

/**
 * Detects remote development context with enhanced information.
 * @param baseUrl Optional base URL to check for localhost warnings
 * @returns Remote context information
 */
export function detectRemote(baseUrl?: string): RemoteContext {
  const remoteName = vscode.env.remoteName;
  const warningMessages: string[] = [];
  
  if (!remoteName) {
    return {
      isRemote: false,
      remoteName: undefined,
      remoteType: 'local',
      hostInfo: 'Local machine',
      isLocalhost: true,
      warningMessages
    };
  }
  
  // Determine remote type and extract host information
  let remoteType: RemoteContext['remoteType'] = 'ssh';
  let hostInfo = remoteName;
  
  if (remoteName.includes('ssh-remote')) {
    remoteType = 'ssh';
    // Extract hostname from format: ssh-remote+hostname
    const parts = remoteName.split('+');
    if (parts.length > 1) {
      hostInfo = parts[1];
    }
  } else if (remoteName === 'ssh') {
    remoteType = 'ssh';
    hostInfo = 'SSH remote';
  } else if (remoteName.includes('dev-container') || remoteName === 'attached-container') {
    remoteType = 'dev-container';
    // Try to extract container name
    const parts = remoteName.split('+');
    if (parts.length > 1) {
      hostInfo = parts[1];
    } else {
      hostInfo = 'Dev Container';
    }
  } else if (remoteName.includes('codespaces')) {
    remoteType = 'codespaces';
    // Extract Codespaces instance name if available
    const parts = remoteName.split('+');
    if (parts.length > 1) {
      hostInfo = parts[1];
    } else {
      hostInfo = 'GitHub Codespaces';
    }
  } else if (remoteName.includes('wsl')) {
    remoteType = 'wsl';
    // Extract WSL distro name
    const parts = remoteName.split('+');
    if (parts.length > 1) {
      hostInfo = parts[1];
    } else {
      hostInfo = 'WSL';
    }
  } else if (remoteName.includes('tunnel')) {
    remoteType = 'tunnel';
    hostInfo = 'VS Code Tunnel';
  }
  
  // Generate warnings based on context
  if (baseUrl) {
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
      warningMessages.push(
        `⚠️ Your profile uses 'localhost' but you're connected to a remote host (${hostInfo}). ` +
        `The endpoint may not be reachable. Consider using the remote host's IP/hostname instead.`
      );
    }
  }
  
  // Add general remote warnings
  if (remoteType === 'ssh' || remoteType === 'tunnel') {
    warningMessages.push(
      `ℹ️ Endpoint reachability will be tested from the remote host context.`
    );
  }
  
  // Add file path warning for all remote types
  warningMessages.push(
    `⚠️ Configuration file paths may differ on the remote host. Verify paths exist on ${hostInfo}.`
  );
  
  return {
    isRemote: true,
    remoteName,
    remoteType,
    hostInfo,
    isLocalhost: false,
    warningMessages
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
