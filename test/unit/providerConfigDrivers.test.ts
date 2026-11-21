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

  it('persists the resolved profile secret as the managed entry apiKey (yaml)', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://stale.example.com/v1\n',
      format: 'yaml',
      secret: 'aid_pat_yaml',
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
    expect(models[0].apiKey).toBe('aid_pat_yaml');
  });

  it('clears the managed entry apiKey when no secret is resolved (clear-not-replay)', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://gw.example.com/v1\n    apiKey: aid_pat_stale\n',
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
    expect(models[0].apiKey).toBeUndefined();
  });

  it('treats a whitespace-only secret as missing (no apiKey written)', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://gw.example.com/v1\n    apiKey: aid_pat_stale\n',
      format: 'yaml',
      secret: '   ',
      options: {
        driver: 'yaml-model-array',
        format: 'yaml',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
    const models = parsed.models as Array<Record<string, unknown>>;
    expect(models[0].apiKey).toBeUndefined();
  });

  it('never touches an unrelated user entry apiKey while clearing the managed one (jsonc)', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: JSON.stringify({
        models: [
          { title: 'UserOwnOpenAI', provider: 'openai', model: 'gpt-4o', apiBase: 'https://api.openai.com/v1', apiKey: 'user_own_key' },
          { title: 'AIdome Gateway', provider: 'openai', apiBase: 'https://gw.example.com/v1', apiKey: 'aid_pat_stale' }
        ]
      }),
      format: 'jsonc',
      options: {
        driver: 'yaml-model-array',
        format: 'jsonc',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = JSON.parse(output) as { models: Array<Record<string, unknown>> };
    expect(parsed.models[0].apiKey).toBe('user_own_key');
    expect(parsed.models[1].apiKey).toBeUndefined();
  });

  it('never rewrites a USER entry matched by URL fallback when no identity entry exists (Codex 155 round 1)', () => {
    // A user model pointing at the SAME gateway URL but with its own name and
    // its own credential: the URL-fallback match must not touch its apiKey —
    // a distinct managed entry is appended instead.
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: 'models:\n  - name: UserOwnGateway\n    title: UserOwnGateway\n    provider: openai\n    apiBase: ' + BASE_URL + '\n    apiKey: user_own_gateway_key\n',
      format: 'yaml',
      secret: 'aid_pat_profile',
      options: {
        driver: 'yaml-model-array',
        format: 'yaml',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
    const models = parsed.models as Array<Record<string, unknown>>;
    const userEntry = models.find(model => model.title === 'UserOwnGateway');
    expect(userEntry?.apiKey).toBe('user_own_gateway_key');
    const managed = models.find(model => model.title === 'AIdome Gateway');
    expect(managed?.apiKey).toBe('aid_pat_profile');
  });

  it('persists the secret on a NEWLY created managed entry (jsonc)', () => {
    const output = renderConfigFileContent({
      baseUrl: BASE_URL,
      existingContent: '{}',
      format: 'jsonc',
      secret: 'aid_pat_new',
      options: {
        driver: 'yaml-model-array',
        format: 'jsonc',
        provider: 'openai',
        identity: 'AIdome Gateway'
      }
    });

    const parsed = JSON.parse(output) as { models: Array<Record<string, unknown>> };
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]).toMatchObject({
      title: 'AIdome Gateway',
      apiBase: BASE_URL,
      apiKey: 'aid_pat_new'
    });
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

    describe('yaml-model-array with discovered gateway models', () => {
    it('writes one managed entry per gateway model, each with the required model field', () => {
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: 'models:\n  - name: UserOwnOpenAI\n    provider: openai\n    model: gpt-4o\n    apiBase: https://api.openai.com/v1\n',
        format: 'yaml',
        options: {
          driver: 'yaml-model-array',
          format: 'yaml',
          provider: 'openai',
          identity: 'AIdome Gateway',
          gatewayModels: ['m/a', 'm/b']
        }
      });

      const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
      const models = parsed.models as Array<Record<string, unknown>>;
      expect(models).toHaveLength(3);
      expect(models[0]).toMatchObject({ name: 'UserOwnOpenAI', model: 'gpt-4o' });
      const managed = models.filter(model => String(model.name).startsWith('AIdome Gateway - '));
      expect(managed).toHaveLength(2);
      for (const entry of managed) {
        expect(['m/a', 'm/b']).toContain(entry.model);
        expect(entry.title).toBe(entry.model);
        expect(entry.provider).toBe('openai');
        expect(entry.apiBase).toBe(BASE_URL);
        expect(typeof entry.model).toBe('string');
        expect(String(entry.model).length).toBeGreaterThan(0);
      }
    });

    it('persists the profile secret on every managed entry and clears it when unresolved', () => {
      const withSecret = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: '',
        format: 'yaml',
        secret: 'tok-1',
        options: {
          driver: 'yaml-model-array',
          format: 'yaml',
          provider: 'openai',
          identity: 'AIdome Gateway',
          gatewayModels: ['m/a', 'm/b']
        }
      });
      let parsed = parseDocument(withSecret).toJSON() as Record<string, unknown>;
      let managed = (parsed.models as Array<Record<string, unknown>>)
        .filter(model => String(model.name).startsWith('AIdome Gateway - '));
      expect(managed.map(m => m.apiKey)).toEqual(['tok-1', 'tok-1']);

      const cleared = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: withSecret,
        format: 'yaml',
        options: {
          driver: 'yaml-model-array',
          format: 'yaml',
          provider: 'openai',
          identity: 'AIdome Gateway',
          gatewayModels: ['m/a', 'm/b']
        }
      });
      parsed = parseDocument(cleared).toJSON() as Record<string, unknown>;
      managed = (parsed.models as Array<Record<string, unknown>>)
        .filter(model => String(model.name).startsWith('AIdome Gateway - '));
      expect(managed.map(m => m.apiKey)).toEqual([undefined, undefined]);
    });

    it('migrates the legacy single managed entry and reconciles removed models', () => {
      const existing = 'models:\n' +
        '  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://stale.example.com/v1\n    apiKey: old\n' +
        '  - name: AIdome Gateway - m/a\n    title: m/a\n    model: m/a\n    provider: openai\n    apiBase: https://stale.example.com/v1\n    apiKey: old\n' +
        '  - name: KeepMe\n    title: KeepMe\n    model: k\n    provider: openai\n    apiBase: https://elsewhere.example.com/v1\n';
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: existing,
        format: 'yaml',
        secret: 'tok-2',
        options: {
          driver: 'yaml-model-array',
          format: 'yaml',
          provider: 'openai',
          identity: 'AIdome Gateway',
          gatewayModels: ['m/a', 'm/c']
        }
      });

      const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
      const models = parsed.models as Array<Record<string, unknown>>;
      expect(models).toHaveLength(3); // KeepMe + 2 managed
      expect(models.some(m => m.name === 'KeepMe' && m.apiBase === 'https://elsewhere.example.com/v1')).toBe(true);
      const managed = models.filter(m => String(m.name).startsWith('AIdome Gateway'));
      expect(managed.map(m => m.model).sort()).toEqual(['m/a', 'm/c']);
      expect(managed.every(m => m.apiBase === BASE_URL && m.apiKey === 'tok-2')).toBe(true);
    });

    it('removes stale per-model managed entries on a profile switch without discovery results', () => {
      const existing = 'models:\n' +
        '  - name: AIdome Gateway - m/a\n    title: m/a\n    model: m/a\n    provider: openai\n    apiBase: https://stale.example.com/v1\n    apiKey: old\n';
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: existing,
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
      // The stale per-model entry (old URL + old key) is gone; only the
      // legacy identity entry remains.
      expect(models).toHaveLength(1);
      expect(models[0]).toMatchObject({ name: 'AIdome Gateway', apiBase: BASE_URL });
    });

    it('keeps the single-entry legacy behavior when no gateway models are provided', () => {
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: '',
        format: 'yaml',
        options: { driver: 'yaml-model-array', format: 'yaml', provider: 'openai', identity: 'AIdome Gateway' }
      });
      const parsed = parseDocument(output).toJSON() as Record<string, unknown>;
      const models = parsed.models as Array<Record<string, unknown>>;
      expect(models).toHaveLength(1);
      expect(models[0].name).toBe('AIdome Gateway');
    });

    it('jsonc: writes one managed entry per gateway model with the model field', () => {
      const output = renderConfigFileContent({
        baseUrl: BASE_URL,
        existingContent: '{ "models": [ { "name": "UserOwnOpenAI", "provider": "openai", "model": "gpt-4o", "apiBase": "https://api.openai.com/v1" } ] }',
        format: 'jsonc',
        options: {
          driver: 'yaml-model-array',
          format: 'jsonc',
          provider: 'openai',
          identity: 'AIdome Gateway',
          gatewayModels: ['m/a', 'm/b']
        }
      });

      const parsed = parseJsonc<Record<string, unknown>>(output);
      const models = parsed.models as Array<Record<string, unknown>>;
      expect(models).toHaveLength(3);
      const managed = models.filter(model => String(model.name).startsWith('AIdome Gateway - '));
      expect(managed).toHaveLength(2);
      expect(managed.every(m => typeof m.model === 'string' && m.apiBase === BASE_URL)).toBe(true);
    });
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
      const malformed = '{\n  // comment without a document end\n  "broken":';

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
      const malformed = 'models:\n  - name: [unclosed\n  - "bad';

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
      const malformed = 'model = "broken\n[model_providers.aidome';

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
