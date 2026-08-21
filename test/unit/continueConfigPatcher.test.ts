/**
 * Unit tests for Continue config patcher.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildContinueConfigContent,
  patchContinueConfig
} from '../../src/adapters/continue/continueConfigPatcher';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/adapters/continue/paths', () => ({
  getContinueConfigPath: () => '/home/user/.continue/config.json'
}));

describe('Continue Config Patcher', () => {
  it('rejects unsafe endpoint URLs', () => {
    expect(() => buildContinueConfigContent('javascript:alert(1)')).toThrow('endpoint URL is invalid');
  });

  let mockProfile: EndpointProfile;

  beforeEach(() => {
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  it('updates the existing OpenAI model and preserves other models and settings', () => {
    const existingContent = JSON.stringify({
      models: [
        {
          title: 'Local model',
          provider: 'ollama',
          model: 'qwen2.5-coder',
          apiBase: mockProfile.baseUrl,
          customModelSetting: true
        },
        {
          title: 'Existing OpenAI',
          provider: 'openai',
          model: 'gpt-4o',
          apiBase: 'https://api.openai.com/v1',
          requestOptions: { timeout: 30000 }
        }
      ],
      customSetting: { enabled: true }
    });

    const result = JSON.parse(buildContinueConfigContent(mockProfile.baseUrl, existingContent));

    expect(result.customSetting).toEqual({ enabled: true });
    expect(result.models).toHaveLength(2);
    expect(result.models[0]).toEqual(JSON.parse(existingContent).models[0]);
    expect(result.models[1]).toMatchObject({
      title: 'Existing OpenAI',
      provider: 'openai',
      model: 'gpt-4o',
      apiBase: mockProfile.baseUrl,
      requestOptions: { timeout: 30000 }
    });
  });

  it('adds exactly one valid OpenAI model when one is absent', () => {
    const result = JSON.parse(buildContinueConfigContent(mockProfile.baseUrl, JSON.stringify({
      models: [{ title: 'Claude', provider: 'anthropic', model: 'claude-sonnet' }],
      customSetting: true
    })));

    expect(result.customSetting).toBe(true);
    expect(result.models).toHaveLength(2);
    expect(result.models.filter((model: { provider?: string }) => model.provider === 'openai')).toHaveLength(1);
    expect(result.models[1]).toEqual({
      title: 'AIdome Gateway',
      provider: 'openai',
      apiBase: mockProfile.baseUrl,
      model: 'gpt-4'
    });
  });

  it('creates a valid config with one model when the file is missing', () => {
    const result = JSON.parse(buildContinueConfigContent(mockProfile.baseUrl));

    expect(result.models).toEqual([{
      title: 'AIdome Gateway',
      provider: 'openai',
      apiBase: mockProfile.baseUrl,
      model: 'gpt-4'
    }]);
  });

  it('accepts Continue JSONC comments while patching', () => {
    const result = JSON.parse(buildContinueConfigContent(mockProfile.baseUrl, `{
      // Continue's legacy config loader accepts JSONC comments.
      "models": [{
        "title": "Existing OpenAI",
        "provider": "openai",
        "model": "gpt-4o"
      }]
    }`));

    expect(result.models[0].apiBase).toBe(mockProfile.baseUrl);
  });

  it('rejects malformed JSONC without replacing the file', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('{ malformed json');
    vi.spyOn(fsSafe, 'writeFileAtomic').mockResolvedValue(true);

    await expect(patchContinueConfig(mockProfile, '/path/to/config.json')).rejects.toThrow();
    expect(fsSafe.writeFileAtomic).not.toHaveBeenCalled();
  });

  it('rejects an unsupported models shape without replacing the file', () => {
    expect(() => buildContinueConfigContent(
      mockProfile.baseUrl,
      JSON.stringify({ models: { provider: 'openai' }, customSetting: true })
    )).toThrow('models must be an array of objects');
  });
});
