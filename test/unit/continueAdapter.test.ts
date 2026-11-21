/**
 * Unit tests for Continue adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContinueAdapter } from '../../src/adapters/continue/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as fsSafe from '../../src/util/fsSafe';
import * as continuePaths from '../../src/adapters/continue/paths';

const mockExtension = {
  packageJSON: {}
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  }
}));

vi.mock('../../src/util/fsSafe');
vi.mock('../../src/adapters/continue/paths');
const modelDiscoveryMock = await import('../../src/core/providerConfig/modelDiscovery');

vi.mock('../../src/core/providerConfig/modelDiscovery', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/providerConfig/modelDiscovery')>();
  return {
    ...actual,
    discoverOpenAiModels: vi.fn(async () => [])
  };
});
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('ContinueAdapter', () => {
  let adapter: ContinueAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new ContinueAdapter();
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
    vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.json');
    // Default discovery result for legacy buildPlan tests; the multi-model
    // describe re-mocks as needed (after clearAllMocks).
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Legacy Model' }
    ]);
  });

  describe('detect', () => {
    it('should return true when Continue extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as never);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('Continue.continue');
    });

    it('should return false when Continue extension is not installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false when extension lookup throws', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('extension lookup failed');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create config-file steps that set the Continue apiBase', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('continue');
      expect(plan.steps).toHaveLength(2);

      // The applier guarantees the backup automatically; the plan carries
      // backupRequired metadata instead of a duplicate mutation step.
      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep).toBeDefined();
      expect(editStep?.targetPath).toBe('/tmp/continue/config.json');
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.data.baseUrl).toBe(mockProfile.baseUrl);
      expect(editStep?.data.backupRequired).toBe(true);
      expect(editStep?.data.identity).toBe('AIdome Gateway');
      expect(editStep?.data.driver).toBe('yaml-model-array');

      const verifyStep = plan.steps.find(step => step.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should emit no duplicate backup step (applier owns backup)', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.find(step => step.action === 'backup-file')).toBeUndefined();
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps.find(step => step.action === 'edit-config-file')).toBeDefined();
    });

    it('should declare the yaml format when the config path is a YAML file', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep?.data.format).toBe('yaml');
    });
  });

  describe('verify', () => {
    it('should fail when the Continue config file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
      expect(result.details?.configPath).toBe('/tmp/continue/config.json');
    });

    it('should succeed when the Switchboard-managed entry matches the profile exactly', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'AIdome Gateway',
            provider: 'openai',
            model: 'legacy/model-1',
            apiBase: 'https://aidome.example.com/v1',
            apiKey: 'aid_pat_verify'
          }
        ]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.configPath).toBe('/tmp/continue/config.json');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should fail when the managed entry has no apiKey (Tier A credential contract)', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'AIdome Gateway',
            provider: 'openai',
            apiBase: 'https://aidome.example.com/v1'
          }
        ]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('no apiKey');
      expect(result.details?.configPath).toBeDefined();
    });

    it('should fail when the managed entry has only a whitespace apiKey', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'AIdome Gateway',
            provider: 'openai',
            apiBase: 'https://aidome.example.com/v1',
            apiKey: '   '
          }
        ]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('no apiKey');
    });

    it('should fail when the managed entry has no apiBase', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('no apiBase');
    });

    it('should fail closed when the expected profile URL is unknown', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai', apiBase: 'https://someone-else.example.com/v1' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('apply a profile first');
    });

    it('should fail when the managed entry apiBase does not match the profile', async () => {
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [{ title: 'AIdome Gateway', provider: 'openai', apiBase: 'https://stale.example.com/v1' }]
      }));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not match');
    });

    it('should fail when an unrelated OpenAI model exists but no AIdome entry does', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
        models: [
          {
            title: 'User own model',
            provider: 'openai',
            model: 'gpt-4o-mini',
            apiBase: 'https://api.openai.com/v1'
          }
        ]
      }));

      const result = await adapter.verify();

      // An unrelated OpenAI model with an apiBase is NOT a configured state.
      expect(result.success).toBe(false);
      expect(result.message).toContain('AIdome Gateway');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should parse YAML config for a .yaml path', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      await adapter.buildPlan(mockProfile);
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(
        'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://aidome.example.com/v1\n    model: legacy/model-1\n    apiKey: aid_pat_verify\n'
      );

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.format).toBe('yaml');
      expect(result.details?.modelCount).toBe(1);
    });

    it('should fail YAML config without apiBase', async () => {
      vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.yaml');
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('models:\n  - name: Other\n    provider: openai\n');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.format).toBe('yaml');
    });

    it('should fail gracefully when reading the Continue config throws', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockRejectedValue(new Error('read failed'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying Continue.dev config');
      expect(result.details?.error).toBe('read failed');
    });
  });

  describe('apply', () => {
    it('should resolve without mutating the plan', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      await expect(adapter.apply(plan)).resolves.toBeUndefined();
    });
  });

  describe('getDisplayName', () => {
    it('should return the Continue display name', () => {
      expect(adapter.getDisplayName()).toBe('Continue.dev');
    });
  });

  describe('getTier', () => {
    it('should return tier A', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});

describe('ContinueAdapter with missing descriptor', () => {
  it('fails fast when the provider descriptor is unavailable', async () => {
    vi.resetModules();
    vi.doMock('../../src/core/providerConfig/descriptors', () => ({
      getProviderConfigDescriptor: () => undefined
    }));
    const { ContinueAdapter: FallbackAdapter } = await import('../../src/adapters/continue/adapter');
    const fallback = new FallbackAdapter();

    const fallbackProfile: EndpointProfile = {
      id: 'fallback-profile',
      name: 'Fallback Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await expect(fallback.buildPlan(fallbackProfile)).rejects.toThrow('Continue provider descriptor is missing');

    vi.doUnmock('../../src/core/providerConfig/descriptors');
    vi.resetModules();
  });
});

describe('ContinueAdapter multi-model gateway entries', () => {
  let mockProfileLocal: () => EndpointProfile;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileLocal = () => ({
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  it('passes discovered gateway models into the plan step data', async () => {
    const discovery = await import('../../src/core/providerConfig/modelDiscovery');
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([
      { id: 'anthropic/claude-sonnet-4-6', name: 'Sonnet' },
      { id: 'z-ai/glm-5.3', name: 'GLM' }
    ]);

    const adapter = new ContinueAdapter();
    const plan = await adapter.buildPlan(mockProfileLocal());

    const editStep = plan.steps.find(step => step.action === 'edit-config-file');
    expect(editStep).toBeDefined();
    expect(editStep?.data.gatewayModels).toEqual([
      'anthropic/claude-sonnet-4-6',
      'z-ai/glm-5.3'
    ]);
  });

  it('falls back to cached capabilities models only when the live lookup fails', async () => {
    // Network-first: the cache has no expiry and does not invalidate on
    // URL/token changes, so it must only fill in for a failed live lookup
    // (Codex 157 round 5).
    const discovery = await import('../../src/core/providerConfig/modelDiscovery');
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([]);
    const profile = {
      ...mockProfileLocal(),
      capabilitiesCache: {
        version: '1',
        supportedDialects: [],
        supportedModels: ['cached/model-1', 'cached/model-2'],
        features: [],
        endpoints: {}
      }
    };
    const adapter = new ContinueAdapter();
    const plan = await adapter.buildPlan(profile);
    const editStep = plan.steps.find(step => step.action === 'edit-config-file');
    expect(editStep?.data.gatewayModels).toEqual(['cached/model-1', 'cached/model-2']);
    expect(discovery.discoverOpenAiModels).toHaveBeenCalledTimes(1);

    // A fresh live result wins over the cache.
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([{ id: 'live/model-1', name: 'Live' }]);
    const plan2 = await adapter.buildPlan(profile);
    const editStep2 = plan2.steps.find(step => step.action === 'edit-config-file');
    expect(editStep2?.data.gatewayModels).toEqual(['live/model-1']);
  });

  it('resolves the profile token through profileSecrets for network discovery', async () => {
    const discovery = await import('../../src/core/providerConfig/modelDiscovery');
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([
      { id: 'm/a', name: 'A' }
    ]);
    const getSecret = vi.fn(async () => 'tok-from-storage');
    const adapter = new ContinueAdapter({
      profileSecrets: { getSecret }
    });
    const profile = {
      ...mockProfileLocal(),
      authRef: 'Test Profile'
    };
    await adapter.buildPlan(profile);
    expect(getSecret).toHaveBeenCalledWith('Test Profile');
    expect(discovery.discoverOpenAiModels).toHaveBeenCalledWith('https://aidome.example.com/v1', 'tok-from-storage');
  });

  it('falls back to the profile name for discovery credentials when authRef is absent', async () => {
    const discovery = await import('../../src/core/providerConfig/modelDiscovery');
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([
      { id: 'm/a', name: 'A' }
    ]);
    const getSecret = vi.fn(async () => 'tok-legacy-name');
    const adapter = new ContinueAdapter({
      profileSecrets: { getSecret }
    });
    const profile = mockProfileLocal(); // no authRef — legacy storage key
    await adapter.buildPlan(profile);
    expect(getSecret).toHaveBeenCalledWith('Test Profile');
    expect(discovery.discoverOpenAiModels).toHaveBeenCalledWith('https://aidome.example.com/v1', 'tok-legacy-name');
  });

  it('fails closed with guidance when discovery returns nothing', async () => {
    const discovery = await import('../../src/core/providerConfig/modelDiscovery');
    vi.mocked(discovery.discoverOpenAiModels).mockResolvedValue([]);

    const adapter = new ContinueAdapter();
    const plan = await adapter.buildPlan(mockProfileLocal());

    // A model-less entry is rejected by Continue, so the plan must NOT
    // contain a configuration mutation for it (Codex 157 round 2).
    expect(plan.steps.find(step => step.action === 'edit-config-file')).toBeUndefined();
    const guided = plan.steps.find(step => step.action === 'show-guided-steps');
    expect(guided).toBeDefined();
    expect(String(guided?.data.message)).toContain('No models were discovered');
  });

  it('verification accepts per-model managed entries and requires apiBase + apiKey', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(
      'models:\n' +
      '  - name: AIdome Gateway - anthropic/claude-sonnet-4-6\n    title: anthropic/claude-sonnet-4-6\n    model: anthropic/claude-sonnet-4-6\n    provider: openai\n    apiBase: https://aidome.example.com/v1\n    apiKey: sk-test\n' +
      '  - name: AIdome Gateway - z-ai/glm-5.3\n    title: z-ai/glm-5.3\n    model: z-ai/glm-5.3\n    provider: openai\n    apiBase: https://aidome.example.com/v1\n    apiKey: sk-test\n'
    );
    // js-yaml style YAML path: configPath ends with .yaml is mocked as .json above;
    // parseContinueModels handles jsonc — use a JSON body instead for the .json path.
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        { name: 'AIdome Gateway - anthropic/claude-sonnet-4-6', title: 'anthropic/claude-sonnet-4-6', model: 'anthropic/claude-sonnet-4-6', provider: 'openai', apiBase: 'https://aidome.example.com/v1', apiKey: 'sk-test', aidomeManaged: true },
        { name: 'AIdome Gateway - z-ai/glm-5.3', title: 'z-ai/glm-5.3', model: 'z-ai/glm-5.3', provider: 'openai', apiBase: 'https://aidome.example.com/v1', apiKey: 'sk-test', aidomeManaged: true }
      ]
    }));

    const adapter = new ContinueAdapter();
    await adapter.buildPlan(mockProfileLocal());
    // verify is protected; exercise via the public verify path if exposed, else via verifyConfiguration through plan apply is out of scope here.
    const verify = (adapter as unknown as { verifyConfiguration(): Promise<{ success: boolean; details?: Record<string, unknown> }> }).verifyConfiguration();
    const result = await verify;
    expect(result.success).toBe(true);
    expect(result.details?.managedEntries).toBe(2);
  });
});

describe('ContinueAdapter verification requires the model field', () => {
  it('fails when a managed entry has apiBase and apiKey but no model id', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        { name: 'AIdome Gateway - m/a', title: 'm/a', model: 'm/a', provider: 'openai', apiBase: 'https://aidome.example.com/v1', apiKey: 'sk-test', aidomeManaged: true },
        { name: 'AIdome Gateway - m/b', title: 'm/b', model: '', provider: 'openai', apiBase: 'https://aidome.example.com/v1', apiKey: 'sk-test', aidomeManaged: true }
      ]
    }));

    const adapter = new ContinueAdapter();
    await adapter.buildPlan({
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const result = await (adapter as unknown as {
      verifyConfiguration(): Promise<{ success: boolean; message: string; details?: Record<string, unknown> }>;
    }).verifyConfiguration();

    expect(result.success).toBe(false);
    expect(result.message).toContain('no model id configured');
  });
});

describe('ContinueAdapter verification ignores unmarked prefix collisions', () => {
  it('does not treat a user entry colliding with the prefix as managed', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        // User's own entry: colliding name, foreign endpoint — NOT ours.
        { name: 'AIdome Gateway - my-custom-model', title: 'my-custom-model', model: 'my-custom-model', provider: 'openai', apiBase: 'https://api.openai.com/v1', apiKey: 'user-key' },
        // The one entry Switchboard actually wrote: valid.
        { name: 'AIdome Gateway - m/a', title: 'm/a', model: 'm/a', provider: 'openai', apiBase: 'https://aidome.example.com/v1', apiKey: 'sk-test', aidomeManaged: true }
      ]
    }));

    const adapter = new ContinueAdapter();
    await adapter.buildPlan({
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    const result = await (adapter as unknown as {
      verifyConfiguration(): Promise<{ success: boolean; details?: Record<string, unknown> }>;
    }).verifyConfiguration();

    expect(result.success).toBe(true);
    expect(result.details?.managedEntries).toBe(1);
  });
});

describe('ContinueAdapter verification completeness', () => {
  let adapter: ContinueAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new ContinueAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      profileType: 'custom',
      baseUrl: 'https://aidome.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.spyOn(continuePaths, 'getContinueConfigPath').mockReturnValue('/tmp/continue/config.json');
  });

  it('fails verification when a discovered gateway model has no managed entry', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' },
      { id: 'legacy/model-2', name: 'Model 2' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - legacy/model-1',
          provider: 'openai',
          model: 'legacy/model-1',
          apiBase: mockProfile.baseUrl,
          apiKey: 'pat-token',
          aidomeManaged: true
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.message).toContain('missing 1 AIdome Gateway model entry');
    expect((result.details as Record<string, unknown>).missingModels).toEqual(['legacy/model-2']);
  });

  it('passes verification when every discovered model has a managed entry', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' },
      { id: 'legacy/model-2', name: 'Model 2' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    const entry = (model: string) => ({
      title: `AIdome Gateway - ${model}`,
      provider: 'openai',
      model,
      apiBase: mockProfile.baseUrl,
      apiKey: 'pat-token',
      aidomeManaged: true
    });
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [entry('legacy/model-1'), entry('legacy/model-2')]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(true);
  });

  it('does not fail verification when verify-time discovery fails after a successful plan', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' },
      { id: 'legacy/model-2', name: 'Model 2' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    // The gateway was reachable at plan time but is down at verify time:
    // the completeness check must not flag a healthy configuration.
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockRejectedValue(new Error('gateway down'));
    const entry = (model: string) => ({
      title: `AIdome Gateway - ${model}`,
      provider: 'openai',
      model,
      apiBase: mockProfile.baseUrl,
      apiKey: 'pat-token',
      aidomeManaged: true
    });
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [entry('legacy/model-1'), entry('legacy/model-2')]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(true);
  });

  it('reports every missing model in the plural message', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' },
      { id: 'legacy/model-2', name: 'Model 2' },
      { id: 'legacy/model-3', name: 'Model 3' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - legacy/model-1',
          provider: 'openai',
          model: 'legacy/model-1',
          apiBase: mockProfile.baseUrl,
          apiKey: 'pat-token',
          aidomeManaged: true
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.message).toContain('missing 2 AIdome Gateway model entries');
  });

  it('skips the completeness check when discovery returns no models at verify time', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([] as never);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - legacy/model-1',
          provider: 'openai',
          model: 'legacy/model-1',
          apiBase: mockProfile.baseUrl,
          apiKey: 'pat-token',
          aidomeManaged: true
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(true);
  });

  it('treats a marker-stripped exact-shape gateway entry as managed', async () => {
    // Continue's config editor strips the aidomeManaged marker when it
    // rewrites the file; the exact name shape at the gateway URL must
    // still count as ours for verification.
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockResolvedValue([
      { id: 'legacy/model-1', name: 'Model 1' }
    ] as never);
    await adapter.buildPlan(mockProfile);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - legacy/model-1',
          provider: 'openai',
          model: 'legacy/model-1',
          apiBase: mockProfile.baseUrl,
          apiKey: 'pat-token'
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(true);
  });

  it('does not treat a prefix-shaped entry without a marker or apiBase as managed', async () => {
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - my-custom-model',
          provider: 'openai',
          model: 'my-custom-model'
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(false);
    expect(result.message).toContain('no AIdome Gateway model entry');
  });

  it('does not fail verification when discovery is unavailable', async () => {
    vi.mocked(modelDiscoveryMock.discoverOpenAiModels).mockRejectedValue(new Error('gateway down'));
    await adapter.buildPlan(mockProfile);
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(JSON.stringify({
      models: [
        {
          title: 'AIdome Gateway - legacy/model-1',
          provider: 'openai',
          model: 'legacy/model-1',
          apiBase: mockProfile.baseUrl,
          apiKey: 'pat-token',
          aidomeManaged: true
        }
      ]
    }));

    const result = await adapter.verify();

    expect(result.success).toBe(true);
  });
});
