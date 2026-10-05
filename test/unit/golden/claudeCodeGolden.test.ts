/**
 * Golden regression tests for the Claude Code adapter + PlanApplier.
 *
 * These tests lock down CURRENT behavior of the claude-code adapter and the
 * plan applier before the provider execution abstraction refactor. They use
 * the real filesystem inside a temp home directory (redirected via the
 * `util/paths` mock) so backups, atomic writes and rollback behave exactly
 * like production. Secrets are always synthetic (`sk-test-golden-...`) and
 * never committed anywhere.
 *
 * Locked behaviors:
 *  1. Target settings.json path resolution (CLAUDE_CONFIG_DIR + ~/.claude default)
 *  2. Plan writes ANTHROPIC_BASE_URL = profile.baseUrl
 *  3. Secret is target-persisted-at-apply: plan carries only authRef, no value
 *  4. CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY written into env
 *  5. Unrelated existing settings in settings.json are preserved after apply
 *  6. Secret resolved from profileSecrets only at apply time, written to file
 *  7. Secret value never appears in serialized plan JSON or captured logger output
 *  8. Malformed existing settings.json fails closed; original file untouched
 *  9. Second apply is idempotent (same semantic content, byte-identical)
 * 10. Rollback restores the original file content when a later step fails
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

// ---------- hoisted mock variables ----------
const {
  TEST_HOME,
  secretStore,
  mockConfigGet,
  mockConfigUpdate,
  loggerMessages,
  mockRecordApply,
  mockAppendLine,
  mockShowWarning,
  mockDetectCli,
} = vi.hoisted(() => {
  // Synthetic, never-real credential used for all apply-time assertions.
  const TEST_HOME = '/tmp/aidome-golden-claude-home';
  const secretStore = new Map<string, string>();
  return {
    TEST_HOME,
    secretStore,
    mockConfigGet: vi.fn(),
    mockConfigUpdate: vi.fn().mockResolvedValue(undefined),
    loggerMessages: [] as string[],
    mockRecordApply: vi.fn().mockResolvedValue(undefined),
    mockAppendLine: vi.fn(),
    mockShowWarning: vi.fn().mockResolvedValue(undefined),
    mockDetectCli: vi.fn().mockResolvedValue(false),
  };
});

const SECRET_VALUE = 'sk-test-golden-c1aude-9f2e7b4a';

// Redirect the user home so ~/.claude/settings.json lands in our temp tree.
vi.mock('../../../src/util/paths', () => ({
  getHomedir: () => TEST_HOME,
  getHomeDir: () => TEST_HOME,
  expandTilde: (p: string) => {
    if (p === '~') return TEST_HOME;
    if (p.startsWith('~/')) return path.join(TEST_HOME, p.slice(2));
    return p;
  },
  expandHome: (p: string) => p,
  normalizePath: (p: string) => path.normalize(p),
  getConfigDir: (appName: string) => path.join(TEST_HOME, `.${appName.toLowerCase()}`),
}));

// Capture ALL Logger output so tests can assert no secret leaks into logs.
vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn(() => ({
      debug: (msg: string) => { loggerMessages.push(`DEBUG: ${msg}`); },
      info: (msg: string) => { loggerMessages.push(`INFO: ${msg}`); },
      warning: (msg: string) => { loggerMessages.push(`WARNING: ${msg}`); },
      error: (msg: string) => { loggerMessages.push(`ERROR: ${msg}`); },
      getBuffer: () => loggerMessages.map((message, i) => ({ timestamp: '', level: '', message, i })),
      initialize: vi.fn(),
    })),
    initialize: vi.fn(),
  },
}));

vi.mock('../../../src/ui/output', () => ({
  getOutputChannel: vi.fn(() => ({ appendLine: mockAppendLine, show: vi.fn(), clear: vi.fn() })),
}));

vi.mock('../../../src/ui/notifications', () => ({
  showWarning: mockShowWarning,
  showSuccess: vi.fn(),
  showInformation: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: mockConfigGet,
      update: mockConfigUpdate,
    })),
  },
  window: {
    showWarningMessage: vi.fn().mockResolvedValue(undefined),
    showInformationMessage: vi.fn().mockResolvedValue(undefined),
    showErrorMessage: vi.fn().mockResolvedValue(undefined),
  },
  env: { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } },
  extensions: { getExtension: vi.fn(() => undefined) },
  ConfigurationTarget: { Global: 1, Workspace: 2 },
  ExtensionContext: vi.fn(),
}));

vi.mock('../../../src/core/orchestration/changeLog', () => ({
  ChangeLog: vi.fn(function (this: Record<string, unknown>) {
    this.recordApply = mockRecordApply;
    this.getEntries = vi.fn().mockResolvedValue([]);
    this.removeEntry = vi.fn().mockResolvedValue(undefined);
  }),
}));

// ProfileSecrets façade — the applier instantiates it internally, so the
// module mock is the injection point for the apply-time secret.
vi.mock('../../../src/core/profiles/profileSecrets', () => ({
  ProfileSecrets: vi.fn(function (this: Record<string, unknown>) {
    this.getSecret = vi.fn(async (authRef: string) => secretStore.get(authRef));
    this.storeSecret = vi.fn().mockResolvedValue(undefined);
    this.deleteSecret = vi.fn().mockResolvedValue(undefined);
  }),
}));

vi.mock('../../../src/core/detection/detectCLIs', () => ({
  detectCli: mockDetectCli,
}));

import { ClaudeCodeAdapter } from '../../../src/adapters/claudeCode/adapter';
import { getClaudeCodeSettingsPath } from '../../../src/adapters/claudeCode/claudeCodeConfigPatcher';
import { PlanApplier } from '../../../src/core/orchestration/applier';
import type { EndpointProfile } from '../../../src/core/profiles/profileTypes';
import type { Plan } from '../../../src/core/orchestration/planBuilder';

// ---------- helpers ----------
const SETTINGS_PATH = path.join(TEST_HOME, '.claude', 'settings.json');

function makeProfile(overrides: Partial<EndpointProfile> = {}): EndpointProfile {
  return {
    id: 'profile-golden-1',
    name: 'golden-profile',
    profileType: 'custom',
    baseUrl: 'https://gateway.example.com/v1',
    dialect: 'openai-chat',
    authRef: 'golden-auth-ref',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const fakeContext = {} as never;

async function readSettings(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(SETTINGS_PATH, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Applies only the file-editing step of the plan through the real applier. */
async function applyEditStep(applier: PlanApplier, plan: Plan): Promise<void> {
  await applier.applyStep(plan.steps[0]);
}

// ---------- tests ----------
describe('Claude Code golden regression (current behavior)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    loggerMessages.length = 0;
    secretStore.clear();
    secretStore.set('golden-auth-ref', SECRET_VALUE);
    mockConfigUpdate.mockResolvedValue(undefined);
    mockConfigGet.mockReturnValue(undefined);
    mockRecordApply.mockResolvedValue(undefined);
    await fs.mkdir(path.join(TEST_HOME, '.claude'), { recursive: true });
    await fs.rm(SETTINGS_PATH, { force: true });
    await fs.rm(`${SETTINGS_PATH}.tmp.0`, { force: true }).catch(() => undefined);
    // Remove any pre-existing backups from prior tests.
    const dir = await fs.readdir(path.join(TEST_HOME, '.claude'));
    for (const entry of dir) {
      if (entry.startsWith('settings.json.backup')) {
        await fs.rm(path.join(path.join(TEST_HOME, '.claude'), entry), { force: true });
      }
    }
  });

  afterAll(async () => {
    await fs.rm(TEST_HOME, { recursive: true, force: true });
  });

  it('(1) resolves the target settings.json path under the Claude config home', async () => {
    // Default: ~/.claude/settings.json (never the Claude Desktop config dir)
    expect(getClaudeCodeSettingsPath()).toBe(SETTINGS_PATH);

    // CLAUDE_CONFIG_DIR override wins when set.
    const prev = process.env.CLAUDE_CONFIG_DIR;
    try {
      process.env.CLAUDE_CONFIG_DIR = '~/custom-claude-config';
      expect(getClaudeCodeSettingsPath()).toBe(path.join(TEST_HOME, 'custom-claude-config', 'settings.json'));
    } finally {
      if (prev === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR;
      } else {
        process.env.CLAUDE_CONFIG_DIR = prev;
      }
    }
  });

  it('(2,3,4) buildPlan targets settings.json with baseUrl, authRef-only secret policy and gateway model discovery', async () => {
    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);

    expect(plan.assistantKeys).toEqual(['claude-code']);
    expect(plan.steps[0].action).toBe('edit-config-file');
    const step = plan.steps[0];
    expect(step.targetPath).toBe(SETTINGS_PATH);
    expect(step.data.driver).toBe('json-object');
    expect(step.data.baseUrl).toBe(profile.baseUrl);
    expect(step.data.secretPolicy).toBe('target-persisted-at-apply');
    expect(step.data.authRef).toBe('golden-auth-ref');

    const patches = step.data.patches as Array<Record<string, unknown>>;
    expect(patches).toEqual([
      { path: ['env', 'ANTHROPIC_BASE_URL'], source: 'baseUrl' },
      { path: ['env', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'], value: '1' },
      { path: ['env', 'ANTHROPIC_AUTH_TOKEN'], source: 'secret', removeWhenMissing: true },
    ]);

    // (3) No secret value anywhere in the plan or step payload.
    const planJson = JSON.stringify(plan);
    expect(planJson).not.toContain(SECRET_VALUE);
    expect(planJson).not.toContain('sk-test-golden');

    // The removePaths/envVars list locks what is rewritten vs removed.
    expect(step.data.removePaths).toEqual([['env', 'ANTHROPIC_API_KEY']]);
    expect(step.data.envVars).toEqual([
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY',
    ]);
  });

  it('(2,3,5,6,9) apply writes env keys, preserves unrelated settings, persists the secret only at apply, and is idempotent', async () => {
    const original = {
      model: 'claude-opus-4-5',
      permissions: { allow: ['Bash(npm run lint)'] },
      env: { ANTHROPIC_API_KEY: 'legacy-plain-key', CUSTOM_KEEP: 'keep-me' },
    };
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(original, null, 2), 'utf-8');

    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);

    const applier = new PlanApplier(fakeContext);
    await applyEditStep(applier, plan);

    const written = await readSettings();
    const env = written.env as Record<string, string | undefined>;

    // (2) baseUrl applied
    expect(env.ANTHROPIC_BASE_URL).toBe(profile.baseUrl);
    // (4) gateway model discovery enabled
    expect(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
    // (6) secret resolved at apply and persisted into the file
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(SECRET_VALUE);
    // Legacy plain API key is removed
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // (5) unrelated settings and env vars preserved
    expect(written.model).toBe('claude-opus-4-5');
    expect(written.permissions).toEqual(original.permissions);
    expect(env.CUSTOM_KEEP).toBe('keep-me');

    // Trailing newline formatting is deterministic
    const firstApply = await fs.readFile(SETTINGS_PATH, 'utf-8');
    expect(firstApply.endsWith('\n')).toBe(true);

    // (9) Second apply is idempotent: byte-identical output
    const applier2 = new PlanApplier(fakeContext);
    const plan2 = await adapter.buildPlan(profile);
    await applyEditStep(applier2, plan2);
    const secondApply = await fs.readFile(SETTINGS_PATH, 'utf-8');
    expect(secondApply).toBe(firstApply);
    const secondParsed = JSON.parse(secondApply) as Record<string, unknown>;
    expect(secondParsed.env).toEqual(env);
  });

  it('(7) secret value never appears in serialized plan JSON, captured logger output or change-log entries', async () => {
    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier(fakeContext);
    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(true);
    const planJson = JSON.stringify(plan);
    expect(planJson).not.toContain(SECRET_VALUE);
    expect(planJson).not.toContain('sk-test-golden');

    // Applied steps / change log carry the redacted marker, not the content.
    const changeLogArgs = mockRecordApply.mock.calls;
    expect(changeLogArgs.length).toBeGreaterThan(0);
    expect(JSON.stringify(mockRecordApply.mock.calls)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(result.appliedSteps)).not.toContain(SECRET_VALUE);
    expect(JSON.stringify(result.changeLogEntry)).toContain('[redacted config-file content]');

    // Captured logger output (info/warn/error/debug) leaks nothing.
    expect(loggerMessages.join('\n')).not.toContain(SECRET_VALUE);
    expect(loggerMessages.join('\n')).not.toContain('sk-test-golden');
  });

  it('(8) malformed existing settings.json fails closed and leaves the original file untouched', async () => {
    const malformed = '{ "env": { "ANTHROPIC_BASE_URL": "https://old.example.com" },, broken';
    await fs.writeFile(SETTINGS_PATH, malformed, 'utf-8');
    const before = await fs.readFile(SETTINGS_PATH, 'utf-8');

    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);
    const applier = new PlanApplier(fakeContext);

    // Step-level apply throws — fail closed.
    await expect(applier.applyStep(plan.steps[0])).rejects.toThrow();

    // Plan-level apply degrades gracefully for the assistant but writes nothing.
    const result = await applier.applyPlan(plan, profile.name);
    expect(result.success).toBe(false);
    expect(result.failedSteps.some(s => s.assistantKey === 'claude-code')).toBe(true);

    const after = await fs.readFile(SETTINGS_PATH, 'utf-8');
    expect(after).toBe(before);
    expect(after).toContain('broken');
  });

  it('(10) rollback restores the original settings.json when a later step in the plan fails', async () => {
    const original = {
      model: 'claude-opus-4-5',
      env: { ANTHROPIC_AUTH_TOKEN: 'sk-test-golden-original-token' },
    };
    await fs.writeFile(SETTINGS_PATH, JSON.stringify(original, null, 2), 'utf-8');
    const before = await fs.readFile(SETTINGS_PATH, 'utf-8');

    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);

    // Make the second step (set-vscode-setting) fail after the file edit landed.
    mockConfigUpdate.mockRejectedValueOnce(new Error('later step failed'));

    const applier = new PlanApplier(fakeContext);
    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(false);
    expect(result.assistantResults.get('claude-code')?.success).toBe(false);

    // The file edit was rolled back from the timestamped backup.
    const after = await fs.readFile(SETTINGS_PATH, 'utf-8');
    expect(after).toBe(before);
    const parsed = JSON.parse(after) as { env: Record<string, string | undefined> };
    expect(parsed.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test-golden-original-token');
    expect(parsed.env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it('(10-deviation lock) when no secret is saved the apply still succeeds and ANTHROPIC_AUTH_TOKEN is cleared with a warning', async () => {
    // This is CURRENT behavior worth locking: clearAuthWhenMissing means a
    // missing secret does NOT fail the apply; the token is cleared instead.
    secretStore.clear();
    const profile = makeProfile();
    const adapter = new ClaudeCodeAdapter();
    const plan = await adapter.buildPlan(profile);

    const applier = new PlanApplier(fakeContext);
    const result = await applier.applyPlan(plan, profile.name);

    expect(result.success).toBe(true);
    expect(mockShowWarning).toHaveBeenCalled();
    const env = ((await readSettings()).env ?? {}) as Record<string, string | undefined>;
    expect(env.ANTHROPIC_BASE_URL).toBe(profile.baseUrl);
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY).toBe('1');
  });
});
