/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import { validateUrl } from '../../core/profiles/profileValidator';
import { readFileSafe } from '../../util/fsSafe';
import * as os from 'node:os';
import * as path from 'node:path';

const DESCRIPTOR = getProviderConfigDescriptor('gemini-cli');

const SUPPORTED_BASE_URL_VARIABLES = ['GOOGLE_GEMINI_BASE_URL', 'GOOGLE_VERTEX_BASE_URL'] as const;

/**
 * Gemini CLI reads environment variables from more places than the parent
 * process: it auto-loads `~/.gemini/.env` (documented user-level env file —
 * variables from it are never excluded) and honors an `env` object inside
 * `~/.gemini/settings.json` (observed Gemini CLI settings format). A user
 * who persisted the override there would be falsely reported "not
 * configured" if verification only inspected process.env, so check all
 * three surfaces. Never report variable VALUES — only names/sources.
 */
async function discoverConfiguredBaseUrlVariables(): Promise<string[]> {
  const configured = new Set<string>();
  for (const name of SUPPORTED_BASE_URL_VARIABLES) {
    if (process.env[name]) {
      configured.add(name);
    }
  }

  const geminiHome = process.env['GEMINI_CLI_HOME']
    ? path.resolve(process.env['GEMINI_CLI_HOME'])
    : path.join(os.homedir(), '.gemini');

  const envFileContent = await readFileSafe(path.join(geminiHome, '.env'));
  if (envFileContent) {
    for (const rawLine of envFileContent.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.startsWith('#') || line.length === 0) {
        continue;
      }
      const equals = line.indexOf('=');
      if (equals <= 0) {
        continue;
      }
      const key = line.slice(0, equals).trim();
      if ((SUPPORTED_BASE_URL_VARIABLES as readonly string[]).includes(key)) {
        configured.add(key);
      }
    }
  }

  const settingsContent = await readFileSafe(path.join(geminiHome, 'settings.json'));
  if (settingsContent) {
    try {
      const parsed = JSON.parse(settingsContent) as { env?: Record<string, unknown> };
      if (parsed.env && typeof parsed.env === 'object') {
        for (const name of SUPPORTED_BASE_URL_VARIABLES) {
          if (typeof parsed.env[name] === 'string' && parsed.env[name]) {
            configured.add(name);
          }
        }
      }
    } catch {
      // Malformed settings.json must not break verification — the CLI
      // itself would report its own configuration problem.
    }
  }

  return [...configured];
}

/**
 * Gemini CLI adapter.
 */
export class GeminiCliAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  async detect(): Promise<boolean> {
    try {
      return await detectCli('gemini');
    } catch (error) {
      this.logger.error('Error detecting Gemini CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Gemini CLI endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['gemini-cli']);

    // Gemini CLI upstream refuses plain-HTTP base URLs unless they point at
    // localhost (geminicli.com configuration docs). A profile the creation
    // flow accepted with an http:// self-hosted gateway cannot be honored
    // here, so surface guided steps instead of throwing mid-plan (which
    // would leave assistants in mixed states) or guiding into a broken
    // configuration.
    const parsedEndpoint = new URL(profile.baseUrl);
    if (parsedEndpoint.protocol === 'http:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(parsedEndpoint.hostname)) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Gemini CLI requires an HTTPS gateway endpoint',
        assistantKey: 'gemini-cli',
        data: {
          message: 'Gemini CLI only accepts HTTPS base URLs (or localhost); choose an HTTPS gateway profile or front the gateway with TLS',
          steps: [
            'Gemini CLI rejects GOOGLE_GEMINI_BASE_URL / GOOGLE_VERTEX_BASE_URL values that use plain http:// on non-localhost hosts.',
            `The selected profile endpoint is: ${profile.baseUrl}`,
            'Either select a profile whose endpoint is HTTPS, or terminate TLS in front of the gateway (reverse proxy / load balancer) and use that HTTPS URL.',
            'localhost / 127.0.0.1 / [::1] endpoints are exempt from this upstream requirement.',
            'Re-run the wizard with an HTTPS endpoint, then set the variable as described below.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
          limitation: 'gemini-cli-requires-https-base-url',
          tier: DESCRIPTOR?.tier ?? 'C'
        } satisfies GuidedStepsData,
        reversible: false
      });
    }

    const guidanceData = {
      message: 'Gemini CLI supports gateway base URLs through environment variables',
      steps: [
        'Choose the environment variable that matches your Gemini CLI authentication mode:',
        '  - Gemini API key authentication: GOOGLE_GEMINI_BASE_URL',
        '  - Vertex AI authentication: GOOGLE_VERTEX_BASE_URL',
        `Set the selected variable to: ${profile.baseUrl}`,
        'For macOS/Linux: export VARIABLE_NAME="<your AIdome endpoint>"',
        'For Windows PowerShell: $env:VARIABLE_NAME="<your AIdome endpoint>"',
        'Persist the variable in your shell profile or a Gemini CLI .env file, then restart Gemini CLI',
        'Keep the existing Gemini API key or Vertex AI authentication configuration unchanged'
      ],
      baseUrl: profile.baseUrl,
      envVarName: 'GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
      limitation: 'environment-variable-configuration-required',
      tier: DESCRIPTOR?.tier ?? 'C'

    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Gemini CLI configuration guidance',
      assistantKey: 'gemini-cli',
      data: guidanceData,
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const cliDetected = await detectCli('gemini');
    
    if (!cliDetected) {
      return {
        success: false,
        message: 'Gemini CLI is not installed or not in PATH',
        details: { cli: false }
      };
    }

    const configuredEnvironmentVariables = await discoverConfiguredBaseUrlVariables();
    const configured = configuredEnvironmentVariables.length > 0;

    return {
      success: configured,
      message: configured
        ? 'Gemini CLI is installed and a supported gateway base-URL environment variable is configured.'
        : 'Gemini CLI is installed, but a supported gateway base-URL environment variable is not configured.',
      details: { 
        cli: true,
        tier: DESCRIPTOR?.tier ?? 'C',
        configurationStatus: configured ? 'environment-variable-configured' : 'manual-configuration-required',
        limitation: 'Base URL overrides require GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
        supportedEnvironmentVariables: [...SUPPORTED_BASE_URL_VARIABLES],
        configuredEnvironmentVariables
      }
    };
  }

  getDisplayName(): string {
    return 'Gemini CLI';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
