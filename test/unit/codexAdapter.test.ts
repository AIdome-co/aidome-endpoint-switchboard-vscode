/**
 * Unit tests for the OpenAI Codex adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodexAdapter } from '../../src/adapters/codex/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn() }))
  },
  window: {
    showWarningMessage: vi.fn()
  }
}));

vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/fsSafe');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new CodexAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  describe('detect', () => {
    it('returns true when the Codex CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      await expect(adapter.detect()).resolves.toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('codex');
    });

    it('returns false when the Codex CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      await expect(adapter.detect()).resolves.toBe(false);
    });

    it('returns false when CLI detection fails', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      await expect(adapter.detect()).resolves.toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('creates a reversible config plan with a backup for an existing file', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(true);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('openai-codex');
      expect(plan.steps.find(step => step.action === 'backup-file')).toBeDefined();

      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep?.newValue).toBe(mockProfile.baseUrl);
      expect(editStep?.data).toMatchObject({
        format: 'toml',
        providerName: 'aidome',
        wireApi: 'responses'
      });
      expect(plan.steps.find(step => step.action === 'set-env-var')).toBeUndefined();
    });

    it('does not add a redundant backup step for a missing file', async () => {
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.find(step => step.action === 'backup-file')).toBeUndefined();
      expect(plan.steps.find(step => step.action === 'edit-config-file')).toBeDefined();
    });

    it('adds environment-key guidance without placing a secret in plan data', async () => {
      mockProfile.authRef = 'profile-secret-reference';
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      const editStep = plan.steps.find(step => step.action === 'edit-config-file');
      expect(editStep?.data.authEnvVar).toBe('OPENAI_API_KEY');
      expect(JSON.stringify(plan)).not.toContain('profile-secret-reference');

      const guidanceStep = plan.steps.find(step => step.action === 'show-guided-steps');
      expect(guidanceStep?.data.envVarName).toBe('OPENAI_API_KEY');
      expect(guidanceStep?.data.steps).toEqual([
        'Set OPENAI_API_KEY in the environment used to launch Codex.',
        'Codex will read that variable for the aidome provider; Switchboard keeps the saved profile secret in SecretStorage and does not write it to config.toml.',
        'Restart Codex or VS Code after changing the environment so the process can read the variable.'
      ]);
    });

    it('rejects unsafe endpoint URLs before creating a plan', async () => {
      mockProfile.baseUrl = 'javascript:alert(1)';

      await expect(adapter.buildPlan(mockProfile)).rejects.toThrow('base URL');
    });
  });

  describe('verify', () => {
    it('succeeds only for the selected AIdome Responses provider', async () => {
      const mockConfig = `
model = "existing-model"
model_provider = "aidome"

[model_providers.aidome]
name = "AIdome Gateway"
base_url = "https://aidome.example.com/v1"
wire_api = "responses"
env_key = "OPENAI_API_KEY"
`;
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(mockConfig);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details).toMatchObject({ provider: 'aidome', wireApi: 'responses' });
    });

    it('fails when the config file does not exist', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('fails for malformed TOML', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue('this is not valid TOML {{[');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not valid TOML');
    });

    it('fails for the legacy unsupported providers table', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(`
model_provider = "aidome"
[providers.aidome]
name = "AIdome Gateway"
base_url = "https://aidome.example.com/v1"
`);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('model_providers');
    });

    it('fails when another provider is active', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(`
model_provider = "other"
[model_providers.aidome]
name = "AIdome Gateway"
base_url = "https://aidome.example.com/v1"
`);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not select');
    });

    it('fails when the selected provider is missing or uses an unsupported wire API', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(`
model_provider = "aidome"
[model_providers.aidome]
name = "AIdome Gateway"
base_url = "https://aidome.example.com/v1"
wire_api = "chat"
`);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Responses API');
    });

    it('fails when the selected provider uses unsupported plaintext api_key auth', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(`
model_provider = "aidome"
[model_providers.aidome]
name = "AIdome Gateway"
base_url = "https://aidome.example.com/v1"
api_key = "legacy-plaintext-key"
`);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('use env_key');
    });

    it('fails when the selected provider base URL is unsafe', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(`
model_provider = "aidome"
[model_providers.aidome]
name = "AIdome Gateway"
base_url = "file:///tmp/secret"
`);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('invalid base_url');
    });
  });

  it('reports the Codex display name and Tier A support', () => {
    expect(adapter.getDisplayName()).toBe('OpenAI Codex (CLI / IDE)');
    expect(adapter.getTier()).toBe('A');
  });
});
