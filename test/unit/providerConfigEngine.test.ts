/** Tests for the ProviderConfigEngine descriptor compiler. */

import { describe, it, expect } from 'vitest';
import {
  buildProviderConfigPlan,
} from '../../src/core/providerConfig/engine';
import {
  parseConfigDocument,
  verifyFileTarget,
  verifySettingValue,
} from '../../src/core/providerConfig/engineVerification';
import {
  getProviderConfigDescriptors,
} from '../../src/core/providerConfig/descriptors';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

const TEST_SECRET = 'aid_pat_never_in_plan';

function makeProfile(overrides: Partial<EndpointProfile> = {}): EndpointProfile {
  return {
    id: 'profile-1',
    name: 'Test Profile',
    profileType: 'custom',
    baseUrl: 'https://gateway.example.com',
    dialect: 'openai.chat_completions',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  } as EndpointProfile;
}

describe('ProviderConfigEngine.buildProviderConfigPlan', () => {
  it('compiles the Continue descriptor into a yaml-model-array step with stable identity', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'continue')!;
    const { plan, automaticTargetIds, guidedTargetIds } = buildProviderConfigPlan(descriptor, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'continue-primary-yaml': '/tmp/continue/config.yaml' }
    });

    expect(guidedTargetIds).toHaveLength(0);
    expect(automaticTargetIds).toEqual(['continue-primary-yaml']);

    const editStep = plan.steps.find(step => step.action === 'edit-config-file');
    expect(editStep).toBeDefined();
    expect(editStep?.targetPath).toBe('/tmp/continue/config.yaml');
    expect(editStep?.data).toMatchObject({
      driver: 'yaml-model-array',
      format: 'yaml',
      baseUrl: 'https://gateway.example.com/v1', // openai normalization from the descriptor
      identity: 'AIdome Gateway',
      provider: 'openai',
      backupRequired: true
    });
    // The unselected legacy target is skipped, not guided.
    expect(plan.steps.some(step => step.action === 'show-guided-steps')).toBe(false);
  });

  it('compiles the Codex descriptor into a toml-table step with optional discovered model', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const { plan } = buildProviderConfigPlan(descriptor, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'codex-config': '/tmp/codex/config.toml' },
      discoveredModels: ['gateway-model-a']
    });

    const editStep = plan.steps.find(step => step.action === 'edit-config-file');
    expect(editStep).toBeDefined();
    expect(editStep?.data).toMatchObject({
      driver: 'toml-table',
      format: 'toml',
      providerName: 'aidome',
      wireApi: 'responses',
      envKey: 'OPENAI_API_KEY',
      model: 'gateway-model-a',
      baseUrl: 'https://gateway.example.com/v1'
    });
  });

  it('omits the model binding when discovery found nothing (no invented default)', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const { plan } = buildProviderConfigPlan(descriptor, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'codex-config': '/tmp/codex/config.toml' }
    });

    const editStep = plan.steps.find(step => step.action === 'edit-config-file')!;
    expect(editStep.data.model).toBeUndefined();
    expect(JSON.stringify(editStep.data)).not.toContain('gpt-4');
  });

  it('compiles the Copilot descriptor into a vscode-setting step without URL normalization', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'github-copilot')!;
    const { plan } = buildProviderConfigPlan(descriptor, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'copilot-advanced': 'github.copilot.advanced.debug.overrideProxyUrl' }
    });

    const settingStep = plan.steps.find(step => step.action === 'set-vscode-setting');
    expect(settingStep).toBeDefined();
    expect(settingStep?.targetPath).toBe('github.copilot.advanced.debug.overrideProxyUrl');
    // Proxy contract: the profile URL is used verbatim, no /v1 normalization.
    expect(settingStep?.newValue).toBe('https://gateway.example.com');
  });

  it('emits guidance for unsupported providers without mutating anything', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'roo-code')!;
    const { plan, automaticTargetIds, guidedTargetIds } = buildProviderConfigPlan(descriptor, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'roo-retired': '/tmp/roo' }
    });

    expect(automaticTargetIds).toHaveLength(0);
    expect(guidedTargetIds).toEqual(['roo-retired']);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].action).toBe('show-guided-steps');
    expect(plan.steps.some(step => step.action === 'edit-config-file' || step.action === 'set-vscode-setting')).toBe(false);
  });

  it('rejects a TOML provider entry that declares an unsupported wire API', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const broken = {
      ...descriptor,
      plan: [{
        targetId: 'codex-config',
        operations: [{
          type: 'upsert-map-entry' as const,
          path: ['model_providers'],
          entryKey: 'aidome',
          fields: [
            { path: ['wire_api'], value: { type: 'literal' as const, value: 'chat' } }
          ]
        }]
      }]
    };

    expect(() => buildProviderConfigPlan(broken, {
      profile: makeProfile(),
      resolvedTargetPaths: { 'codex-config': '/tmp/codex/config.toml' }
    })).toThrow('unsupported wire API');
  });

  it('never serializes secret material into the plan', () => {
    for (const descriptor of getProviderConfigDescriptors()) {
      if (descriptor.support !== 'automatic') {
        continue;
      }
      const { plan } = buildProviderConfigPlan(descriptor, {
        profile: { ...makeProfile(), authRef: 'profile-secret-ref' },
        resolvedTargetPaths: Object.fromEntries(
          descriptor.targets.map(target => [target.id, `/tmp/${target.id}`])
        )
      });
      const serialized = JSON.stringify(plan);
      expect(serialized).not.toContain(TEST_SECRET);
      expect(serialized).not.toContain('profile-secret-value');
    }
  });

  it('contains no provider-name branching in the engine module source', async () => {
    // Architectural guard: the engine must not special-case providers.
    const { readFileSync } = await import('fs');
    const source = readFileSync('src/core/providerConfig/engine.ts', 'utf-8');
    for (const providerKey of getProviderConfigDescriptors().map(d => d.providerKey)) {
      expect(source.includes(`'${providerKey}'`)).toBe(false);
    }
  });
});

describe('descriptor-driven verification', () => {
  it('verifies the Codex TOML contract against the active profile', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const parsedDoc = parseConfigDocument(
      'model_provider = "aidome"\nmodel = "gateway-model"\n\n[model_providers.aidome]\nname = "aidome"\nbase_url = "https://gateway.example.com/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n\n[model_providers.other]\nbase_url = "https://other.example/v1"\n',
      'toml'
    );
    expect(parsedDoc.ok).toBe(true);
    const result = verifyFileTarget(descriptor, {
      parsed: parsedDoc.ok ? parsedDoc.parsed : undefined,
      profileBaseUrl: 'https://gateway.example.com',
      discoveredModelId: 'gateway-model'
    });

    expect(result.success).toBe(true);
    expect(result.details.checkedOperations).toBeGreaterThan(0);
  });

  it('fails when the Codex selected provider does not match the managed entry', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const parsedDoc = parseConfigDocument(
      'model_provider = "other"\n\n[model_providers.aidome]\nbase_url = "https://gateway.example.com/v1"\nwire_api = "responses"\n',
      'toml'
    );
    expect(parsedDoc.ok).toBe(true);
    const result = verifyFileTarget(descriptor, {
      parsed: parsedDoc.ok ? parsedDoc.parsed : undefined,
      profileBaseUrl: 'https://gateway.example.com'
    });

    expect(result.success).toBe(false);
    expect(result.details.failures).toContainEqual(expect.stringContaining('model_provider'));
  });

  it('fails when the configured URL does not match the expected profile URL', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'openai-codex')!;
    const parsedDoc = parseConfigDocument(
      'model_provider = "aidome"\n\n[model_providers.aidome]\nbase_url = "https://stale.example.com/v1"\nwire_api = "responses"\n',
      'toml'
    );
    expect(parsedDoc.ok).toBe(true);
    const result = verifyFileTarget(descriptor, {
      parsed: parsedDoc.ok ? parsedDoc.parsed : undefined,
      profileBaseUrl: 'https://gateway.example.com'
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain('does not match the active profile');
  });

  it('verifies the Continue model identity entry', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'continue')!;
    const parsedDoc = parseConfigDocument(
      'models:\n  - name: User own\n    provider: openai\n    apiBase: https://api.openai.com/v1\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://gateway.example.com/v1\n',
      'yaml'
    );
    expect(parsedDoc.ok).toBe(true);
    const result = verifyFileTarget(descriptor, {
      parsed: parsedDoc.ok ? parsedDoc.parsed : undefined,
      profileBaseUrl: 'https://gateway.example.com'
    });

    expect(result.success).toBe(true);
  });

  it('fails when the Continue managed entry is missing or stale', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'continue')!;
    const parsedDoc = parseConfigDocument(
      'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://stale.example.com/v1\n',
      'yaml'
    );
    expect(parsedDoc.ok).toBe(true);
    const result = verifyFileTarget(descriptor, {
      parsed: parsedDoc.ok ? parsedDoc.parsed : undefined,
      profileBaseUrl: 'https://gateway.example.com'
    });

    expect(result.success).toBe(false);
  });

  it('verifies the Copilot setting value with the proxy contract (no normalization)', () => {
    const descriptor = getProviderConfigDescriptors().find(d => d.providerKey === 'github-copilot')!;

    const ok = verifySettingValue(descriptor, {
      configuredValue: 'https://gateway.example.com',
      profileBaseUrl: 'https://gateway.example.com'
    });
    expect(ok.success).toBe(true);

    const stale = verifySettingValue(descriptor, {
      configuredValue: 'https://stale.example.com',
      profileBaseUrl: 'https://gateway.example.com'
    });
    expect(stale.success).toBe(false);
  });
});
