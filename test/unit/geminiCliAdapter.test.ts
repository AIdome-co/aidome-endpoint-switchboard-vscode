/**
 * Unit tests for Gemini CLI adapter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiCliAdapter } from '../../src/adapters/geminiCli/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';
import * as fsSafe from '../../src/util/fsSafe';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as nodePath from 'node:path';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  },
  window: {
    showWarningMessage: vi.fn()
  }
}));

vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('GeminiCliAdapter', () => {
  let adapter: GeminiCliAdapter;
  let mockProfile: EndpointProfile;
  let originalGeminiBaseUrl: string | undefined;
  let originalVertexBaseUrl: string | undefined;
  let originalTrustWorkspace: string | undefined;
  let originalCloudShell: string | undefined;
  let originalComputeAdc: string | undefined;
  let originalRestrictedMode: string | undefined;

  beforeEach(() => {
    adapter = new GeminiCliAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      profileType: 'custom',
      dialect: 'google.gemini.generate_content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
    originalGeminiBaseUrl = process.env['GOOGLE_GEMINI_BASE_URL'];
    originalVertexBaseUrl = process.env['GOOGLE_VERTEX_BASE_URL'];
    delete process.env['GOOGLE_GEMINI_BASE_URL'];
    delete process.env['GOOGLE_VERTEX_BASE_URL'];
    // Isolate verification's ~/.gemini file lookups: default to no files.
    vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
    // Existence too: the auth-mode scope walk probes settings.json paths, and
    // a REAL ~/.gemini/settings.json on the dev machine (absent on CI) would
    // otherwise exist-but-be-unreadable under the stub above and flip plans
    // to guided. Default to "no settings files anywhere".
    vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
    // Trust is hermetic by default: the workspace-trust guard (Codex round 12)
    // would otherwise probe the REAL ~/.gemini/trustedFolders.json. Prove
    // trust via the env channel (the mirror of upstream checkPathTrust step 2)
    // so the automatic plan stays testable; trust-specific tests override.
    originalTrustWorkspace = process.env['GEMINI_CLI_TRUST_WORKSPACE'];
    originalCloudShell = process.env['CLOUD_SHELL'];
    originalComputeAdc = process.env['GEMINI_CLI_USE_COMPUTE_ADC'];
    originalRestrictedMode = process.env['GEMINI_RESTRICTED_MODE'];
    process.env['GEMINI_CLI_TRUST_WORKSPACE'] = 'true';
    delete process.env['CLOUD_SHELL'];
    delete process.env['GEMINI_CLI_USE_COMPUTE_ADC'];
    delete process.env['GEMINI_RESTRICTED_MODE'];
  });

  afterEach(() => {
    if (originalGeminiBaseUrl === undefined) delete process.env['GOOGLE_GEMINI_BASE_URL'];
    else process.env['GOOGLE_GEMINI_BASE_URL'] = originalGeminiBaseUrl;
    if (originalVertexBaseUrl === undefined) delete process.env['GOOGLE_VERTEX_BASE_URL'];
    else process.env['GOOGLE_VERTEX_BASE_URL'] = originalVertexBaseUrl;
    if (originalTrustWorkspace === undefined) delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
    else process.env['GEMINI_CLI_TRUST_WORKSPACE'] = originalTrustWorkspace;
    if (originalCloudShell === undefined) delete process.env['CLOUD_SHELL'];
    else process.env['CLOUD_SHELL'] = originalCloudShell;
    if (originalComputeAdc === undefined) delete process.env['GEMINI_CLI_USE_COMPUTE_ADC'];
    else process.env['GEMINI_CLI_USE_COMPUTE_ADC'] = originalComputeAdc;
    if (originalRestrictedMode === undefined) delete process.env['GEMINI_RESTRICTED_MODE'];
    else process.env['GEMINI_RESTRICTED_MODE'] = originalRestrictedMode;
  });

  describe('detect', () => {
    it('should return true when Gemini CLI is detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('gemini');
    });

    it('should return false when CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create a plan with guided steps only', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('gemini-cli');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should include show-guided-steps actions', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);

      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('gemini-cli');
      expect(mainGuidance.data.limitation).toBe('restart-required-after-apply');
      expect(mainGuidance.data.optional).toBe(true);
      expect(mainGuidance.data.tier).toBe('A');
      expect(Array.isArray(mainGuidance.data.steps)).toBe(true);
      expect((mainGuidance.data.steps as string[]).length).toBeGreaterThan(0);
      expect((mainGuidance.data.steps as string[]).join('\n')).toContain('GOOGLE_GEMINI_BASE_URL');
    });

    it('writes GOOGLE_GEMINI_BASE_URL to the Gemini CLI env file automatically', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const configStep = plan.steps.find(s => s.action === 'edit-config-file');
      expect(configStep).toBeDefined();
      expect(configStep?.targetPath).toBe(nodePath.join(os.homedir(), '.gemini', '.env'));
      expect(configStep?.newValue).toBe(mockProfile.baseUrl);
      expect(configStep?.reversible).toBe(true);
      expect(configStep?.data).toMatchObject({
        driver: 'dotenv-var',
        envVarName: 'GOOGLE_GEMINI_BASE_URL',
        baseUrl: mockProfile.baseUrl
      });
    });

    it('persists the profile credential as GEMINI_API_KEY via write-env-file', async () => {
      const credentialProfile = { ...mockProfile, authRef: 'secret-ref' };
      const plan = await adapter.buildPlan(credentialProfile);

      const credentialStep = plan.steps.find(s => s.action === 'write-env-file');
      expect(credentialStep).toBeDefined();
      expect(credentialStep?.targetPath).toBe(nodePath.join(os.homedir(), '.gemini', '.env'));
      expect(credentialStep?.reversible).toBe(true);
      expect(credentialStep?.data).toMatchObject({
        secretPolicy: 'target-persisted-at-apply',
        missingSecretBehavior: 'remove-managed-key',
        authRef: 'secret-ref',
        envVarName: 'GEMINI_API_KEY'
      });
      expect(JSON.stringify(credentialStep?.data)).not.toContain('pat-');
    });

    it('falls back to profile.name as authRef when the profile has none', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const credentialStep = plan.steps.find(s => s.action === 'write-env-file');
      expect(credentialStep?.data.authRef).toBe(mockProfile.name);
    });

    it('targets $GEMINI_CLI_HOME/.gemini/.env when the home override is set', async () => {
      process.env['GEMINI_CLI_HOME'] = nodePath.join(os.tmpdir(), 'gemini-home-test');
      try {
        const plan = await adapter.buildPlan(mockProfile);

        const configStep = plan.steps.find(s => s.action === 'edit-config-file');
        expect(configStep?.targetPath).toBe(
          nodePath.join(nodePath.resolve(process.env['GEMINI_CLI_HOME']), '.gemini', '.env')
        );
      } finally {
        delete process.env['GEMINI_CLI_HOME'];
      }
    });

    it('ends the plan with an endpoint verification step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const verifyStep = plan.steps.find(s => s.action === 'verify-endpoint');
      expect(verifyStep).toBeDefined();
      expect(verifyStep?.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should include base URL in guidance', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.data.baseUrl).toBe(mockProfile.baseUrl);
    });

    it('should reject a base URL using a dangerous or unsupported scheme', async () => {
      const unsafeSchemes = [
        'javascript:alert(1)',
        'data:text/plain;base64,SGVsbG8=',
        'file:///etc/passwd',
        'ftp://example.com'
      ];

      for (const url of unsafeSchemes) {
        const unsafeProfile = { ...mockProfile, baseUrl: url };
        await expect(adapter.buildPlan(unsafeProfile)).rejects.toThrow(/invalid or uses an unsupported scheme/);
      }
    });

    it('guides instead of throwing for a plain http endpoint that is not localhost', async () => {
      const httpProfile = { ...mockProfile, baseUrl: 'http://gateway.example.com/v1' };
      const plan = await adapter.buildPlan(httpProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data).toMatchObject({
        limitation: 'gemini-cli-requires-https-base-url',
        baseUrl: 'http://gateway.example.com/v1',
        configurationStatus: 'unsupported'
      });
    });

    it('classifies non-loopback plain-http endpoints as unsupported in eligibility (Codex round 5, PR 118)', () => {
      const httpProfile = { ...mockProfile, baseUrl: 'http://gateway.example.com/v1' } as EndpointProfile;
      expect(adapter.getGuidedSetupStatus(httpProfile)).toBe('unsupported');
    });

    it('keeps loopback plain-http and HTTPS endpoints actionable in eligibility', () => {
      const loopbackProfile = { ...mockProfile, baseUrl: 'http://127.0.0.1:8080/v1' } as EndpointProfile;
      const localhostProfile = { ...mockProfile, baseUrl: 'http://localhost:8080/v1' } as EndpointProfile;
      const httpsProfile = { ...mockProfile, baseUrl: 'https://gateway.example.com/v1' } as EndpointProfile;

      expect(adapter.getGuidedSetupStatus(loopbackProfile)).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(localhostProfile)).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(httpsProfile)).toBe('actionable');
    });

    it('classifies unparseable base URLs as unsupported in eligibility (Codex round 5, PR 118)', () => {
      const invalidProfile = { ...mockProfile, baseUrl: 'not a url' } as EndpointProfile;
      expect(adapter.getGuidedSetupStatus(invalidProfile)).toBe('unsupported');
    });

    it('still rejects unsafe schemes outright', async () => {
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'javascript:alert(1)' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
      await expect(adapter.buildPlan({ ...mockProfile, baseUrl: 'file:///etc/passwd' }))
        .rejects.toThrow(/invalid or uses an unsupported scheme/);
    });

    it('classifies incompatible-dialect profiles as unsupported', async () => {
      const openaiProfile = { ...mockProfile, dialect: 'openai.chat_completions' } as EndpointProfile;

      const plan = await adapter.buildPlan(openaiProfile);

      const guidedStep = plan.steps[0];
      expect(guidedStep.action).toBe('show-guided-steps');
      expect(guidedStep.data.configurationStatus).toBe('unsupported');
      expect(guidedStep.data.limitation).toBe('unsupported-gemini-cli-dialect');
      expect(guidedStep.data.requestedDialect).toBe('openai.chat_completions');
      expect(String(guidedStep.data.message)).toContain('openai.chat_completions');
    });
  });

  describe('project env-file shadowing (Codex PR 159 round 8)', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = '';
    });

    afterEach(async () => {
      if (tempDir) {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    async function makeProjectDir(files: Record<string, string>): Promise<string> {
      tempDir = await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-shadow-'));
      for (const [relative, content] of Object.entries(files)) {
        const target = nodePath.join(tempDir, relative);
        await fs.mkdir(nodePath.dirname(target), { recursive: true });
        await fs.writeFile(target, content);
      }
      return tempDir;
    }

    function adapterWithProject(dirs: string[]): GeminiCliAdapter {
      const scoped = adapter as unknown as {
        getProjectCandidateDirs: () => Promise<string[]>;
      };
      vi.spyOn(scoped, 'getProjectCandidateDirs').mockResolvedValue(dirs);
      // The suite-wide beforeEach stubs readFileSafe to "no files"; restore
      // real filesystem reads AND existence so the shadowing helper (which
      // checks existence, per Gemini's existsSync selection) sees files.
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(
        (filePath: string) => fs.readFile(filePath, 'utf-8').catch(() => undefined)
      );
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(
        async (filePath: string) => fs.access(filePath).then(() => true, () => false)
      );
      return adapter;
    }

    it('reports guided steps when security.auth.selectedType pins an incompatible auth mode', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
      expect(plan.steps.some(s2 => s2.action === 'edit-config-file')).toBe(false);
    });

    it('reports guided steps when the pinned auth mode is compute-default-credentials (Code Assist bypasses the base URL)', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'compute-default-credentials' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
      expect(String(plan.steps[0].data.message)).toContain('compute-default-credentials');
    });

    it('reports guided steps for an unknown pinned auth mode (allowlist, not blocklist)', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'some-future-mode' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
    });

    it('keeps the automatic plan when the pinned auth mode is gateway-compatible', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(true);
    });

    it('reports guided steps when a WORKSPACE settings.json pins an incompatible auth mode', async () => {
      const project = await makeProjectDir({});
      adapterWithProject([project]);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(project, '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
      expect(String(plan.steps[0].data.message)).toContain(nodePath.join(project, '.gemini', 'settings.json'));
    });

    it('lets a higher-precedence workspace selection override an incompatible user pin', async () => {
      const project = await makeProjectDir({});
      adapterWithProject([project]);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(project, '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
        }
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
    });

    it('reports guided steps when an existing settings scope is unreadable (mode cannot be ruled out)', async () => {
      const userSettings = nodePath.join(os.homedir(), '.gemini', 'settings.json');
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(async (filePath: string) => filePath === userSettings);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
    });

    it('ignores ordinary project .env files as shadows when advanced.ignoreLocalEnv=true', async () => {
      const project = await makeProjectDir({});
      const shadowAdapter = adapterWithProject([project]);
      // Spies AFTER adapterWithProject: the project .env exists on disk but
      // the merged settings enable ignoreLocalEnv, so upstream skips generic
      // .env files while continuing the search — not a shadow.
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(project, '.gemini', 'settings.json')) {
          return JSON.stringify({ advanced: { ignoreLocalEnv: true } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(
        async (filePath: string) => filePath === nodePath.join(project, '.env')
      );

      const plan = await shadowAdapter.buildPlan(mockProfile);

      expect(plan.steps.every(s => s.data.limitation !== 'project-env-file-shadows-user-env-file')).toBe(true);
      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
    });

    it('still shadows on project .gemini/.env even when advanced.ignoreLocalEnv=true', async () => {
      const project = await makeProjectDir({});
      const shadowAdapter = adapterWithProject([project]);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(project, '.gemini', 'settings.json')) {
          return JSON.stringify({ advanced: { ignoreLocalEnv: true } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(
        async (filePath: string) => filePath === nodePath.join(project, '.gemini', '.env')
      );

      const plan = await shadowAdapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('project-env-file-shadows-user-env-file');
    });

    it('reports guided steps when an incompatible security.auth.enforcedType is pinned', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { enforcedType: 'oauth-personal' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
    });

    it('requires enforcedType to match the post-write gateway type (enforced gemini-api-key with no selection)', async () => {
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { enforcedType: 'gemini-api-key' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
    });

    it('evaluates each multi-root workspace auth configuration independently', async () => {
      const rootA = await makeProjectDir({});
      const rootB = await makeProjectDir({});
      const multiRootAdapter = adapterWithProject([rootA, rootB]);
      // Spies must be applied AFTER adapterWithProject (c5b7988 ordering).
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(rootA, '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
        }
        if (filePath === nodePath.join(rootB, '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await multiRootAdapter.buildPlan(mockProfile);
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
    });

    it('reports guided steps when inherited GOOGLE_GENAI auth selectors choose a non-gateway mode', async () => {
      process.env['GOOGLE_GENAI_USE_GCA'] = 'true';
      try {
        const plan = await adapter.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('inherited-google-auth-selector');
      } finally {
        delete process.env['GOOGLE_GENAI_USE_GCA'];
      }
    });

    it('accepts a commented (JSONC) settings.json as readable instead of undetermined', async () => {
      const commented = [
        '{',
        '  // enterprise baseline',
        '  "security": {',
        '    "auth": { "selectedType": "gemini-api-key" }',
        '  }',
        '}'
      ].join('\n');
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return commented;
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      // A compatible selectedType in a commented file must NOT force guided
      // steps: the automatic plan proceeds.
      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      expect(plan.steps.every(s => s.data.limitation !== 'selected-auth-type-incompatible-with-gateway')).toBe(true);
    });

    it('ignores workspace folderTrust=false in the INITIAL trust decision', async () => {
      const project = await makeProjectDir({});
      const trustAdapter = adapterWithProject([project]);
      // Spies AFTER adapterWithProject: workspace settings.json says trust is
      // disabled, but upstream resolves workspace settings only AFTER trust
      // is established — the pre-trust merge must exclude it.
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(project, '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { folderTrust: { enabled: false } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];

      const plan = await trustAdapter.buildPlan(mockProfile);

      // With the workspace scope excluded from the pre-trust merge, trust is
      // UNVERIFIABLE (no trustedFolders.json) → guided-required, NOT the
      // automatic plan the old workspace-inclusive merge produced.
      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('gemini-workspace-trust-unverifiable');
    });

    it('checks the system settings scope (GEMINI_CLI_SYSTEM_SETTINGS_PATH) for a pinned mode', async () => {
      const systemSettings = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-sys-')), 'settings.json');
      process.env['GEMINI_CLI_SYSTEM_SETTINGS_PATH'] = systemSettings;
      try {
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === systemSettings) {
            return JSON.stringify({ security: { auth: { selectedType: 'vertex-ai' } } });
          }
          return undefined;
        });
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

        const plan = await adapter.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
        expect(String(plan.steps[0].data.message)).toContain(systemSettings);
      } finally {
        delete process.env['GEMINI_CLI_SYSTEM_SETTINGS_PATH'];
      }
    });

    it('reports guided steps instead of automatic writes when a project .gemini/.env shadows the user-level file', async () => {
      const project = await makeProjectDir({ '.gemini/.env': 'OTHER=1\n' });

      const plan = await adapterWithProject([project]).buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      const guided = plan.steps[0];
      expect(guided.action).toBe('show-guided-steps');
      expect(guided.data.configurationStatus).toBe('manual-configuration-required');
      expect(guided.data.limitation).toBe('project-env-file-shadows-user-env-file');
      expect(String(guided.data.message)).toContain(nodePath.join(project, '.gemini', '.env'));
      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(false);
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(false);
    });

    it('reports guided steps when a project .env shadows the user-level file', async () => {
      const project = await makeProjectDir({ '.env': 'OTHER=1\n' });

      const plan = await adapterWithProject([project]).buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('project-env-file-shadows-user-env-file');
    });

    it('treats the OS home .env as a shadow when GEMINI_CLI_HOME overrides the effective home', async () => {
      const fakeHome = await makeProjectDir({});
      process.env['GEMINI_CLI_HOME'] = fakeHome;
      try {
        const osHome = os.homedir();
        // adapterWithProject restores REAL filesystem reads/existence; apply
        // its spies FIRST, then override existence so ONLY the OS home .env
        // appears to exist — a hermetic simulation of an OS home .env that is
        // otherwise absent on CI runners (no real ~/.gemini/.env either).
        const scoped = adapterWithProject([nodePath.join(osHome, 'project')]);
        vi.spyOn(fsSafe, 'fileExists').mockImplementation(
          async (filePath: string) => filePath === nodePath.join(osHome, '.env')
        );

        const plan = await scoped.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('project-env-file-shadows-user-env-file');
      } finally {
        delete process.env['GEMINI_CLI_HOME'];
      }
    });

    it('keeps the automatic write plan when no project env file exists', async () => {
      const project = await makeProjectDir({});
      adapterWithProject([project]);
      // Reads must report NO files anywhere: the real filesystem may contain
      // unrelated .env files in ancestor directories (e.g. /tmp, /).
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(true);
    });

    it('does not treat the write target itself or the home-level .env as a shadow', async () => {
      const { findProjectEnvShadowing } = await import('../../src/adapters/geminiCli/adapter');
      const { resolveGeminiEnvFilePath } = await import('../../src/adapters/geminiCli/adapter');
      const target = resolveGeminiEnvFilePath();
      const targetDir = nodePath.dirname(target);
      const targetFile = target;
      const homeEnv = nodePath.join(os.homedir(), '.env');
      const read = vi.fn(async (p: string) => (p === targetFile || p === homeEnv ? 'K=1\n' : undefined));

      const result = await findProjectEnvShadowing([targetDir, os.tmpdir()], read);

      expect(result).toBeUndefined();
    });

    it('findProjectEnvShadowing walks ancestor directories like upstream findEnvFile', async () => {
      const { findProjectEnvShadowing } = await import('../../src/adapters/geminiCli/adapter');
      const root = await makeProjectDir({ 'sub/.env': 'A=1\n' });
      const read = vi.fn(async (p: string) => (p === nodePath.join(root, 'sub', '.env') ? 'A=1\n' : undefined));

      const result = await findProjectEnvShadowing([nodePath.join(root, 'sub', 'deep')], read);

      expect(result).toBe(nodePath.join(root, 'sub', '.env'));
    });

  describe('settings precedence order (Codex round 12, PR 159)', () => {
    it('an incompatible SYSTEM override beats a compatible user pin (system overrides are highest)', async () => {
      const systemSettings = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-sys-')), 'settings.json');
      process.env['GEMINI_CLI_SYSTEM_SETTINGS_PATH'] = systemSettings;
      try {
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === systemSettings) {
            return JSON.stringify({ security: { auth: { selectedType: 'vertex-ai' } } });
          }
          if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
            return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
          }
          return undefined;
        });
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

        const plan = await adapter.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
        expect(String(plan.steps[0].data.message)).toContain(systemSettings);
      } finally {
        delete process.env['GEMINI_CLI_SYSTEM_SETTINGS_PATH'];
      }
    });

    it('a compatible USER selection overrides an incompatible system-defaults pin', async () => {
      const systemDefaults = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-sd-')), 'system-defaults.json');
      process.env['GEMINI_CLI_SYSTEM_DEFAULTS_PATH'] = systemDefaults;
      try {
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === systemDefaults) {
            return JSON.stringify({ security: { auth: { selectedType: 'oauth-personal' } } });
          }
          if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
            return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
          }
          return undefined;
        });
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

        const plan = await adapter.buildPlan(mockProfile);

        expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      } finally {
        delete process.env['GEMINI_CLI_SYSTEM_DEFAULTS_PATH'];
      }
    });

    it('reports guided steps when ONLY an incompatible system-defaults pin exists', async () => {
      const systemDefaults = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-sd-')), 'system-defaults.json');
      process.env['GEMINI_CLI_SYSTEM_DEFAULTS_PATH'] = systemDefaults;
      try {
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === systemDefaults) {
            return JSON.stringify({ security: { auth: { selectedType: 'vertex-ai' } } });
          }
          return undefined;
        });
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

        const plan = await adapter.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('selected-auth-type-incompatible-with-gateway');
        expect(String(plan.steps[0].data.message)).toContain(systemDefaults);
      } finally {
        delete process.env['GEMINI_CLI_SYSTEM_DEFAULTS_PATH'];
      }
    });
  });

  describe('inherited compute-ADC selectors (Codex round 12, PR 159)', () => {
    it('reports guided steps when CLOUD_SHELL=true is inherited and no auth type is selected', async () => {
      process.env['CLOUD_SHELL'] = 'true';
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].action).toBe('show-guided-steps');
      expect(plan.steps[0].data.limitation).toBe('inherited-compute-adc-selector');
      expect(String(plan.steps[0].data.message)).toContain('CLOUD_SHELL');
      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(false);
    });

    it('reports guided steps when GEMINI_CLI_USE_COMPUTE_ADC=true is inherited and no auth type is selected', async () => {
      process.env['GEMINI_CLI_USE_COMPUTE_ADC'] = 'true';
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps[0].data.limitation).toBe('inherited-compute-adc-selector');
    });

    it('keeps the automatic plan when a compatible auth type is pinned (upstream env branch does not fire)', async () => {
      process.env['CLOUD_SHELL'] = 'true';
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { auth: { selectedType: 'gemini-api-key' } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(true);
    });

    it('does not treat a non-"true" selector value as an inherited compute-ADC override', async () => {
      process.env['CLOUD_SHELL'] = 'false';
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
    });
  });

  describe('workspace trust gating (Codex round 12, PR 159)', () => {
    it('reports guided steps when GEMINI_CLI_TRUST_WORKSPACE=false makes the context explicitly untrusted', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      process.env['GEMINI_CLI_TRUST_WORKSPACE'] = 'false';

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].data.limitation).toBe('gemini-workspace-trust-unverifiable');
      expect(String(plan.steps[0].data.message)).toContain('explicitly untrusted');
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(false);
    });

    it('reports guided steps when GEMINI_RESTRICTED_MODE=true', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      process.env['GEMINI_RESTRICTED_MODE'] = 'true';

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps[0].data.limitation).toBe('gemini-workspace-trust-unverifiable');
    });

    it('keeps the automatic plan when security.folderTrust.enabled=false disables the trust feature', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath === nodePath.join(os.homedir(), '.gemini', 'settings.json')) {
          return JSON.stringify({ security: { folderTrust: { enabled: false } } });
        }
        return undefined;
      });
      vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      expect(plan.steps.some(s => s.action === 'write-env-file')).toBe(true);
    });

    it('reports guided steps when trust cannot be proven (no trustedFolders rule for the workspace)', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      const project = await makeProjectDir({});
      const trustedFolders = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-trust-')), 'trustedFolders.json');
      await fs.writeFile(trustedFolders, JSON.stringify({ '/some/other/folder': 'TRUST_FOLDER' }));
      process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'] = trustedFolders;
      try {
        // Fully hermetic: existence reports NO files anywhere (the real
        // filesystem may contain unrelated .env/settings files under /tmp or
        // the OS home), while reads serve ONLY the trustedFolders rules file.
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === trustedFolders) {
            return fs.readFile(filePath, 'utf-8').catch(() => undefined);
          }
          return undefined;
        });
        const scoped = adapter as unknown as {
          getProjectCandidateDirs: () => Promise<string[]>;
        };
        vi.spyOn(scoped, 'getProjectCandidateDirs').mockResolvedValue([project]);

        const plan = await scoped.buildPlan(mockProfile);

        expect(plan.steps).toHaveLength(1);
        expect(plan.steps[0].data.limitation).toBe('gemini-workspace-trust-unverifiable');
        expect(String(plan.steps[0].data.message)).toContain('cannot verify');
      } finally {
        delete process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'];
      }
    });

    it('keeps the automatic plan when a TRUST_FOLDER rule covers the workspace', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      const project = await makeProjectDir({});
      const trustedFolders = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-trust-')), 'trustedFolders.json');
      await fs.writeFile(trustedFolders, JSON.stringify({ [project]: 'TRUST_FOLDER' }));
      process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'] = trustedFolders;
      try {
        // Fully hermetic: existence reports NO files anywhere (the real
        // filesystem may contain unrelated .env/settings files under /tmp or
        // the OS home), while reads serve ONLY the trustedFolders rules file.
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === trustedFolders) {
            return fs.readFile(filePath, 'utf-8').catch(() => undefined);
          }
          return undefined;
        });
        const scoped = adapter as unknown as {
          getProjectCandidateDirs: () => Promise<string[]>;
        };
        vi.spyOn(scoped, 'getProjectCandidateDirs').mockResolvedValue([project]);
        const plan = await scoped.buildPlan(mockProfile);

        expect(plan.steps.some(s => s.action === 'edit-config-file')).toBe(true);
      } finally {
        delete process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'];
      }
    });

    it('reports guided steps when a DO_NOT_TRUST rule covers the workspace', async () => {
      delete process.env['GEMINI_CLI_TRUST_WORKSPACE'];
      const project = await makeProjectDir({});
      const trustedFolders = nodePath.join(await fs.mkdtemp(nodePath.join(os.tmpdir(), 'gemini-trust-')), 'trustedFolders.json');
      await fs.writeFile(trustedFolders, JSON.stringify({ [project]: 'DO_NOT_TRUST' }));
      process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'] = trustedFolders;
      try {
        // Fully hermetic: existence reports NO files anywhere (the real
        // filesystem may contain unrelated .env/settings files under /tmp or
        // the OS home), while reads serve ONLY the trustedFolders rules file.
        vi.spyOn(fsSafe, 'fileExists').mockResolvedValue(false);
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === trustedFolders) {
            return fs.readFile(filePath, 'utf-8').catch(() => undefined);
          }
          return undefined;
        });
        const scoped = adapter as unknown as {
          getProjectCandidateDirs: () => Promise<string[]>;
        };
        vi.spyOn(scoped, 'getProjectCandidateDirs').mockResolvedValue([project]);
        const plan = await scoped.buildPlan(mockProfile);

        expect(plan.steps[0].data.limitation).toBe('gemini-workspace-trust-unverifiable');
        expect(String(plan.steps[0].data.message)).toContain('explicitly untrusted');
      } finally {
        delete process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH'];
      }
    });
  });
  });

  describe('getGuidedSetupStatus', () => {
    it('is actionable for the declared Gemini dialect and dialect-agnostic callers', () => {
      expect(adapter.getGuidedSetupStatus()).toBe('actionable');
      expect(adapter.getGuidedSetupStatus(mockProfile)).toBe('actionable');
    });

    it('is unsupported for profile dialects the descriptor does not declare', () => {
      const openaiProfile = { ...mockProfile, dialect: 'openai.chat_completions' } as EndpointProfile;
      const anthropicProfile = { ...mockProfile, dialect: 'anthropic.messages' } as EndpointProfile;

      expect(adapter.getGuidedSetupStatus(openaiProfile)).toBe('unsupported');
      expect(adapter.getGuidedSetupStatus(anthropicProfile)).toBe('unsupported');
    });
  });

  describe('verify', () => {
    it('should return failure when CLI is not detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should require a gateway environment variable when CLI is only detected', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('installed');
      expect(result.details?.tier).toBe('A');
      expect(result.details?.cli).toBe(true);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
      expect(result.details?.supportedEnvironmentVariables).toEqual([
        'GOOGLE_GEMINI_BASE_URL',
        'GOOGLE_VERTEX_BASE_URL'
      ]);
    });

    it('should verify a configured gateway environment variable without exposing its value', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://gateway.example.com/v1beta';
      // GOOGLE_GEMINI_BASE_URL applies only under Gemini API-key auth, so
      // full "configured" classification requires auth-mode evidence.
      process.env['GEMINI_API_KEY'] = 'pat-token';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('environment-variable-configured');
      expect(result.details?.configuredEnvironmentVariables).toEqual(['GOOGLE_GEMINI_BASE_URL']);
      expect(JSON.stringify(result.details)).not.toContain('gateway.example.com');
      delete process.env['GEMINI_API_KEY'];
    });

    it('classifies a base-URL variable without matching auth evidence as unverified', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = 'https://gateway.example.com/v1beta';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configurationStatus).toBe('base-url-configured-unverified-source');
      expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    });

    it('treats an explicitly empty inherited variable as an override that blocks the file value', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      process.env['GOOGLE_GEMINI_BASE_URL'] = '';
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('strips unquoted inline comments from dotenv values', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com # corporate proxy\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    });

    it('should handle errors gracefully', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockRejectedValue(new Error('Test error'));

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });

  it('counts a base-URL variable persisted in the Gemini CLI .env file', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://gateway.example.com\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(JSON.stringify(result)).not.toContain('https://gateway.example.com');
    });

    it('does not treat a settings.json env object as a configuration surface', async () => {
      // The official settings schema (additionalProperties: false) has no
      // top-level env property, so settings.json cannot define variables.
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('settings.json')) {
          return JSON.stringify({ env: { GOOGLE_VERTEX_BASE_URL: 'https://gateway.example.com' } });
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('treats an invalid base-URL value as not configured', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=http://remote-host\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(JSON.stringify(result)).not.toContain('http://remote-host');
    });

    it('rejects non-HTTP schemes even on loopback hosts', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=ftp://localhost/v1\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
    });

    it('parses single-quoted dotenv values like the CLI does', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return "GOOGLE_GEMINI_BASE_URL='https://gateway.example.com'\n";
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(JSON.stringify(result)).not.toContain('gateway.example.com');
    });

    it('resolves the .env file under GEMINI_CLI_HOME/.gemini', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const original = process.env['GEMINI_CLI_HOME'];
      // Mirror the adapter: it resolves GEMINI_CLI_HOME before joining.
      const overrideHome = nodePath.resolve('/alt/gemini-home');
      process.env['GEMINI_CLI_HOME'] = '/alt/gemini-home';
      try {
        const expectedPath = nodePath.join(overrideHome, '.gemini', '.env');
        vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
          if (filePath === expectedPath) {
            return 'GOOGLE_VERTEX_BASE_URL="https://gateway.example.com"\n';
          }
          return undefined;
        });

        const result = await adapter.verify();

        expect(result.success).toBe(true);
        expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_VERTEX_BASE_URL');
        expect(result.details?.fileBasedEnvironmentVariables).toContain('GOOGLE_VERTEX_BASE_URL');
        expect(result.details?.configurationStatus).toBe('base-url-configured-unverified-source');
      } finally {
        if (original === undefined) delete process.env['GEMINI_CLI_HOME'];
        else process.env['GEMINI_CLI_HOME'] = original;
      }
    });

    it('falls back to the ordinary home .env when the Gemini-specific one is absent', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const realHome = os.homedir();
      const geminiEnvPath = nodePath.join(realHome, '.gemini', '.env');
      const homeEnvPath = nodePath.join(realHome, '.env');
      const readPaths: string[] = [];
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        readPaths.push(filePath);
        if (filePath === homeEnvPath) {
          return 'GOOGLE_GEMINI_BASE_URL="https://gateway.example.com"\n';
        }
        return undefined;
      });
      // Hermetic on hosts that really do have ~/.gemini/.env: existence —
      // not just content — decides the findEnvFile fallback, so stub it.
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(async (filePath: string) => filePath === homeEnvPath);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.configuredEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      // The Gemini-specific file must be consulted BEFORE the home .env.
      expect(readPaths.filter(p => p.endsWith('.env'))).toEqual([
        geminiEnvPath,
        homeEnvPath
      ]);
    });

    it('ignores a malformed user-level .env file instead of failing verification', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'this is not valid dotenv syntax at all';
        }
        return undefined;
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('honors the last duplicate assignment of the same key in a .env file', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      vi.spyOn(fsSafe, 'readFileSafe').mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.env')) {
          return 'GOOGLE_GEMINI_BASE_URL=https://first.example.com\nGOOGLE_GEMINI_BASE_URL=http://second.example.com\n';
        }
        return undefined;
      });

      const result = await adapter.verify();

      // dotenv.parse assigns on every match, so the LAST value is effective.
      expect(result.success).toBe(false);
      expect(result.details?.invalidEnvironmentVariables).toContain('GOOGLE_GEMINI_BASE_URL');
      expect(JSON.stringify(result)).not.toContain('first.example.com');
    });

    it('does not fall back to the home .env when the Gemini .env exists but is unreadable', async () => {
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);
      const realHome = os.homedir();
      vi.spyOn(fsSafe, 'readFileSafe').mockResolvedValue(undefined);
      vi.spyOn(fsSafe, 'fileExists').mockImplementation(async (filePath: string) => {
        // The Gemini-specific file exists on disk but the read failed.
        return filePath === nodePath.join(realHome, '.gemini', '.env');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('Gemini CLI');
    });
  });

  describe('getTier', () => {
    it('reports the registry Tier A of the automatic env-file writer', () => {
      expect(adapter.getTier()).toBe('A');
    });
  });
});
