/** Tests for provider descriptors and reusable configuration drivers. */

import { describe, it, expect } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { parseJsonc } from '../../src/util/jsonc';
import {
  getProviderConfigDescriptors,
  renderConfigFileContent
} from '../../src/core/providerConfig';

const BASE_URL = 'https://gateway.example.com/v1';

describe('provider configuration descriptors', () => {
  it('contains one explicit contract for every manifest provider', () => {
    const descriptors = getProviderConfigDescriptors();

    expect(descriptors).toHaveLength(11);
    expect(descriptors.map(descriptor => descriptor.providerKey)).toEqual([
      'github-copilot',
      'cline',
      'roo-code',
      'kilo-code',
      'continue',
      'claude-code',
      'openai-codex',
      'gemini-cli',
      'codegpt',
      'anythingllm',
      'tabnine'
    ]);
    expect(descriptors.find(item => item.providerKey === 'roo-code')?.support).toBe('unsupported');
    expect(descriptors.find(item => item.providerKey === 'gemini-cli')?.support).toBe('guided');
    expect(descriptors.find(item => item.providerKey === 'codegpt')?.driver).toBe('guided-ui');
  });
});

describe('configuration drivers', () => {
  it('patches JSONC object fields while preserving unrelated fields and comments', () => {
    const existing = '{\n  // Keep this user note.\n  "other": true,\n  "env": { "OLD": "keep" }\n}\n';
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: existing,
      format: 'jsonc',
      options: {
        driver: 'json-object',
        format: 'jsonc',
        patches: [{ path: ['env', 'BASE_URL'], source: 'baseUrl' }]
      }
    });

    const parsed = parseJsonc<Record<string, unknown>>(output);
    expect(parsed.other).toBe(true);
    expect((parsed.env as Record<string, unknown>).OLD).toBe('keep');
    expect((parsed.env as Record<string, unknown>).BASE_URL).toBe(BASE_URL);
    expect(output).toContain('Keep this user note');
  });

  it('patches a JSONC provider map without serializing a profile secret', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      secret: 'profile-secret-must-not-be-written-here',
      existingContent: '{\n  // Existing provider comment\n  "provider": {\n    "other": { "options": { "baseURL": "https://other.example/v1" } }\n  }\n}\n',
      format: 'jsonc',
      options: {
        driver: 'jsonc-provider-map',
        mapPath: ['provider'],
        providerId: 'aidome-gateway',
        defaults: { name: 'AIdome Gateway', npm: '@ai-sdk/openai-compatible' },
        baseUrlPath: ['options', 'baseURL']
      }
    });

    const parsed = parseJsonc<Record<string, unknown>>(output);
    const provider = (parsed.provider as Record<string, unknown>)['aidome-gateway'] as Record<string, unknown>;
    expect((provider.options as Record<string, unknown>).baseURL).toBe(BASE_URL);
    expect(provider.name).toBe('AIdome Gateway');
    expect((parsed.provider as Record<string, unknown>).other).toBeDefined();
    expect(output).not.toContain('profile-secret-must-not-be-written-here');
    expect(output).toContain('Existing provider comment');
  });

  it('patches Continue YAML model arrays while preserving model fields', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: '# Continue settings\nmodels:\n  - name: Existing\n    provider: openai\n    model: existing-model\n    requestOptions:\n      timeout: 10000\ncustom: true\n',
      format: 'yaml',
      options: {
        driver: 'yaml-model-array',
        format: 'yaml',
        provider: 'openai'
      }
    });

    const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
    const model = (parsed.models as Array<Record<string, unknown>>)[0];
    expect(model.apiBase).toBe(BASE_URL);
    expect(model.model).toBe('existing-model');
    expect((model.requestOptions as Record<string, unknown>).timeout).toBe(10000);
    expect(parsed.custom).toBe(true);
    expect(output).toContain('Continue settings');
  });

  it('patches the current Codex TOML provider schema and preserves other providers', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'model = "existing-model"\n\n[model_providers.other]\nbase_url = "https://other.example/v1"\n',
      format: 'toml',
      options: {
        driver: 'toml-table',
        providerName: 'aidome',
        wireApi: 'responses',
        envKey: 'OPENAI_API_KEY'
      }
    });

    const parsed = parseToml(output) as Record<string, unknown>;
    expect(parsed.model_provider).toBe('aidome');
    expect(parsed.model).toBe('existing-model');
    expect((parsed.model_providers as Record<string, unknown>).other).toBeDefined();
    expect((parsed.model_providers as Record<string, Record<string, unknown>>).aidome).toMatchObject({
      base_url: BASE_URL,
      wire_api: 'responses',
      env_key: 'OPENAI_API_KEY'
    });
  });

  it('rejects unsafe driver paths', () => {
    expect(() => renderConfigFileContent({
      baseUrl: BASE_URL,
      format: 'jsonc',
      options: {
        driver: 'json-object',
        format: 'jsonc',
        patches: [{ path: ['__proto__', 'polluted'], value: 'x' }]
      }
    })).toThrow('invalid field path');
  });
});
