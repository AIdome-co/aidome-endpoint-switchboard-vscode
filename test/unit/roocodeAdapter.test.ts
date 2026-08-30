/** Unit tests for the retired Roo Code adapter. */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RooCodeAdapter } from '../../src/adapters/roocode/adapter';
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

describe('RooCodeAdapter', () => {
  let adapter: RooCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new RooCodeAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  it('detects the retired extension without treating it as supported', async () => {
    const vscode = await import('vscode');
    vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

    await expect(adapter.detect()).resolves.toBe(true);
    await expect(adapter.verify()).resolves.toMatchObject({
      success: false,
      details: { extension: true, configurationStatus: 'unsupported' }
    });
  });

  it('builds guidance only and never writes guessed Roo settings', async () => {
    const plan = await adapter.buildPlan(mockProfile);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('show-guided-steps');
    expect(plan.steps[0].targetPath).toBeUndefined();
    expect(plan.steps[0].data.limitation).toBe('retired-upstream');
    expect(plan.steps[0].data.baseUrl).toBe(mockProfile.baseUrl);
  });

  it('rejects unsafe endpoint URLs before building guidance', async () => {
    await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
      .rejects.toThrow('unsupported scheme');
  });

  it('reports a missing retired extension', async () => {
    const vscode = await import('vscode');
    vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

    const result = await adapter.verify();
    expect(result.success).toBe(false);
    expect(result.message).toContain('not installed');
    expect(result.details?.configurationStatus).toBe('unsupported');
  });

  it('leaves execution to the shared plan applier', async () => {
    await expect(adapter.apply(await adapter.buildPlan(mockProfile))).resolves.toBeUndefined();
  });

  it('reports its display name and tier', () => {
    expect(adapter.getDisplayName()).toBe('Roo Code');
    expect(adapter.getTier()).toBe('C');
  });
});
