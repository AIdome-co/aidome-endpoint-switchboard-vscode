/** Unit tests for the guided-only CodeGPT adapter. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeGptAdapter } from '../../src/adapters/codegpt/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';

const mockExtension = { packageJSON: {} };

vi.mock('vscode', () => ({
  extensions: { getExtension: vi.fn() }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn() })
  }
}));

describe('CodeGptAdapter', () => {
  let adapter: CodeGptAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new CodeGptAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  it('detects CodeGPT by its extension ID', async () => {
    const vscode = await import('vscode');
    vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

    await expect(adapter.detect()).resolves.toBe(true);
    expect(vscode.extensions.getExtension).toHaveBeenCalledWith('DanielSanMedium.dscodegpt');
  });

  it('builds exactly one guided step and does not scan or mutate settings', async () => {
    const plan = await adapter.buildPlan(mockProfile);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('show-guided-steps');
    expect(plan.steps[0].targetPath).toBeUndefined();
    expect(plan.steps[0].data.baseUrl).toBe(mockProfile.baseUrl);
    expect(plan.steps[0].data.configurationType).toBe('in-extension-ui');
    expect(plan.steps[0].data.limitation).toContain('cannot be safely inferred');
    expect((plan.steps[0].data.steps as string[]).join('\n')).toContain('Manage my AI Models');
  });

  it('rejects unsafe endpoint URLs before building guidance', async () => {
    await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
      .rejects.toThrow('unsupported scheme');
  });

  it('does not claim endpoint verification for an installed extension', async () => {
    const vscode = await import('vscode');
    vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

    const result = await adapter.verify();
    expect(result.success).toBe(false);
    expect(result.message).toContain('model-management panel');
    expect(result.details).toMatchObject({
      extension: true,
      configurationStatus: 'manual-configuration-required'
    });
  });

  it('reports a missing extension', async () => {
    const vscode = await import('vscode');
    vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

    const result = await adapter.verify();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not installed');
  });

  it('leaves execution to the shared plan applier and reports tier B', async () => {
    await expect(adapter.apply(await adapter.buildPlan(mockProfile))).resolves.toBeUndefined();
    expect(adapter.getDisplayName()).toBe('CodeGPT');
    expect(adapter.getTier()).toBe('B');
  });
});
