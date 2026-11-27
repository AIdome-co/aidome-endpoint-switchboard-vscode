/**
 * Codex model catalog coverage: the adapter must automatically write a Codex
 * model catalog (~/.codex/models.json, CODEX_HOME aware) derived from
 * discovered gateway models as part of the standard assign plan, bind
 * top-level `model_catalog_json` in config.toml, remove a stale key when no
 * catalog is produced, and keep backup/rollback semantics for both files.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CodexAdapter } from '../../src/adapters/codex/adapter';
import { getCodexModelsCatalogPath, getCodexConfigPath } from '../../src/adapters/codex/codexConfigPatcher';
import { buildCodexModelCatalog } from '../../src/adapters/codex/modelCatalog';
import { renderConfigFileContent } from '../../src/core/providerConfig/drivers';
import { parse as parseToml } from 'smol-toml';
import { PlanApplier } from '../../src/core/orchestration/applier';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import type { DiscoveredModel } from '../../src/core/providerConfig/modelDiscovery';

const mockHttpRequest = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      update: vi.fn()
    }))
  },
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn()
    })),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn()
  }
}));

vi.mock('../../src/util/http', () => ({
  httpRequest: mockHttpRequest
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn()
    })
  }
}));

describe('buildCodexModelCatalog', () => {
  it('maps discovered models to full upstream ModelInfo entries', () => {
    const models: DiscoveredModel[] = [
      { id: 'gateway-large', name: 'Gateway Large', contextWindow: 200_000, capabilities: ['tools'] }
    ];

    const { models: entries } = buildCodexModelCatalog(models);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      slug: 'gateway-large',
      display_name: 'Gateway Large',
      visibility: 'list',
      shell_type: 'unified_exec',
      supported_in_api: true,
      priority: 1,
      context_window: 200_000,
      max_context_window: 200_000,
      truncation_policy: { mode: 'bytes', limit: 10_000 }
    });
  });

  it('falls back to a safe context window and the id as display name', () => {
    const { models: entries } = buildCodexModelCatalog([{ id: 'm1', name: '' }]);
    expect(entries[0].context_window).toBe(272_000);
    expect(entries[0].max_context_window).toBe(272_000);
    expect(entries[0].display_name).toBe('m1');
  });

  it('excludes bundled OpenAI gpt-* models and dedupes/ignores empty slugs', () => {
    const { models: entries } = buildCodexModelCatalog([
      { id: 'gpt-5.6-sol', name: 'gpt-5.6-sol' },
      { id: 'gateway-a', name: 'A' },
      { id: 'gateway-a', name: 'A duplicate' },
      { id: '   ', name: 'blank' }
    ] as DiscoveredModel[]);

    expect(entries.map(entry => entry.slug)).toEqual(['gateway-a']);
    expect(new Set(entries.map(entry => entry.slug)).size).toBe(entries.length);
  });

  it('is deterministic (byte-stable output for the same models)', () => {
    const models: DiscoveredModel[] = [
      { id: 'gateway-b', name: 'B', contextWindow: 128_000 },
      { id: 'gateway-a', name: 'A' }
    ];

    expect(JSON.stringify(buildCodexModelCatalog(models)))
      .toBe(JSON.stringify(buildCodexModelCatalog(models)));
  });
});

describe('Codex model catalog path resolution', () => {
  const originalConfigPath = process.env.CODEX_CONFIG_PATH;
  const originalCodexHome = process.env.CODEX_HOME;

  afterEach(() => {
    process.env.CODEX_CONFIG_PATH = originalConfigPath;
    process.env.CODEX_HOME = originalCodexHome;
  });

  it('honors CODEX_HOME for the catalog path', () => {
    delete process.env.CODEX_CONFIG_PATH;
    process.env.CODEX_HOME = path.join('/tmp', 'codex-home');
    expect(getCodexModelsCatalogPath()).toBe(path.join('/tmp', 'codex-home', 'models.json'));
    expect(getCodexConfigPath()).toBe(path.join('/tmp', 'codex-home', 'config.toml'));
  });

  it('stays coherent with an explicit CODEX_CONFIG_PATH', () => {
    process.env.CODEX_CONFIG_PATH = path.join('/tmp', 'codex-home', 'deep', 'config.toml');
    expect(getCodexModelsCatalogPath()).toBe(path.join('/tmp', 'codex-home', 'deep', 'models.json'));
  });
});

describe('CodexAdapter model catalog plan behavior', () => {
  let tempDir: string;
  let configPath: string;
  let adapter: CodexAdapter;
  let profile: EndpointProfile;
  const originalConfigPath = process.env.CODEX_CONFIG_PATH;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-catalog-'));
    process.env.CODEX_CONFIG_PATH = path.join(tempDir, 'config.toml');
    configPath = getCodexConfigPath();
    adapter = new CodexAdapter({
      profileSecrets: { getSecret: async () => 'profile-secret' }
    });
    profile = {
      id: 'profile-1',
      name: 'Profile 1',
      baseUrl: 'https://gateway.example.com/v1',
      authRef: 'Profile 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    mockHttpRequest.mockReset();
  });

  afterEach(async () => {
    process.env.CODEX_CONFIG_PATH = originalConfigPath;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('includes a catalog write step and binds model_catalog_json when models are discovered', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: {
        data: [
          { id: 'gateway-large', display_name: 'Gateway Large' },
          { id: 'gateway-small' }
        ]
      }
    });

    const plan = await adapter.buildPlan(profile);
    const catalogStep = plan.steps.find(step => step.data?.configType === 'codex-model-catalog');

    expect(catalogStep).toBeDefined();
    expect(catalogStep?.action).toBe('edit-config-file');
    expect(catalogStep?.targetPath).toBe(getCodexModelsCatalogPath());
    expect(catalogStep?.data.backupRequired).toBe(true);
    expect(catalogStep?.data.driver).toBe('json-object');

    const entries = catalogStep?.data.patches[0].value;
    expect(entries.map((entry: { slug: string }) => entry.slug)).toEqual(['gateway-large', 'gateway-small']);
    expect(entries.every((entry: { visibility: string }) => entry.visibility === 'list')).toBe(true);

    const configStep = plan.steps.find(step => step.action === 'edit-config-file' && step.data?.driver === 'toml-table');
    expect(configStep?.data.modelCatalogJson).toBe(getCodexModelsCatalogPath());

    // No secrets in the plan (or therefore in the catalog file it writes).
    expect(JSON.stringify(plan)).not.toContain('profile-secret');
  });

  it('writes no catalog and removes a stale model_catalog_json key when discovery is empty', async () => {
    mockHttpRequest.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: { data: [] } });

    const plan = await adapter.buildPlan(profile);

    expect(plan.steps.find(step => step.data?.configType === 'codex-model-catalog')).toBeUndefined();
    const configStep = plan.steps.find(step => step.data?.driver === 'toml-table');
    expect(configStep?.data.modelCatalogJson).toBeUndefined();
    expect(configStep?.data.removeModelCatalogJson).toBe(true);
  });

  it('keeps the existing catalog binding untouched when the discovery request fails', async () => {
    // A transient network failure is NOT an empty catalog: collapsing it into
    // [] would emit removeModelCatalogJson and unbind a working catalog.
    mockHttpRequest.mockRejectedValue(new Error('connection reset'));

    const plan = await adapter.buildPlan(profile);

    expect(plan.steps.find(step => step.data?.configType === 'codex-model-catalog')).toBeUndefined();
    const configStep = plan.steps.find(step => step.data?.driver === 'toml-table');
    expect(configStep?.data.modelCatalogJson).toBeUndefined();
    expect(configStep?.data.removeModelCatalogJson).toBeUndefined();
  });

  it('keeps the existing catalog binding when discovery returns a malformed body', async () => {
    mockHttpRequest.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: { data: 'not-an-array' } });

    const plan = await adapter.buildPlan(profile);

    const configStep = plan.steps.find(step => step.data?.driver === 'toml-table');
    expect(configStep?.data.removeModelCatalogJson).toBeUndefined();
  });

  it('writes no catalog and no model binding when discovery returns only bundled gpt-* models', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { data: [{ id: 'gpt-5.6-sol' }, { id: 'gpt-6.2-astra' }] }
    });

    const plan = await adapter.buildPlan(profile);

    // An all-`gpt-*` discovery yields an EMPTY catalog, and an empty catalog
    // file fails Codex startup — so no catalog file, no binding, no model.
    expect(plan.steps.find(step => step.data?.configType === 'codex-model-catalog')).toBeUndefined();
    const configStep = plan.steps.find(step => step.data?.driver === 'toml-table');
    expect(configStep?.data.modelCatalogJson).toBeUndefined();
    expect(configStep?.data.removeModelCatalogJson).toBe(true);
    expect(configStep?.data.model).toBeUndefined();
  });

  it('applies both files with backups, binds the catalog, and is byte-stable on re-apply', async () => {
    mockHttpRequest.mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { data: [{ id: 'gateway-large', display_name: 'Gateway Large' }] }
    });

    const state = new Map<string, unknown>();
    const context = {
      globalState: {
        get: <T>(key: string, defaultValue: T): T => (state.has(key) ? state.get(key) as T : defaultValue),
        update: async (key: string, value: unknown): Promise<void> => {
          state.set(key, value);
        }
      },
      secrets: {
        get: async (key: string): Promise<string | undefined> =>
          key === 'aidome.switchboard.auth.Profile 1' ? 'profile-secret' : undefined
      }
    };

    const plan1 = await adapter.buildPlan(profile);
    const applier = new PlanApplier(context as never);
    const result1 = await applier.applyPlan(plan1, profile.name);
    expect(result1.success).toBe(true);

    const catalogPath = getCodexModelsCatalogPath();
    const firstCatalog = await fs.readFile(catalogPath, 'utf8');
    const firstConfig = await fs.readFile(configPath, 'utf8');

    const parsedCatalog = JSON.parse(firstCatalog) as { models: Array<Record<string, unknown>> };
    expect(parsedCatalog.models.map(entry => entry.slug)).toEqual(['gateway-large']);
    // Parse the TOML instead of substring matching: backslashes in the path
    // are escaped differently on Windows.
    const parsedConfig = parseToml(firstConfig) as { model_catalog_json?: string };
    expect(parsedConfig.model_catalog_json).toBe(catalogPath);

    // Second apply: both files exist now, so both get backup-before-modify.
    const plan2 = await adapter.buildPlan(profile);
    const applier2 = new PlanApplier(context as never);
    const result2 = await applier2.applyPlan(plan2, profile.name);
    expect(result2.success).toBe(true);
    expect(result2.changeLogEntry.steps.filter(step => Boolean(step.backupPath)).length).toBeGreaterThanOrEqual(2);
    expect(await fs.readFile(catalogPath, 'utf8')).toBe(firstCatalog);
    expect(await fs.readFile(configPath, 'utf8')).toBe(firstConfig);

    // Rollback restores both files.
    await applier2.rollbackPlan(result2.changeLogEntry.id);
    const rolledBackCatalog = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as { models: unknown[] };
    expect(rolledBackCatalog.models).toEqual(parsedCatalog.models);
    const rolledBackConfig = parseToml(await fs.readFile(configPath, 'utf8')) as { model_catalog_json?: string };
    expect(rolledBackConfig.model_catalog_json).toBe(catalogPath);
  });

  it('applies the stale-key removal when no models are discovered', async () => {
    await fs.writeFile(
      configPath,
      'model_provider = "aidome"\nmodel_catalog_json = "/tmp/stale/models.json"\n\n[model_providers.aidome]\nname = "aidome"\nbase_url = "https://old.example.com/v1"\nwire_api = "responses"\nenv_key = "OPENAI_API_KEY"\n',
      'utf8'
    );
    mockHttpRequest.mockResolvedValue({ status: 200, statusText: 'OK', headers: {}, body: { data: [] } });

    const context = {
      globalState: {
        get: <T>(key: string, defaultValue: T): T => {
          if (key === 'aidome.changeLog') {
            return [] as unknown as T;
          }
          return defaultValue;
        },
        update: async (): Promise<void> => {}
      },
      secrets: { get: async (): Promise<string | undefined> => undefined }
    };
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier(context as never);
    const result = await applier.applyPlan(plan, profile.name);
    expect(result.success).toBe(true);

    const config = await fs.readFile(configPath, 'utf8');
    expect(config).not.toContain('model_catalog_json');
    expect(await fs.access(path.join(tempDir, 'models.json')).then(() => true, () => false)).toBe(false);
  });
});

describe('Codex TOML driver model_catalog_json binding', () => {
  const baseData = {
    driver: 'toml-table' as const,
    providerName: 'aidome',
    wireApi: 'responses' as const,
    envKey: 'OPENAI_API_KEY'
  };

  it('sets a top-level model_catalog_json path', () => {
    const output = renderConfigFileContent({
      baseUrl: 'https://gateway.example.com/v1',
      existingContent: 'model_provider = "aidome"\n',
      options: { ...baseData, modelCatalogJson: '/home/user/.codex/models.json' }
    } as never);

    expect(output).toContain('model_catalog_json = "/home/user/.codex/models.json"');
  });

  it('removes a stale model_catalog_json key', () => {
    const output = renderConfigFileContent({
      baseUrl: 'https://gateway.example.com/v1',
      existingContent: 'model_catalog_json = "/tmp/stale.json"\nmodel_provider = "aidome"\n',
      options: { ...baseData, removeModelCatalogJson: true }
    } as never);

    expect(output).not.toContain('model_catalog_json');
    expect(output).toContain('model_provider = "aidome"');
  });

  it('is idempotent for repeated applies', () => {
    const once = renderConfigFileContent({
      baseUrl: 'https://gateway.example.com/v1',
      existingContent: 'model_provider = "aidome"\n',
      options: { ...baseData, modelCatalogJson: '/home/user/.codex/models.json' }
    } as never);
    const twice = renderConfigFileContent({
      baseUrl: 'https://gateway.example.com/v1',
      existingContent: once,
      options: { ...baseData, modelCatalogJson: '/home/user/.codex/models.json' }
    } as never);

    expect(twice).toBe(once);
  });
});
