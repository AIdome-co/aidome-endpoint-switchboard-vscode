/**
 * Golden regression tests for the OpenAI Codex adapter — locks CURRENT
 * behavior of the provider-execution abstraction before refactoring.
 *
 * config.toml contract (via real CodexAdapter.buildPlan + PlanApplier):
 *  1. managed provider selection model_provider = "aidome"
 *  2. model_providers.aidome.base_url = normalized profile baseUrl (exact)
 *  3. wire_api = "responses"
 *  4. env_key = "OPENAI_API_KEY"
 *  5. top-level model written from the current discovered-model behavior
 *  6. unrelated existing TOML sections/keys preserved
 *  7. verification is exact profile-aware (fails when base_url differs)
 *
 * ~/.codex/.env contract (write-env-file step through applyWriteEnvFile):
 *  8. OPENAI_API_KEY persisted from the resolved profile secret
 *  9. existing unrelated .env variables preserved
 * 10. comment lines preserved
 * 11. malformed existing .env fails closed (original file untouched)
 * 12. backup file created BEFORE modification with original content
 * 13. atomic write (writeFileAtomic): final content correct, no partial file
 * 14. rollback restores/removes the .env when a LATER step fails
 * 15. no secret value in config.toml
 * 16. no secret in plan / serialized steps / captured logs
 * 17. missing-credential: config applied, .env untouched, truthful warning
 * 18. second apply idempotent for both files
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parse as parseToml } from 'smol-toml';

// ---------- hoisted mock variables ----------
const {
  mockLogInfo,
  mockLogDebug,
  mockLogWarning,
  mockLogError,
  mockRecordApply,
  mockGetSecret,
  mockShowWarning,
  mockAppendLine,
} = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogDebug: vi.fn(),
  mockLogWarning: vi.fn(),
  mockLogError: vi.fn(),
  mockRecordApply: vi.fn().mockResolvedValue(undefined),
  mockGetSecret: vi.fn<() => Promise<string | undefined>>().mockResolvedValue(undefined),
  mockShowWarning: vi.fn().mockResolvedValue(undefined),
  mockAppendLine: vi.fn(),
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      info: mockLogInfo,
      debug: mockLogDebug,
      warning: mockLogWarning,
      error: mockLogError,
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
  },
  window: {
    showWarningMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
  },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ExtensionContext: vi.fn(),
  env: { clipboard: { writeText: vi.fn() } },
}));

vi.mock('../../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
  }),
}));

vi.mock('../../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.getSecret = mockGetSecret;
  }),
}));

vi.mock('../../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: mockAppendLine, show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../../src/ui/notifications', () => ({
  showWarning: mockShowWarning,
}));

vi.mock('../../../src/core/detection/detectCLIs', () => ({
  detectCli: vi.fn().mockResolvedValue(true),
}));

import { CodexAdapter } from '../../../src/adapters/codex/adapter';
import { PlanApplier } from '../../../src/core/orchestration/applier';
import type { Plan, PlanStep } from '../../../src/core/orchestration/planBuilder';
import type { EndpointProfile } from '../../../src/core/profiles/profileTypes';

// ---------- fixtures ----------
const SECRET = `aid_pat_golden_synthetic_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
const PROFILE_NAME = 'golden-profile';
const RAW_BASE_URL = 'https://gateway.example.com';
const NORMALIZED_BASE_URL = 'https://gateway.example.com/v1';
const DISCOVERED_MODEL = 'aidome-golden-model';

const EXISTING_TOML = [
  'unrelated_setting = "keep-me"',
  'other_number = 7',
  '',
  '[model_providers.openai]',
  'name = "openai"',
  'base_url = "https://api.openai.com/v1"',
  '',
  '[custom_section]',
  'flag = true',
  '',
].join('\n');

const EXISTING_DOTENV = [
  '# managed by user — do not remove',
  'OTHER_SERVICE_KEY=other-service-value',
  'CODEX_Sandbox=false',
  '',
  '# trailing comment',
  '',
].join('\n');

function makeProfile(): EndpointProfile {
  const now = new Date().toISOString();
  return {
    id: 'profile-golden-1',
    name: PROFILE_NAME,
    profileType: 'aidome',
    baseUrl: RAW_BASE_URL,
    dialect: 'openai' as never,
    authRef: PROFILE_NAME,
    capabilitiesCache: {
      supportedModels: [DISCOVERED_MODEL],
    } as never,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- shared harness ----------
let tempDir: string;
let configPath: string;
let envPath: string;
let previousCodexConfigPath: string | undefined;
let applier: PlanApplier;
let adapter: CodexAdapter;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-golden-'));
  configPath = path.join(tempDir, 'config.toml');
  envPath = path.join(tempDir, '.env');
  previousCodexConfigPath = process.env.CODEX_CONFIG_PATH;
  process.env.CODEX_CONFIG_PATH = configPath;

  mockGetSecret.mockReset();
  mockGetSecret.mockResolvedValue(SECRET);
  mockRecordApply.mockReset();
  mockRecordApply.mockResolvedValue(undefined);
  for (const spy of [mockLogInfo, mockLogDebug, mockLogWarning, mockLogError, mockAppendLine, mockShowWarning]) {
    spy.mockReset();
  }

  applier = new PlanApplier({} as never);
  adapter = new CodexAdapter({
    profileSecrets: { getSecret: mockGetSecret } as never,
  });
});

afterEach(async () => {
  if (previousCodexConfigPath === undefined) {
    delete process.env.CODEX_CONFIG_PATH;
  } else {
    process.env.CODEX_CONFIG_PATH = previousCodexConfigPath;
  }
  await fs.rm(tempDir, { recursive: true, force: true });
});

async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function listBackupFiles(filePath: string): Promise<string[]> {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const entries = await fs.readdir(dir);
  return entries.filter(name => name.startsWith(`${base}.backup`)).map(name => path.join(dir, name));
}

function allLogText(): string {
  return [mockLogInfo, mockLogDebug, mockLogWarning, mockLogError]
    .flatMap(spy => spy.mock.calls.map(call => call.map(String).join(' ')))
    .join('\n');
}

function makePlan(steps: Array<Omit<PlanStep, 'id'>>): Plan {
  return {
    id: 'plan-codex-golden',
    profileId: 'profile-golden-1',
    assistantKeys: ['openai-codex'],
    steps: steps.map((step, index) => ({ ...step, id: `golden-step-${index}` })),
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

async function applyAdapterPlan(): Promise<{ plan: Plan; success: boolean }> {
  const profile = makeProfile();
  const plan = await adapter.buildPlan(profile);
  const result = await applier.applyPlan(plan, PROFILE_NAME);
  return { plan, success: result.success };
}

// ---------- config.toml golden contract ----------
describe('Codex golden — config.toml', () => {
  it('writes the managed provider block exactly as today (items 1-5)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const written = await fs.readFile(configPath, 'utf-8');
    const parsed = parseToml(written) as Record<string, unknown>;

    // 1. provider selection
    expect(parsed.model_provider).toBe('aidome');
    // 2. exact normalized base_url
    const provider = parsed.model_providers as Record<string, Record<string, unknown>>;
    expect(provider.aidome).toBeDefined();
    expect(provider.aidome.base_url).toBe(NORMALIZED_BASE_URL);
    // 3. wire API
    expect(provider.aidome.wire_api).toBe('responses');
    // 4. env key reference (symbolic — no value)
    expect(provider.aidome.env_key).toBe('OPENAI_API_KEY');
    // 5. current discovered-model behavior: first discovered model id
    expect(parsed.model).toBe(DISCOVERED_MODEL);
  });

  it('normalizes a versioned profile URL without double-appending /v1 (item 2)', async () => {
    const profile = makeProfile();
    profile.baseUrl = `${RAW_BASE_URL}/v1`;
    const plan = await adapter.buildPlan(profile);
    const result = await applier.applyPlan(plan, PROFILE_NAME);
    expect(result.success).toBe(true);

    const written = await fs.readFile(configPath, 'utf-8');
    const parsed = parseToml(written) as Record<string, unknown>;
    const provider = parsed.model_providers as Record<string, Record<string, unknown>>;
    expect(provider.aidome.base_url).toBe(NORMALIZED_BASE_URL);
  });

  it('omits the top-level model when no model is discovered (item 5)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    const profile = makeProfile();
    profile.capabilitiesCache = { supportedModels: [] } as never;
    const plan = await adapter.buildPlan(profile);
    const result = await applier.applyPlan(plan, PROFILE_NAME);
    expect(result.success).toBe(true);

    const written = await fs.readFile(configPath, 'utf-8');
    const parsed = parseToml(written) as Record<string, unknown>;
    expect(parsed.model).toBeUndefined();
    expect(parsed.model_provider).toBe('aidome');
  });

  it('preserves unrelated existing TOML sections and keys (item 6)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const written = await fs.readFile(configPath, 'utf-8');
    const before = parseToml(EXISTING_TOML) as Record<string, unknown>;
    const after = parseToml(written) as Record<string, unknown>;

    // Unrelated top-level keys survive with identical values.
    expect(after.unrelated_setting).toBe(before.unrelated_setting);
    expect(after.other_number).toBe(before.other_number);
    // Unrelated provider table survives untouched.
    expect(JSON.stringify((after.model_providers as Record<string, unknown>).openai))
      .toBe(JSON.stringify((before.model_providers as Record<string, unknown>).openai));
    // Unrelated custom section survives.
    expect(JSON.stringify(after.custom_section)).toBe(JSON.stringify(before.custom_section));

    // And the raw lines are still present in the emitted file.
    expect(written).toContain('unrelated_setting = "keep-me"');
    expect(written).toContain('[custom_section]');
  });

  it('verification is exact profile-aware and fails when base_url differs (item 7)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await applyAdapterPlan();

    // The adapter that planned the apply verifies success.
    const verified = await (adapter as unknown as { verify: () => Promise<{ success: boolean; message: string; details?: Record<string, unknown> }> }).verify();
    expect(verified.success).toBe(true);
    expect(verified.message).toContain('verified for the active profile');

    // A different base_url must fail exact matching.
    await fs.writeFile(configPath, String.raw`unrelated_setting = "keep-me"` + '\n' +
      `[model_providers.aidome]` + '\n' +
      `base_url = "https://somewhere-else.example.com/v1"` + '\n' +
      `wire_api = "responses"` + '\n' +
      `env_key = "OPENAI_API_KEY"` + '\n' +
      `model_provider = "aidome"` + '\n', 'utf-8');
    const mismatch = await (adapter as unknown as { verify: () => Promise<{ success: boolean; message: string }> }).verify();
    expect(mismatch.success).toBe(false);
    expect(mismatch.message).toContain('base_url');

    // A fresh adapter without a planned profile URL must fail closed (not
    // report "some valid provider exists" as verified).
    const fresh = new CodexAdapter();
    const unknown = await (fresh as unknown as { verify: () => Promise<{ success: boolean; message: string }> }).verify();
    expect(unknown.success).toBe(false);
    expect(unknown.message).toContain('expected AIdome profile URL is unknown');
  });
});

// ---------- ~/.codex/.env golden contract ----------
describe('Codex golden — ~/.codex/.env via PlanApplier.applyWriteEnvFile', () => {
  it('persists OPENAI_API_KEY from the resolved profile secret, preserving unrelated vars and comments (items 8-9, 10)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const written = await fs.readFile(envPath, 'utf-8');
    const parsed = Object.fromEntries(
      written.split('\n')
        .filter(line => line.trim().length > 0 && !line.trim().startsWith('#'))
        .map(line => {
          const idx = line.indexOf('=');
          return [line.slice(0, idx), line.slice(idx + 1)];
        })
    );

    // 8. secret persisted from SecretStorage resolution
    expect(parsed.OPENAI_API_KEY).toBe(SECRET);
    // 9. unrelated variables preserved
    expect(parsed.OTHER_SERVICE_KEY).toBe('other-service-value');
    expect(parsed.CODEX_Sandbox).toBe('false');
    // 10. comment lines preserved
    expect(written).toContain('# managed by user — do not remove');
    expect(written).toContain('# trailing comment');
  });

  it('fails closed on a malformed existing .env: throws, original file untouched (item 11)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    const malformed = 'GOOD_KEY=ok\nthis-line-has-no-separator\nANOTHER_KEY=fine\n';
    await fs.writeFile(envPath, malformed, 'utf-8');

    const profile = makeProfile();
    const plan = await adapter.buildPlan(profile);
    const result = await applier.applyPlan(plan, PROFILE_NAME);

    // The .env write step fails; the assistant is not reported as configured.
    expect(result.success).toBe(false);
    expect(result.failedSteps.length).toBeGreaterThan(0);
    const envFailure = result.failedSteps.find(step => step.action === 'write-env-file');
    expect(envFailure).toBeDefined();
    expect(envFailure?.error).toContain('malformed');

    // Original file byte-identical.
    expect(await fs.readFile(envPath, 'utf-8')).toBe(malformed);
  });

  it('creates a backup holding the ORIGINAL content before modifying (item 12)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const backups = await listBackupFiles(envPath);
    expect(backups.length).toBeGreaterThanOrEqual(1);
    const backupContent = await fs.readFile(backups[0], 'utf-8');
    expect(backupContent).toBe(EXISTING_DOTENV);

    // The live file has moved on to the patched content.
    expect(await fs.readFile(envPath, 'utf-8')).toContain(`OPENAI_API_KEY=${SECRET}`);
  });

  it('write is atomic: final content correct and no partial temp file remains (item 13)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const finalContent = await fs.readFile(envPath, 'utf-8');
    expect(finalContent).toContain(`OPENAI_API_KEY=${SECRET}`);
    expect(finalContent.endsWith('\n')).toBe(true);

    // No leftover partial write artifacts.
    const entries = await fs.readdir(tempDir);
    expect(entries.filter(name => name.startsWith('.env.tmp.'))).toEqual([]);
  });

  it('rollback restores the original .env when a LATER step fails (item 14 — existing file)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    // Step 1: write-env-file (succeeds). Step 2: edit-config-file against a
    // malformed existing TOML — the driver throws, forcing group rollback.
    const plan = makePlan([
      {
        action: 'write-env-file',
        description: 'Persist gateway credential to the Codex .env file',
        assistantKey: 'openai-codex',
        targetPath: envPath,
        data: {
          secretPolicy: 'target-persisted-at-apply',
          authRef: PROFILE_NAME,
          profileName: PROFILE_NAME,
          envVarName: 'OPENAI_API_KEY'
        },
        reversible: true
      },
      {
        action: 'edit-config-file',
        description: 'Force a later failure with malformed existing TOML',
        assistantKey: 'openai-codex',
        targetPath: configPath,
        newValue: NORMALIZED_BASE_URL,
        data: { driver: 'toml-table', format: 'toml', providerName: 'aidome', wireApi: 'responses' },
        reversible: true
      }
    ]);
    // Corrupt the TOML so the later step throws.
    await fs.writeFile(configPath, 'not = [valid toml', 'utf-8');

    const result = await applier.applyPlan(plan, PROFILE_NAME);

    expect(result.success).toBe(false);
    expect(result.assistantResults.get('openai-codex')?.success).toBe(false);
    // The .env step ran first and was rolled back: original content restored.
    expect(await fs.readFile(envPath, 'utf-8')).toBe(EXISTING_DOTENV);
  });

  it('rollback removes a newly-created .env when a LATER step fails (item 14 — new file)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    // No .env exists yet.
    const plan = makePlan([
      {
        action: 'write-env-file',
        description: 'Persist gateway credential to the Codex .env file',
        assistantKey: 'openai-codex',
        targetPath: envPath,
        data: {
          secretPolicy: 'target-persisted-at-apply',
          authRef: PROFILE_NAME,
          profileName: PROFILE_NAME,
          envVarName: 'OPENAI_API_KEY'
        },
        reversible: true
      },
      {
        action: 'edit-config-file',
        description: 'Force a later failure with malformed existing TOML',
        assistantKey: 'openai-codex',
        targetPath: configPath,
        newValue: NORMALIZED_BASE_URL,
        data: { driver: 'toml-table', format: 'toml', providerName: 'aidome', wireApi: 'responses' },
        reversible: true
      }
    ]);
    await fs.writeFile(configPath, 'not = [valid toml', 'utf-8');

    const result = await applier.applyPlan(plan, PROFILE_NAME);

    expect(result.success).toBe(false);
    // The .env was newly created by the first step and rollback unlinks it.
    expect(await readFileOrUndefined(envPath)).toBeUndefined();
  });

  it('never places the secret value in config.toml (item 15)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const toml = await fs.readFile(configPath, 'utf-8');
    expect(toml).not.toContain(SECRET);
    expect(toml).toContain('env_key = "OPENAI_API_KEY"');
  });

  it('never places the secret in the plan, serialized steps, results, or logs (item 16)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { plan, success } = await applyAdapterPlan();
    expect(success).toBe(true);

    const planJson = JSON.stringify(plan);
    expect(planJson).not.toContain(SECRET);
    // Symbolic auth reference is present instead.
    expect(planJson).toContain(PROFILE_NAME);

    const logs = allLogText();
    expect(logs).not.toContain(SECRET);

    const dirEntries = await fs.readdir(tempDir);
    for (const entry of dirEntries) {
      if (entry.startsWith('config.toml')) {
        expect(await fs.readFile(path.join(tempDir, entry), 'utf-8')).not.toContain(SECRET);
      }
    }
    expect(mockRecordApply).toHaveBeenCalled();
    expect(JSON.stringify(mockRecordApply.mock.calls)).not.toContain(SECRET);
  });

  it('missing credential: config stays applied, .env untouched, truthful warning, unrelated credential preserved (item 17)', async () => {
    mockGetSecret.mockResolvedValue(undefined);
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const { success } = await applyAdapterPlan();
    // The .env step is skipped (not failed): the apply still succeeds and the
    // endpoint config remains applied.
    expect(success).toBe(true);

    const toml = await fs.readFile(configPath, 'utf-8');
    const parsed = parseToml(toml) as Record<string, unknown>;
    expect(parsed.model_provider).toBe('aidome');
    expect((parsed.model_providers as Record<string, Record<string, unknown>>).aidome.base_url)
      .toBe(NORMALIZED_BASE_URL);

    // .env was NOT populated and the user's other credential was not removed.
    const env = await fs.readFile(envPath, 'utf-8');
    expect(env).toBe(EXISTING_DOTENV);
    expect(env).not.toContain('OPENAI_API_KEY');
    expect(env).toContain('OTHER_SERVICE_KEY');

    // A truthful warning was logged naming the missing variable.
    const warnings = mockLogWarning.mock.calls.map(call => call.map(String).join(' '));
    expect(warnings.some(message =>
      message.includes('No saved profile credential') && message.includes('OPENAI_API_KEY')
    )).toBe(true);
  });

  it('missing credential with no existing .env: .env is not created (item 17)', async () => {
    mockGetSecret.mockResolvedValue(undefined);
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');

    const { success } = await applyAdapterPlan();
    expect(success).toBe(true);
    expect(await readFileOrUndefined(envPath)).toBeUndefined();
  });

  it('second apply is idempotent for both files (item 18)', async () => {
    await fs.writeFile(configPath, EXISTING_TOML, 'utf-8');
    await fs.writeFile(envPath, EXISTING_DOTENV, 'utf-8');

    const first = await applyAdapterPlan();
    expect(first.success).toBe(true);
    const tomlAfterFirst = await fs.readFile(configPath, 'utf-8');
    const envAfterFirst = await fs.readFile(envPath, 'utf-8');

    const second = await applyAdapterPlan();
    expect(second.success).toBe(true);

    expect(await fs.readFile(configPath, 'utf-8')).toBe(tomlAfterFirst);
    expect(await fs.readFile(envPath, 'utf-8')).toBe(envAfterFirst);

    // Values remain exactly golden after repeated applies.
    const parsed = parseToml(tomlAfterFirst) as Record<string, unknown>;
    expect(parsed.model_provider).toBe('aidome');
    expect((parsed.model_providers as Record<string, Record<string, unknown>>).aidome.base_url)
      .toBe(NORMALIZED_BASE_URL);
    expect(parsed.model).toBe(DISCOVERED_MODEL);
    expect(envAfterFirst).toContain(`OPENAI_API_KEY=${SECRET}`);
  });
});
