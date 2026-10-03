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

  it('merges discovered model catalog entries without dropping existing models', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: JSON.stringify({
        providers: {
          'openai-compatible': {
            models: {
              'existing-model': { id: 'existing-model', contextWindow: 64_000 }
            }
          }
        }
      }),
      format: 'json',
      options: {
        driver: 'json-object',
        format: 'json',
        patches: [{
          path: ['providers', 'openai-compatible', 'models'],
          value: {
            'gateway-model': { id: 'gateway-model', contextWindow: 128_000 }
          },
          mergeObject: true
        }]
      }
    });

    const parsed = JSON.parse(output) as {
      providers: { 'openai-compatible': { models: Record<string, unknown> } }
    };
    expect(parsed.providers['openai-compatible'].models).toMatchObject({
      'existing-model': { id: 'existing-model' },
      'gateway-model': { id: 'gateway-model' }
    });
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

  it('patches only the AIdome-managed YAML model entry and preserves unrelated models', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: '# Continue settings\nmodels:\n  - name: UserOwnOpenAI\n    provider: openai\n    model: gpt-4o\n    apiBase: https://api.openai.com/v1\ncustom: true\n',
      format: 'yaml',
      options: {
        driver: 'yaml-model-array',
        format: 'yaml',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
    const models = parsed.models as Array<Record<string, unknown>>;
    // The user's own OpenAI entry is untouched.
    expect(models[0]).toMatchObject({
      name: 'UserOwnOpenAI',
      model: 'gpt-4o',
      apiBase: 'https://api.openai.com/v1'
    });
    expect(parsed.custom).toBe(true);
    expect(output).toContain('Continue settings');
    // The AIdome entry is appended with the gateway URL.
    const managed = models.find(model => model.title === 'AIdome Gateway');
    expect(managed).toMatchObject({ provider: 'openai', apiBase: BASE_URL });
  });

  it('updates the previously managed entry instead of appending duplicates', () => {
    const output = renderConfigFileContent({
      baseUrl: 'https://gateway.example.com/v1',
      existingContent: 'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://stale.example.com/v1\n',
      format: 'yaml',
      options: {
        driver: 'yaml-model-array',
        format: 'yaml',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
    const models = parsed.models as Array<Record<string, unknown>>;
    expect(models).toHaveLength(1);
    expect(models[0].apiBase).toBe('https://gateway.example.com/v1');
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

  it('updates the selected Codex model when discovery supplies one', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'model = "stale-model"\n',
      format: 'toml',
      options: {
        driver: 'toml-table',
        providerName: 'aidome',
        wireApi: 'responses',
        model: 'gateway-model'
      }
    });

    expect((parseToml(output) as Record<string, unknown>).model).toBe('gateway-model');
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

  describe('fail-closed on malformed existing configuration', () => {
    it('aborts and never replaces a malformed existing JSON file', () => {
      const malformed = '{ "broken": tru';

      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: malformed,
        format: 'json',
        options: {
          driver: 'json-object',
          format: 'json',
          patches: [{ path: ['env', 'BASE_URL'], source: 'baseUrl' }]
        }
      })).toThrow('malformed existing configuration file');
    });

    it('aborts and never replaces a malformed existing JSONC file', () => {
      const malformed = '{\\n  // comment without a document end\\n  "broken":';

      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: malformed,
        format: 'jsonc',
        options: {
          driver: 'json-object',
          format: 'jsonc',
          patches: [{ path: ['env', 'BASE_URL'], source: 'baseUrl' }]
        }
      })).toThrow('malformed existing configuration file');
    });

    it('fails closed when a JSONC provider map hits malformed existing content', () => {
      const malformed = '{ "provider": { "aidome-gateway": "oops';

      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: malformed,
        format: 'jsonc',
        options: {
          driver: 'jsonc-provider-map',
          mapPath: ['provider'],
          providerId: 'aidome-gateway',
          defaults: { name: 'AIdome Gateway' },
          baseUrlPath: ['options', 'baseURL']
        }
      })).toThrow('malformed existing configuration file');
    });

    it('fails closed when a JSONC model array hits malformed existing content', () => {
      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: '{ "models": [ "not-an-object" ',
        format: 'jsonc',
        options: {
          driver: 'yaml-model-array',
          format: 'jsonc',
          provider: 'openai'
        }
      })).toThrow('malformed existing configuration file');
    });

    it('fails closed when a YAML document has parser errors', () => {
      const malformed = 'models:\\n  - name: [unclosed\\n  - "bad';

      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: malformed,
        format: 'yaml',
        options: {
          driver: 'yaml-model-array',
          format: 'yaml',
          provider: 'openai'
        }
      })).toThrow('malformed existing configuration file');
    });

    it('fails closed when an existing TOML file cannot be parsed', () => {
      const malformed = 'model = "broken\\n[model_providers.aidome';

      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: malformed,
        format: 'toml',
        options: {
          driver: 'toml-table',
          providerName: 'aidome',
          wireApi: 'responses',
          envKey: 'OPENAI_API_KEY'
        }
      })).toThrow('malformed existing configuration file');
    });

    it('still allows creating a brand-new configuration file', () => {
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: undefined,
        format: 'toml',
        options: {
          driver: 'toml-table',
          providerName: 'aidome',
          wireApi: 'responses',
          envKey: 'OPENAI_API_KEY'
        }
      });

      expect((parseToml(output) as Record<string, unknown>).model_provider).toBe('aidome');
    });

    it('rejects a non-object JSON document root', () => {
      expect(() => renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: '[1, 2, 3]',
        format: 'json',
        options: {
          driver: 'json-object',
          format: 'json',
          patches: [{ path: ['a'], value: 1 }]
        }
      })).toThrow('expected an object');
    });
  });
});
