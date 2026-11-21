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
 * Gemini CLI reads base-URL overrides from two places the extension host's
 * process.env cannot see: it auto-loads `~/.gemini/.env` (documented
 * user-level env file — variables from it are never excluded) as a
 * FALLBACK after project `.gemini/.env` / `.env` files, and honors
 * `$GEMINI_CLI_HOME/.gemini` as an alternate home. Never report variable
 * VALUES — only names and sources. Values must satisfy Gemini CLI's
 * documented constraint (valid URL, HTTPS unless a loopback host) before
 * counting as configured.
 */
interface DiscoveredBaseUrlVariables {
  configured: string[];
  fileBased: string[];
  invalid: string[];
}

function isValidGeminiBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.protocol === 'https:') {
      return true;
    }
    // Gemini documents HTTPS with a loopback exemption; any other scheme
    // (http on a remote host, ftp:, data:, ...) is rejected.
    return parsed.protocol === 'http:' && loopback;
  } catch {
    return false;
  }
}

async function discoverConfiguredBaseUrlVariables(): Promise<DiscoveredBaseUrlVariables> {
  const result: DiscoveredBaseUrlVariables = {
    configured: [],
    fileBased: [],
    invalid: []
  };
  const considered = new Set<string>();

  for (const name of SUPPORTED_BASE_URL_VARIABLES) {
    const value = process.env[name];
    if (!value) {
      continue;
    }
    considered.add(name);
    if (isValidGeminiBaseUrl(value)) {
      result.configured.push(name);
    } else {
      result.invalid.push(name);
    }
  }

  // GEMINI_CLI_HOME is an alternate HOME: the CLI creates a `.gemini`
  // folder inside it (enterprise docs), so the env file lives at
  // `$GEMINI_CLI_HOME/.gemini/.env`.
  const geminiDir = process.env['GEMINI_CLI_HOME']
    ? path.join(path.resolve(process.env['GEMINI_CLI_HOME']), '.gemini')
    : path.join(os.homedir(), '.gemini');

  const envFileContent = await readFileSafe(path.join(geminiDir, '.env'));
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
      const key = line.slice(0, equals).trim().replace(/^export /, '');
      if (!(SUPPORTED_BASE_URL_VARIABLES as readonly string[]).includes(key)
        || considered.has(key)) {
        continue;
      }
      considered.add(key);
      // dotenv.parse semantics (Gemini loads this file with dotenv): strip
      // matching single OR double quotes around the value.
      const value = line.slice(equals + 1).trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      if (isValidGeminiBaseUrl(value)) {
        result.configured.push(key);
        // The user-level .env is a FALLBACK: a project `.gemini/.env` or
        // `.env` closer to the CLI's launch directory wins, so this is
        // configured but not conclusively active for every invocation.
        result.fileBased.push(key);
      } else {
        result.invalid.push(key);
      }
    }
  }

  return result;
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

    const discovered = await discoverConfiguredBaseUrlVariables();
    const configured = discovered.configured.length > 0;

    return {
      success: configured,
      message: configured
        ? (discovered.fileBased.length > 0
          ? 'Gemini CLI is installed and a gateway base-URL variable is configured (from the user-level Gemini CLI .env file; a project .gemini/.env or .env closer to the CLI launch directory can shadow it).'
          : 'Gemini CLI is installed and a supported gateway base-URL environment variable is configured.')
        : (discovered.invalid.length > 0
          ? 'Gemini CLI is installed, but the configured base-URL variable value is not a valid Gemini CLI endpoint (HTTPS required unless localhost).'
          : 'Gemini CLI is installed, but a supported gateway base-URL environment variable is not configured.'),
      details: { 
        cli: true,
        tier: DESCRIPTOR?.tier ?? 'C',
        configurationStatus: configured
          ? (discovered.fileBased.length > 0 ? 'base-url-configured-unverified-source' : 'environment-variable-configured')
          : 'manual-configuration-required',
        limitation: 'Base URL overrides require GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL; values must be valid HTTPS URLs unless they point at localhost. Which env file the CLI actually loads depends on its launch directory, workspace trust and project .gemini/.env / .env files (first match wins), so file-based detection is unverified until a request reaches the gateway.',
        supportedEnvironmentVariables: [...SUPPORTED_BASE_URL_VARIABLES],
        configuredEnvironmentVariables: discovered.configured,
        fileBasedEnvironmentVariables: discovered.fileBased,
        invalidEnvironmentVariables: discovered.invalid
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
