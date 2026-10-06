/**
 * Golden regression tests for the Cline adapter's file-backed provider
 * configuration — locking CURRENT behavior before the provider execution
 * abstraction refactor.
 *
 * These tests apply the adapter's real plan through the real PlanApplier
 * against real files under a temp CLINE_DATA_DIR. Only orchestration
 * boundaries (Logger, vscode, ProfileSecrets, ChangeLog, output UI) are
 * mocked; fs and the JSON drivers run for real.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const {
  mockGetSecret,
  mockHttpRequest,
  mockShowWarning,
  logCapture
} = vi.hoisted(() => ({
  mockGetSecret: vi.fn(),
  mockHttpRequest: vi.fn(),
  mockShowWarning: vi.fn(),
  logCapture: [] as { level: string; args: unknown[] }[]
}));

vi.mock('vscode', () => ({
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })) },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(() => Promise.resolve(undefined))
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  env: { clipboard: { writeText: vi.fn() } },
  ExtensionContext: class {}
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      debug: (...args: unknown[]) => { logCapture.push({ level: 'debug', args }); },
      info: (...args: unknown[]) => { logCapture.push({ level: 'info', args }); },
      warning: (...args: unknown[]) => { logCapture.push({ level: 'warning', args }); },
      error: (...args: unknown[]) => { logCapture.push({ level: 'error', args }); }
    }),
    initialize: vi.fn()
  }
}));

vi.mock('../../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: class {
    constructor(_context: unknown) {}
    getSecret = mockGetSecret;
    storeSecret = vi.fn();
    deleteSecret = vi.fn();
  }
}));

vi.mock('../../../src/core/orchestration/changeLog', () => ({
  ChangeLog: class {
    recordApply = vi.fn().mockResolvedValue(undefined);
    getEntries = vi.fn().mockResolvedValue([]);
    removeEntry = vi.fn().mockResolvedValue(undefined);
  }
}));

vi.mock('../../../src/ui/output', () => ({
  getOutputChannel: () => ({ appendLine: vi.fn(), show: vi.fn(), clear: vi.fn() })
}));

vi.mock('../../../src/ui/notifications', () => ({
  showWarning: mockShowWarning
}));

vi.mock('../../../src/util/http', () => ({
  httpRequest: mockHttpRequest
}));

import { ClineAdapter } from '../../../src/adapters/cline/adapter';
import { getClineConfigPaths } from '../../../src/adapters/cline/clineConfigPatcher';
import { PlanApplier } from '../../../src/core/orchestration/applier';
import { EndpointProfile } from '../../../src/core/profiles/profileTypes';
import { Plan } from '../../../src/core/orchestration/planBuilder';

// Synthetic secret — never a real credential.
const SECRET = 'sk-golden-synthetic-token-7f3a91c2';

function makeProfile(): EndpointProfile {
  return {
    id: 'profile-golden',
    name: 'Golden Profile',
    profileType: 'custom',
    baseUrl: 'https://gateway.example.com/v1',
    dialect: 'openai.chat_completions',
    authRef: 'profile-golden',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

const PROVIDERS_SEED = {
  version: 1,
  modes: { voiceInput: { providerId: 'anthropic', modelId: 'claude-3' } },
  lastUsedProvider: 'anthropic',
  providers: {
    anthropic: {
      settings: { provider: 'anthropic', apiKey: 'anthropic-keep-me' },
      updatedAt: '2026-08-01T00:00:00.000Z',
      tokenSource: 'manual'
    },
    'unrelated-org': {
      settings: { provider: 'unrelated-org', apiKey: 'other-keep-me' },
      updatedAt: '2026-07-01T00:00:00.000Z'
    },
    'openai-compatible': {
      settings: {
        provider: 'openai-compatible',
        apiKey: 'old-compat-key',
        model: 'keep-this-model',
        baseUrl: 'https://old.example/v1',
        customUnrelatedField: 'preserve-me'
      },
      updatedAt: '2026-08-01T00:00:00.000Z',
      tokenSource: 'manual',
      customUnrelatedMeta: 'meta-preserve-me'
    }
  }
};

const GLOBAL_STATE_SEED = {
  unrelatedSetting: true,
  unrelatedNested: { deep: 'value' },
  openAiBaseUrl: 'https://old.example/v1',
  planModeApiProvider: 'anthropic',
  actModeApiProvider: 'anthropic',
  actModeOpenAiModelId: 'keep-this-model'
};

const MODELS_SEED = {
  version: 1,
  unrelatedTopLevel: 'catalog-preserve-me',
  providers: {
    'unrelated-org': {
      provider: { name: 'Unrelated Org', baseUrl: 'https://other.example/v1' },
      models: { 'other-model': { id: 'other-model', name: 'Other Model' } }
    },
    'openai-compatible': {
      provider: { name: 'Old Name', baseUrl: 'https://old.example/v1' },
      legacyModels: { 'legacy-model': { id: 'legacy-model' } }
    }
  }
};

const SECRETS_SEED = {
  unrelatedSecretKey: 'unrelated-secret-value',
  openAiApiKey: 'old-mirror-key'
};

async function seedStores(dataDir: string, opts: { secrets?: boolean; providers?: unknown; globalState?: unknown; models?: unknown } = {}): Promise<void> {
  const paths = getClineConfigPaths();
  mkdirSync(path.dirname(paths.providerSettingsPath), { recursive: true });
  writeFileSync(paths.providerSettingsPath, JSON.stringify(opts.providers ?? PROVIDERS_SEED, null, 2) + '\n', 'utf-8');
  writeFileSync(paths.globalStatePath, JSON.stringify(opts.globalState ?? GLOBAL_STATE_SEED, null, 2) + '\n', 'utf-8');
  writeFileSync(paths.modelCatalogPath, JSON.stringify(opts.models ?? MODELS_SEED, null, 2) + '\n', 'utf-8');
  if (opts.secrets !== false) {
    writeFileSync(paths.secretsMirrorPath, JSON.stringify(opts.secrets ?? SECRETS_SEED, null, 2) + '\n', 'utf-8');
  }
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function listFilesRecursively(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursively(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/** Applies a plan, injecting a hard failure after the model catalog step. */
function injectFailure(plan: Plan, action: string, where: 'after-catalog' | 'after-providers'): void {
  const step = {
    id: `injected-${action}`,
    action: action as never,
    description: 'injected golden failure',
    assistantKey: 'cline',
    targetPath: 'injected.target',
    newValue: 'irrelevant',
    data: {},
    reversible: true
  };
  if (where === 'after-catalog') {
    plan.steps.push(step);
  } else {
    const idx = plan.steps.findIndex((s) => s.targetPath === getClineConfigPaths().globalStatePath && s.action === 'edit-config-file');
    plan.steps.splice(idx, 0, step);
  }
}

describe('Cline golden regression (pre-abstraction lock)', () => {
  let dataDir: string;
  let applier: PlanApplier;
  let adapter: ClineAdapter;
  let paths: ReturnType<typeof getClineConfigPaths>;
  const originalDataDir = process.env.CLINE_DATA_DIR;

  beforeEach(() => {
    logCapture.length = 0;
    mockGetSecret.mockReset().mockResolvedValue(SECRET);
    mockHttpRequest.mockReset().mockResolvedValue({
      status: 200,
      statusText: 'OK',
      headers: {},
      body: { data: [{ id: 'test-model-a' }, { id: 'test-model-b', context_window: 200_000 }] }
    });
    mockShowWarning.mockReset();
    dataDir = mkdtempSync(path.join(os.tmpdir(), 'cline-golden-'));
    process.env.CLINE_DATA_DIR = dataDir;
    paths = getClineConfigPaths();
    adapter = new ClineAdapter({ profileSecrets: { getSecret: mockGetSecret } });
    applier = new PlanApplier({} as never);
  });

  afterEach(async () => {
    if (originalDataDir === undefined) {
      delete process.env.CLINE_DATA_DIR;
    } else {
      process.env.CLINE_DATA_DIR = originalDataDir;
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function applyProfile(profile = makeProfile()) {
    const plan = await adapter.buildPlan(profile);
    return { plan, result: await applier.applyPlan(plan, 'Golden Profile') };
  }

  describe('providers.json', () => {
    it('writes the openai-compatible provider with secret apiKey, baseUrl, model, manual tokenSource; unrelated content preserved', async () => {
      await seedStores(dataDir);
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      const doc = await readJson(paths.providerSettingsPath);

      const compat = doc.providers['openai-compatible'] as Record<string, unknown>;
      const compatSettings = compat.settings as Record<string, unknown>;
      expect(compatSettings.provider).toBe('openai-compatible');
      expect(compatSettings.baseUrl).toBe('https://gateway.example.com/v1');
      expect(compatSettings.model).toBe('test-model-a');
      expect(compatSettings.apiKey).toBe(SECRET);
      expect(compat.tokenSource).toBe('manual');
      // Unrelated fields of the openai-compatible provider preserved.
      expect(compatSettings.customUnrelatedField).toBe('preserve-me');
      expect(compat.customUnrelatedMeta).toBe('meta-preserve-me');
      expect(compatSettings.model).toBe('test-model-a'); // model patch replaces value

      // Unrelated providers preserved verbatim.
      expect(doc.providers.anthropic).toEqual(PROVIDERS_SEED.providers.anthropic);
      expect(doc.providers['unrelated-org']).toEqual(PROVIDERS_SEED.providers['unrelated-org']);
      // Envelope fields preserved.
      expect(doc.version).toBe(1);
      expect(doc.modes).toEqual(PROVIDERS_SEED.modes);
      expect(doc.lastUsedProvider).toBe('anthropic');
    });
  });

  describe('globalState.json', () => {
    it('writes openAiBaseUrl, both mode providers (legacy "openai"), and model IDs; unrelated state preserved', async () => {
      await seedStores(dataDir);
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      const state = await readJson(paths.globalStatePath);
      expect(state.openAiBaseUrl).toBe('https://gateway.example.com/v1');
      expect(state.planModeApiProvider).toBe('openai');
      expect(state.actModeApiProvider).toBe('openai');
      expect(state.planModeOpenAiModelId).toBe('test-model-a');
      expect(state.actModeOpenAiModelId).toBe('test-model-a');
      // Unrelated state preserved.
      expect(state.unrelatedSetting).toBe(true);
      expect(state.unrelatedNested).toEqual({ deep: 'value' });
      // The old actMode model id is overwritten by the patch.
      expect(state.actModeOpenAiModelId).toBe('test-model-a');
    });
  });

  describe('models.json', () => {
    it('writes the openai-compatible catalog entry and merges discovered models; unrelated catalog content preserved', async () => {
      await seedStores(dataDir);
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      const doc = await readJson(paths.modelCatalogPath);
      expect(doc.version).toBe(1);

      const compat = doc.providers['openai-compatible'] as Record<string, unknown>;
      const provider = compat.provider as Record<string, unknown>;
      expect(provider.name).toBe('OpenAI Compatible');
      expect(provider.baseUrl).toBe('https://gateway.example.com/v1');
      expect(provider.defaultModelId).toBe('test-model-a');
      const compatModels = compat.models as Record<string, unknown>;
      expect(Object.keys(compatModels).sort()).toEqual(['test-model-a', 'test-model-b']);
      expect(compatModels['test-model-a']).toMatchObject({
        id: 'test-model-a',
        name: 'test-model-a',
        contextWindow: 128_000,
        maxInputTokens: 128_000,
        capabilities: ['streaming', 'tools']
      });
      expect(compatModels['test-model-b']).toMatchObject({ id: 'test-model-b', contextWindow: 200_000 });
      // Unrelated catalog content preserved.
      expect(doc.unrelatedTopLevel).toBe('catalog-preserve-me');
      expect(doc.providers['unrelated-org']).toEqual(MODELS_SEED.providers['unrelated-org']);
      expect(compat.legacyModels).toEqual(MODELS_SEED.providers['openai-compatible'].legacyModels);
    });
  });

  describe('legacy secrets.json mirror', () => {
    it('mirrors openAiApiKey and preserves unrelated values', async () => {
      await seedStores(dataDir);
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      const secrets = await readJson(paths.secretsMirrorPath);
      expect(secrets.openAiApiKey).toBe(SECRET);
      expect(secrets.unrelatedSecretKey).toBe('unrelated-secret-value');
    });

    it('creates secrets.json with only openAiApiKey when the mirror is missing', async () => {
      await seedStores(dataDir, { secrets: false });
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      expect(await fs.access(paths.secretsMirrorPath).then(() => true, () => false)).toBe(true);
      const secrets = await readJson(paths.secretsMirrorPath);
      expect(secrets.openAiApiKey).toBe(SECRET);
      expect(Object.keys(secrets)).toEqual(['openAiApiKey']);
    });
  });

  describe('backups', () => {
    it('exactly ONE backup per pre-existing file, created by the applier, holding the original content', async () => {
      await seedStores(dataDir, { secrets: false });
      const { plan, result } = await applyProfile();

      expect(result.success).toBe(true);
      // GAP 6: adapters no longer emit executable backup-file steps ahead of
      // edit-config-file (PlanApplier owns backup-before-write); they mark
      // backupRequired preview metadata on the edit steps instead. This was
      // the one intentional behavior change requested for golden lock-in.
      const backupSteps = plan.steps.filter((step) => step.action === 'backup-file');
      expect(backupSteps).toHaveLength(0);
      const editSteps = plan.steps.filter((step) => step.action === 'edit-config-file');
      expect(editSteps).toHaveLength(4);
      for (const step of editSteps) {
        expect(step.data.backupRequired).toBe(true);
      }

      // Exactly one backup per pre-existing file, with the ORIGINAL content.
      const backups = (await listFilesRecursively(dataDir)).filter((file) => file.includes('.backup.'));
      const contents = await Promise.all(backups.map((file) => fs.readFile(file, 'utf-8')));
      const originals = [
        JSON.stringify(PROVIDERS_SEED, null, 2) + '\n',
        JSON.stringify(GLOBAL_STATE_SEED, null, 2) + '\n',
        JSON.stringify(MODELS_SEED, null, 2) + '\n'
      ];
      for (const original of originals) {
        expect(contents).toContain(original);
      }
      expect(backups).toHaveLength(3);
      // No backup can exist for the never-existing secrets mirror.
      expect(backups.some((file) => file.startsWith(paths.secretsMirrorPath))).toBe(false);
    });
  });

  describe('atomic writes', () => {
    it('leaves no temp-file residue and no partially written files', async () => {
      await seedStores(dataDir);
      const { result } = await applyProfile();

      expect(result.success).toBe(true);
      const files = await listFilesRecursively(dataDir);
      // safeWriteFile is consolidated onto writeFileAtomic (temp file + rename):
      // a successful apply must leave zero *.tmp.* residue behind.
      expect(files.filter((file) => file.includes('.tmp.'))).toEqual([]);
      for (const target of [paths.providerSettingsPath, paths.globalStatePath, paths.modelCatalogPath, paths.secretsMirrorPath]) {
        const content = await fs.readFile(target, 'utf-8');
        expect(() => JSON.parse(content)).not.toThrow();
        expect(content.endsWith('\n')).toBe(true);
      }
    });
  });

  describe('multi-store rollback', () => {
    it('restores every earlier modified file exactly and removes newly created files when a later step fails', async () => {
      await seedStores(dataDir, { secrets: false });
      const seeds = {
        providers: await fs.readFile(paths.providerSettingsPath, 'utf-8'),
        globalState: await fs.readFile(paths.globalStatePath, 'utf-8'),
        models: await fs.readFile(paths.modelCatalogPath, 'utf-8')
      };

      const plan = await adapter.buildPlan(makeProfile());
      injectFailure(plan, 'injected-explode', 'after-catalog');
      const result = await applier.applyPlan(plan, 'Golden Profile');

      expect(result.success).toBe(false);
      expect(result.assistantResults.get('cline')?.success).toBe(false);
      // Modified files restored to exact previous bytes.
      expect(await fs.readFile(paths.providerSettingsPath, 'utf-8')).toBe(seeds.providers);
      expect(await fs.readFile(paths.globalStatePath, 'utf-8')).toBe(seeds.globalState);
      expect(await fs.readFile(paths.modelCatalogPath, 'utf-8')).toBe(seeds.models);
      // Newly created file removed.
      const secretsExists = await fs.access(paths.secretsMirrorPath).then(() => true, () => false);
      expect(secretsExists).toBe(false);
    });

    it('rolls back providers.json and secrets.json when the globalState step fails on malformed JSON', async () => {
      await seedStores(dataDir, { globalState: '{broken json' });
      const seeds = {
        providers: await fs.readFile(paths.providerSettingsPath, 'utf-8'),
        secrets: await fs.readFile(paths.secretsMirrorPath, 'utf-8')
      };

      const { result } = await applyProfile();

      expect(result.success).toBe(false);
      expect(await fs.readFile(paths.providerSettingsPath, 'utf-8')).toBe(seeds.providers);
      expect(await fs.readFile(paths.secretsMirrorPath, 'utf-8')).toBe(seeds.secrets);
    });
  });

  describe('malformed input', () => {
    it('fails closed without touching any file when providers.json is malformed', async () => {
      await seedStores(dataDir, { providers: '{not-json' });
      const seeds = {
        providers: await fs.readFile(paths.providerSettingsPath, 'utf-8'),
        globalState: await fs.readFile(paths.globalStatePath, 'utf-8'),
        models: await fs.readFile(paths.modelCatalogPath, 'utf-8'),
        secrets: await fs.readFile(paths.secretsMirrorPath, 'utf-8')
      };

      const { result } = await applyProfile();

      expect(result.success).toBe(false);
      expect(result.failedSteps).toHaveLength(1);
      expect(result.failedSteps[0].error).toContain('malformed existing configuration file');
      expect(await fs.readFile(paths.providerSettingsPath, 'utf-8')).toBe(seeds.providers);
      expect(await fs.readFile(paths.globalStatePath, 'utf-8')).toBe(seeds.globalState);
      expect(await fs.readFile(paths.modelCatalogPath, 'utf-8')).toBe(seeds.models);
      expect(await fs.readFile(paths.secretsMirrorPath, 'utf-8')).toBe(seeds.secrets);
    });
  });

  describe('exact provider selection values', () => {
    it('writes the legacy provider id "openai" into both mode selectors', async () => {
      await seedStores(dataDir);
      const { plan } = await applyProfile();

      const globalStep = plan.steps.find(
        (step) => step.action === 'edit-config-file' && step.targetPath === paths.globalStatePath
      )!;
      const patches = globalStep.data.patches as Array<{ path: string[]; value?: unknown }>;
      expect(patches.find((patch) => patch.path[0] === 'planModeApiProvider')?.value).toBe('openai');
      expect(patches.find((patch) => patch.path[0] === 'actModeApiProvider')?.value).toBe('openai');
      expect(globalStep.data.providerId).toBe('openai');
    });
  });

  describe('idempotent second apply', () => {
    it('produces byte-identical files for the serializer-deterministic stores', async () => {
      await seedStores(dataDir);
      await applyProfile();
      const first = {
        providers: await fs.readFile(paths.providerSettingsPath, 'utf-8'),
        globalState: await fs.readFile(paths.globalStatePath, 'utf-8'),
        models: await fs.readFile(paths.modelCatalogPath, 'utf-8'),
        secrets: await fs.readFile(paths.secretsMirrorPath, 'utf-8')
      };

      const { result } = await applyProfile();
      expect(result.success).toBe(true);

      expect(await fs.readFile(paths.globalStatePath, 'utf-8')).toBe(first.globalState);
      expect(await fs.readFile(paths.modelCatalogPath, 'utf-8')).toBe(first.models);
      expect(await fs.readFile(paths.secretsMirrorPath, 'utf-8')).toBe(first.secrets);

      // providers.json carries an updatedAt timestamp patch, so it is NOT
      // byte-identical — but it is identical modulo that single field.
      const second = await readJson(paths.providerSettingsPath);
      const firstDoc = JSON.parse(first.providers) as Record<string, unknown>;
      const strip = (doc: Record<string, unknown>) => {
        delete (doc.providers['openai-compatible'] as Record<string, unknown>).updatedAt;
        return doc;
      };
      expect(strip(second)).toEqual(strip(firstDoc));
    });
  });

  describe('secret non-leakage', () => {
    it('persists the synthetic secret only in providers.json and secrets.json — never in other stores, the plan, or logs', async () => {
      await seedStores(dataDir);
      const { plan, result } = await applyProfile();

      expect(result.success).toBe(true);
      expect(JSON.stringify(plan)).not.toContain(SECRET);

      const files = await listFilesRecursively(dataDir);
      const leaks: string[] = [];
      for (const file of files) {
        const content = await fs.readFile(file, 'utf-8');
        if (content.includes(SECRET) && !file.endsWith('providers.json') && !file.endsWith('secrets.json')) {
          leaks.push(file);
        }
      }
      expect(leaks).toEqual([]);

      const globalState = await fs.readFile(paths.globalStatePath, 'utf-8');
      const models = await fs.readFile(paths.modelCatalogPath, 'utf-8');
      expect(globalState).not.toContain(SECRET);
      expect(models).not.toContain(SECRET);

      // Captured logs (Logger is mocked and records every call).
      for (const entry of logCapture) {
        expect(JSON.stringify(entry.args)).not.toContain(SECRET);
      }
      expect(logCapture.length).toBeGreaterThan(0);
    });
  });
});
