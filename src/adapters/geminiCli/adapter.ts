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
import { fileExists, readFileSafe } from '../../util/fsSafe';
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

/**
 * The env file the adapter WRITES: Gemini CLI loads
 * `$GEMINI_CLI_HOME/.gemini/.env` (or `~/.gemini/.env`) at startup. This is
 * the primary location only — the CLI also falls back to an ordinary
 * `~/.env`, which the switchboard never touches.
 */
export function resolveGeminiEnvFilePath(): string {
  return path.join(resolveGeminiDir(), '.env');
}

/** The Gemini CLI configuration directory: `$GEMINI_CLI_HOME/.gemini` or `~/.gemini`. */
export function resolveGeminiDir(): string {
  const overrideHome = process.env['GEMINI_CLI_HOME']
    ? path.resolve(process.env['GEMINI_CLI_HOME'])
    : undefined;
  return overrideHome
    ? path.join(overrideHome, '.gemini')
    : path.join(os.homedir(), '.gemini');
}

/**
 * GOOGLE_GEMINI_BASE_URL applies only under Gemini API-key authentication
 * and GOOGLE_VERTEX_BASE_URL only under Vertex authentication (upstream
 * configuration reference). Without evidence that the matching auth mode
 * is selected, a variable can only be classified as present-but-unverified,
 * never as an active gateway configuration.
 */
function isAuthenticatedForVariable(name: string): boolean {
  if (name === 'GOOGLE_GEMINI_BASE_URL') {
    return Boolean(process.env['GEMINI_API_KEY'] || process.env['GOOGLE_API_KEY']);
  }
  if (name === 'GOOGLE_VERTEX_BASE_URL') {
    return Boolean(
      process.env['GOOGLE_APPLICATION_CREDENTIALS']
      || process.env['GOOGLE_CLOUD_PROJECT']
      || process.env['GOOGLE_CLOUD_LOCATION']
    );
  }
  return false;
}

async function discoverConfiguredBaseUrlVariables(): Promise<DiscoveredBaseUrlVariables> {
  const result: DiscoveredBaseUrlVariables = {
    configured: [],
    fileBased: [],
    invalid: []
  };
  const considered = new Set<string>();

  for (const name of SUPPORTED_BASE_URL_VARIABLES) {
    // Gemini's loader imports a file value only when the key is ABSENT
    // from the process environment (Object.hasOwn semantics): an
    // explicitly empty inherited variable BLOCKS the file value, so it
    // must be treated as an invalid override, not as absence.
    if (!Object.prototype.hasOwnProperty.call(process.env, name)) {
      continue;
    }
    const value = process.env[name];
    considered.add(name);
    if (value && isValidGeminiBaseUrl(value)) {
      if (isAuthenticatedForVariable(name)) {
        result.configured.push(name);
      } else {
        result.fileBased.push(name);
      }
    } else {
      result.invalid.push(name);
    }
  }

  // GEMINI_CLI_HOME is an alternate HOME: the CLI creates a `.gemini`
  // folder inside it (enterprise docs) and its homedir() uses the
  // override for BOTH fallback paths, so the env files live at
  // `$GEMINI_CLI_HOME/.gemini/.env` and `$GEMINI_CLI_HOME/.env`.
  const overrideHome = process.env['GEMINI_CLI_HOME']
    ? path.resolve(process.env['GEMINI_CLI_HOME'])
    : undefined;
  const userHome = overrideHome ?? os.homedir();
  const geminiDir = resolveGeminiDir();

  // findEnvFile's user-level fallback: after $GEMINI_CLI_HOME/.gemini/.env
  // (or ~/.gemini/.env), the CLI also loads an ordinary ~/.env. Its lookup
  // selects the first file that EXISTS (existsSync); a file that exists but
  // fails to read aborts the load without falling back, so mirror that:
  // consult the home .env only when the Gemini-specific file is truly
  // absent, never when it merely failed to read.
  const geminiEnvFile = path.join(geminiDir, '.env');
  let envFileContent = await readFileSafe(geminiEnvFile);
  if (envFileContent === undefined) {
    const geminiEnvExists = await fileExists(geminiEnvFile);
    if (!geminiEnvExists) {
      envFileContent = await readFileSafe(path.join(userHome, '.env'));
    }
  }
  if (envFileContent !== undefined) {
    // dotenv.parse assigns obj[key] = value for every match, so the LAST
    // assignment of a duplicate key is the effective one.
    const fileValues = new Map<string, string>();
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
      if (!(SUPPORTED_BASE_URL_VARIABLES as readonly string[]).includes(key)) {
        continue;
      }
      // dotenv.parse semantics (Gemini loads this file with dotenv): strip
      // unquoted inline comments, then matching single OR double quotes
      // around the value.
      let rawValue = line.slice(equals + 1).trim();
      const quoteChar = rawValue[0];
      if (quoteChar === '"' || quoteChar === '\'') {
        const closing = rawValue.lastIndexOf(quoteChar);
        if (closing > 0) {
          rawValue = rawValue.slice(0, closing + 1);
        }
        rawValue = rawValue.replace(/^(['"])(.*)\1$/, '$2');
      } else {
        const hash = rawValue.indexOf(' #');
        if (hash > 0) {
          rawValue = rawValue.slice(0, hash).trim();
        }
      }
      fileValues.set(key, rawValue);
    }

    for (const [key, rawValue] of fileValues) {
      // An inherited variable (even explicitly empty) blocks the file value.
      if (considered.has(key)) {
        continue;
      }
      considered.add(key);
      if (isValidGeminiBaseUrl(rawValue)) {
        // The user-level .env is a FALLBACK: a project `.gemini/.env` or
        // `.env` closer to the CLI's launch directory wins, so this is
        // present but not conclusively active for every invocation.
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

    if (profile.dialect !== 'google.gemini.generate_content') {
      // GOOGLE_GEMINI_BASE_URL only routes Gemini's own dialect — an
      // OpenAI/Anthropic profile cannot be pasted into that env var, so
      // report the plan as unsupported instead of promising guidance
      // (Codex round 4, PR 118).
      const unsupportedData = {
        message: `Gemini CLI cannot use the ${profile.dialect} profile dialect — GOOGLE_GEMINI_BASE_URL only applies to google.gemini.generate_content profiles`,
        steps: [
          'Create an endpoint profile using the google.gemini.generate_content dialect.',
          'Set GOOGLE_GEMINI_BASE_URL in the environment that launches Gemini CLI.',
        ],
        baseUrl: profile.baseUrl,
        limitation: 'unsupported-gemini-cli-dialect',
        requestedDialect: profile.dialect,
        tier: DESCRIPTOR?.tier ?? 'A',
        configurationStatus: 'unsupported',
      } satisfies GuidedStepsData;
      plan = addStep(plan, {
        action: 'show-guided-steps',
        description: 'Gemini CLI requires a Google Gemini dialect profile',
        assistantKey: 'gemini-cli',
        data: unsupportedData,
        reversible: false,
      });
      return plan;
    }

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
          configurationStatus: 'unsupported',
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
          tier: DESCRIPTOR?.tier ?? 'A'
        } satisfies GuidedStepsData,
        reversible: false
      });
    }

    const guidanceData = {
      message: 'Switchboard writes the gateway base URL to the Gemini CLI env file',
      steps: [
        `Switchboard writes GOOGLE_GEMINI_BASE_URL=${profile.baseUrl} to the Gemini CLI env file (${resolveGeminiEnvFilePath()}).`,
        'Switchboard also persists the profile credential as GEMINI_API_KEY in that same env file when the profile has a saved secret.',
        'Restart Gemini CLI (or start a new one) after applying so it loads the env file.',
        'Vertex AI authentication users: GOOGLE_VERTEX_BASE_URL must be set manually (see below) — the automatic write targets Gemini API-key authentication.'
      ],
      baseUrl: profile.baseUrl,
      envVarName: 'GOOGLE_GEMINI_BASE_URL',
      limitation: 'restart-required-after-apply',
      tier: DESCRIPTOR?.tier ?? 'A',
      optional: true
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Gemini CLI post-apply guidance',
      assistantKey: 'gemini-cli',
      data: guidanceData,
      reversible: false
    });

    const envFilePath = resolveGeminiEnvFilePath();
    plan = addStep(plan, {
      action: 'edit-config-file',
      description: 'Write GOOGLE_GEMINI_BASE_URL to the Gemini CLI env file',
      assistantKey: 'gemini-cli',
      targetPath: envFilePath,
      newValue: profile.baseUrl,
      data: {
        driver: 'dotenv-var',
        envVarName: 'GOOGLE_GEMINI_BASE_URL',
        baseUrl: profile.baseUrl
      },
      reversible: true
    });

    // Credential persistence: Gemini CLI loads the user-level env file
    // (~/.gemini/.env, honoring $GEMINI_CLI_HOME) via dotenv at startup.
    // The secret is resolved from SecretStorage at APPLY time and never
    // serialized into the plan. A previous profile's credential must never
    // survive a profile switch: remove ONLY the managed key when the newly
    // applied profile has no saved secret (Codex precedent).
    plan = addStep(plan, {
      action: 'write-env-file',
      description: 'Persist gateway credential to the Gemini CLI env file',
      assistantKey: 'gemini-cli',
      targetPath: envFilePath,
      data: {
        secretPolicy: 'target-persisted-at-apply',
        missingSecretBehavior: 'remove-managed-key',
        authRef: profile.authRef ?? profile.name,
        profileName: profile.name,
        envVarName: 'GEMINI_API_KEY'
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'verify-endpoint',
      description: 'Verify Gemini CLI configuration',
      assistantKey: 'gemini-cli',
      data: { baseUrl: profile.baseUrl },
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
    // "Configured" means a syntactically valid value exists somewhere the
    // CLI could read it; only auth-evidence-backed variables count as
    // fully verified (see isAuthenticatedForVariable).
    const anyPresent = discovered.configured.length + discovered.fileBased.length > 0;

    return {
      success: anyPresent,
      message: anyPresent
        ? (discovered.fileBased.length > 0
          ? 'Gemini CLI is installed and a gateway base-URL variable is present, but its active use is unverified (env-file sourcing, shadowing, workspace trust or unmatched authentication mode).'
          : 'Gemini CLI is installed and a supported gateway base-URL environment variable is configured.')
        : (discovered.invalid.length > 0
          ? 'Gemini CLI is installed, but the configured base-URL variable value is not a valid Gemini CLI endpoint (HTTPS required unless localhost).'
          : 'Gemini CLI is installed, but a supported gateway base-URL environment variable is not configured.'),
      details: { 
        cli: true,
        tier: DESCRIPTOR?.tier ?? 'A',
        configurationStatus: discovered.configured.length > 0
          ? 'environment-variable-configured'
          : (anyPresent ? 'base-url-configured-unverified-source' : 'manual-configuration-required'),
        limitation: 'Base URL overrides require GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL; values must be valid HTTPS URLs unless they point at localhost, and each variable applies only under its matching authentication mode. Which env file the CLI actually loads depends on its launch directory, workspace trust and project .gemini/.env / .env files (first match wins), so file-based or auth-unmatched detection is unverified until a request reaches the gateway.',
        supportedEnvironmentVariables: [...SUPPORTED_BASE_URL_VARIABLES],
        configuredEnvironmentVariables: [...discovered.configured, ...discovered.fileBased],
        fileBasedEnvironmentVariables: discovered.fileBased,
        invalidEnvironmentVariables: discovered.invalid
      }
    };
  }

  getDisplayName(): string {
    return 'Gemini CLI';
  }

  getTier(): 'A' | 'B' | 'C' {
    // Tier A: the switchboard writes the gateway base URL + credential into
    // the CLI's own user-level env file automatically (registry tier A) —
    // the hard-coded 'C' predates the automatic env-file writer and
    // contradicted the registry, the descriptor and the wizard guidance.
    return DESCRIPTOR?.tier ?? 'A';
  }

  /**
   * Gemini CLI's guided env setup is actionable only for the dialect its
   * descriptor declares — GOOGLE_GEMINI_BASE_URL is required for
   * `google.gemini.generate_content` and meaningless for OpenAI/Anthropic
   * profiles (Codex round 4, PR 118). Plain-HTTP non-loopback endpoints are
   * also unsupported: buildPlan rejects them (Gemini CLI upstream refuses
   * http:// on non-localhost hosts) and would only show an
   * explain-and-stop plan, so eligibility must not promise setup for them
   * (Codex round 5, PR 118).
   */
  getGuidedSetupStatus(profile?: EndpointProfile): 'actionable' | 'unsupported' {
    if (profile && profile.dialect !== 'google.gemini.generate_content') {
      return 'unsupported';
    }
    if (profile) {
      let parsedEndpoint: URL;
      try {
        parsedEndpoint = new URL(profile.baseUrl);
      } catch {
        return 'unsupported';
      }
      if (parsedEndpoint.protocol === 'http:'
        && !['localhost', '127.0.0.1', '[::1]'].includes(parsedEndpoint.hostname)) {
        return 'unsupported';
      }
    }
    return 'actionable';
  }
}
