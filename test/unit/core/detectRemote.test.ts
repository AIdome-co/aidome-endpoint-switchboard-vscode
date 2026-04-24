/**
 * Unit tests for remote context detection.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { detectRemote, detectRemoteAssistant } from '../../../src/core/detection/detectRemote';

let mockRemoteName: string | undefined;

vi.mock('vscode', () => ({
  env: {
    get remoteName() {
      return mockRemoteName;
    }
  }
}));

describe('detectRemote', () => {
  beforeEach(() => {
    mockRemoteName = undefined;
  });

  it('should report local context when no remote name is set', () => {
    const result = detectRemote();

    expect(result.isRemote).toBe(false);
    expect(result.remoteType).toBe('local');
    expect(result.hostInfo).toBe('Local machine');
    expect(result.isLocalhost).toBe(true);
    expect(result.warningMessages).toEqual([]);
  });

  it('should classify SSH remotes and warn when localhost is used remotely', () => {
    mockRemoteName = 'ssh-remote+build-host';

    const result = detectRemote('http://localhost:8080/v1');

    expect(result.isRemote).toBe(true);
    expect(result.remoteType).toBe('ssh');
    expect(result.hostInfo).toBe('build-host');
    expect(result.isLocalhost).toBe(false);
    expect(result.warningMessages.some(message => message.includes("uses 'localhost'"))).toBe(true);
    expect(result.warningMessages.some(message => message.includes('tested from the remote host context'))).toBe(true);
    expect(result.warningMessages.some(message => message.includes('Verify paths exist on build-host'))).toBe(true);
  });

  it('should classify attached containers as dev-container remotes', () => {
    mockRemoteName = 'attached-container';

    const result = detectRemote('https://aidome.example.com/v1');

    expect(result.isRemote).toBe(true);
    expect(result.remoteType).toBe('dev-container');
    expect(result.hostInfo).toBe('Dev Container');
    expect(result.warningMessages).toHaveLength(1);
    expect(result.warningMessages[0]).toContain('Verify paths exist on Dev Container');
  });

  it('should return the current skeleton result for remote assistant detection', async () => {
    await expect(detectRemoteAssistant('anythingllm')).resolves.toEqual({
      assistantKey: 'anythingllm',
      detected: false,
      method: 'process'
    });
  });
});