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
 * Detects a project-level env file that SHADOWS the user-level env file the
 * adapter writes (Codex PR 159 round 8).
 *
 * Gemini CLI's `findEnvFile` (upstream packages/cli/src/config/settings.ts)
 * loads the FIRST existing env file walking from the CLI's launch directory
 * toward the home directory — `<dir>/.gemini/.env`, then `<dir>/.env` — and
 * dotenv files are NOT merged. A project `.gemini/.env` or `.env` therefore
 * makes the CLI ignore `~/.gemini/.env` entirely: neither the base URL nor
 * the credential written there would ever load, while the applier would
 * still report the assistant as configured.
 *
 * Walk order mirrors upstream (`.gemini/.env` before `.env` per directory,
 * toward the home directory). The write target itself (`~/.gemini/.env`,
 * honoring $GEMINI_CLI_HOME) is never a shadow, and the home-level `.env`
 * is not one either: upstream checks `~/.gemini/.env` BEFORE `~/.env` at
 * the same directory, so the target outranks it once created.
 *
 * @param startDirs Candidate launch directories (e.g. VS Code workspace
 *   folders). Empty input yields no shadowing.
 * @param readFile injected for tests; defaults to readFileSafe.
 * @returns The first shadowing env-file path, or undefined.
 */
export async function findProjectEnvShadowing(
  startDirs: readonly string[],
  exists: (filePath: string) => Promise<boolean> = fileExists
): Promise<string | undefined> {
  const target = resolveGeminiEnvFilePath();
  const targetDir = path.dirname(target);
  // The walk must stop at the EFFECTIVE home — $GEMINI_CLI_HOME when set,
  // not the OS home. With an override, the OS home's own .env is an ordinary
  // project ancestor relative to Gemini's effective home and DOES shadow the
  // user-level file, so exempting it there would hide real shadowing.
  const overrideHome = process.env['GEMINI_CLI_HOME']
    ? path.resolve(process.env['GEMINI_CLI_HOME'])
    : undefined;
  const homeDir = overrideHome ?? os.homedir();

  for (const start of startDirs) {
    let current = path.resolve(start);
    while (true) {
      const geminiEnv = path.join(current, '.gemini', '.env');
      // Gemini selects env files by EXISTENCE (existsSync) and does not fall
      // back after selecting one — an unreadable file still shadows the
      // user-level file, so test existence, not readability.
      if (geminiEnv !== target && await exists(geminiEnv)) {
        return geminiEnv;
      }
      const envPath = path.join(current, '.env');
      if (current !== homeDir && current !== targetDir && await exists(envPath)) {
        return envPath;
      }
      if (current === homeDir || current === targetDir) {
        // At the home level the write target outranks every same-level or
        // higher file (upstream checks ~/.gemini/.env first), so nothing
        // above it can shadow.
        break;
      }
      const parentDir = path.dirname(current);
      if (parentDir === current || !parentDir) {
        break;
      }
      current = parentDir;
    }
  }
  return undefined;
}

/**
 * Auth modes under which the gateway variables are actually consulted
 * (upstream packages/core/src/core/contentGenerator.ts): 'gemini-api-key'
 * (USE_GEMINI) sends requests to GOOGLE_GEMINI_BASE_URL with the API key,
 * and 'gateway' is the mode the CLI itself selects when
 * GOOGLE_GEMINI_BASE_URL is already set. Every other mode bypasses those
 * variables — 'oauth-personal' and 'vertex-ai' route to Google backends,
 * and 'compute-default-credentials' (COMPUTE_ADC, e.g. Cloud Shell or
 * GEMINI_CLI_USE_COMPUTE_ADC) goes through the Code Assist branch, which
 * never reads the base URL. Only known-compatible modes are allowed:
 * an unknown pinned value is treated as incompatible rather than assumed
 * compatible (Codex round 11, PR 159).
 */
const GATEWAY_COMPATIBLE_AUTH_TYPES = new Set(['gemini-api-key', 'gateway']);

/**
 * System-wide settings path (upstream packages/cli/src/config/settings.ts
 * getSystemSettingsPath): $GEMINI_CLI_SYSTEM_SETTINGS_PATH when set, else a
 * platform-specific location. System settings participate in Gemini's merged
 * settings, so they can pin security.auth.selectedType too.
 */
function getSystemSettingsPath(): string {
  const override = process.env['GEMINI_CLI_SYSTEM_SETTINGS_PATH'];
  if (override) {
    return path.resolve(override);
  }
  switch (os.platform()) {
    case 'darwin':
      return '/Library/Application Support/GeminiCli/settings.json';
    case 'win32':
      return 'C:\\ProgramData\\gemini-cli\\settings.json';
    default:
      return '/etc/gemini-cli/settings.json';
  }
}

type AuthScopeRead =
  | { kind: 'absent' }
  | { kind: 'undetermined' }
  | { kind: 'read'; selectedType?: string; enforcedType?: string };

/**
 * Reads one settings.json scope. An EXISTING file that cannot be read or
 * parsed leaves the pinned mode UNDETERMINED — Gemini still merges that
 * scope, so a missing value there is not evidence of absence (mirrors the
 * existence-based shadow detection: Gemini's existsSync-based selection does
 * not fall back after selection).
 */
async function readAuthScope(filePath: string): Promise<AuthScopeRead> {
  const content = await readFileSafe(filePath);
  if (content === undefined) {
    if (await fileExists(filePath)) {
      return { kind: 'undetermined' };
    }
    return { kind: 'absent' };
  }
  let parsed: { security?: { auth?: { selectedType?: unknown; enforcedType?: unknown } } };
  try {
    parsed = JSON.parse(content);
  } catch {
    return { kind: 'undetermined' };
  }
  const auth = parsed.security?.auth;
  return {
    kind: 'read',
    selectedType: typeof auth?.selectedType === 'string' ? auth.selectedType : undefined,
    enforcedType: typeof auth?.enforcedType === 'string' ? auth.enforcedType : undefined
  };
}

type EffectiveGeminiAuth = {
  selectedType?: string;
  enforcedType?: string;
  sourcePath?: string;
  undetermined: boolean;
};

/**
 * Resolves the EFFECTIVE security.auth.selectedType/enforcedType across every
 * configuration scope Gemini merges (upstream settings.ts computeMergedSettings:
 * mergeSettings(system, systemDefaults, user, workspace) with LAST ONE WINS, so
 * workspace settings override user settings, which override system settings).
 * The extension host can only observe the workspace roots and the well-known
 * user/system paths — scopes are probed in precedence order and the FIRST scope
 * that defines each field wins; if a higher-precedence scope exists but cannot
 * be read, the result is undetermined and the caller must fall back to guided
 * steps instead of claiming automatic configuration (Codex round 11, PR 159).
 */
async function resolveEffectiveGeminiAuth(
  workspaceDirs: readonly string[]
): Promise<EffectiveGeminiAuth> {
  const scopes: string[] = [
    ...workspaceDirs.map(dir => path.join(dir, '.gemini', 'settings.json')),
    path.join(resolveGeminiDir(), 'settings.json'),
    getSystemSettingsPath()
  ];
  const result: EffectiveGeminiAuth = { undetermined: false };
  for (const scopePath of scopes) {
    const scope = await readAuthScope(scopePath);
    if (scope.kind === 'undetermined') {
      result.undetermined = true;
      break;
    }
    if (scope.kind === 'absent') {
      continue;
    }
    if (scope.selectedType !== undefined && result.selectedType === undefined) {
      result.selectedType = scope.selectedType;
      result.sourcePath = scopePath;
    }
    if (scope.enforcedType !== undefined && result.enforcedType === undefined) {
      result.enforcedType = scope.enforcedType;
      if (result.sourcePath === undefined) {
        result.sourcePath = scopePath;
      }
    }
  }
  return result;
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
    // explicitly empty inherited variable BLOCKS the file value, so an
    // inherited variable is evaluated from the environment while an
    // absent one falls through to the env-file discovery below.
    if (Object.prototype.hasOwnProperty.call(process.env, name)) {
      considered.add(name);
      const value = process.env[name];
      if (value && isValidGeminiBaseUrl(value)) {
        if (isAuthenticatedForVariable(name)) {
          result.configured.push(name);
        } else {
          result.fileBased.push(name);
        }
      } else {
        result.invalid.push(name);
      }
      continue;
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

  /**
   * Candidate CLI launch directories whose project-level `.gemini/.env` /
   * `.env` could shadow the user-level env file (Codex PR 159 round 8).
   * VS Code workspace folders are the best available proxy for where the
   * user launches Gemini CLI; resolved lazily so unit tests (and non-VS Code
   * hosts) degrade to "no candidates" instead of failing.
   */
  protected async getProjectCandidateDirs(): Promise<string[]> {
    try {
      const vscode = await import('vscode');
      const folders = vscode.workspace.workspaceFolders ?? [];
      return folders.map(folder => folder.uri.fsPath).filter(Boolean);
    } catch {
      return [];
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

    // Selected auth mode (Codex round 10, PR 159): Gemini's non-interactive
    // flow chooses security.auth.selectedType BEFORE environment discovery
    // (validateNonInteractiveAuth: effectiveAuthType = configuredAuthType ||
    // getAuthTypeFromEnv()), so a pinned mode wins even when
    // GOOGLE_GEMINI_BASE_URL is set. Only modes known to consult the gateway
    // variables are allowed (GATEWAY_COMPATIBLE_AUTH_TYPES); anything else —
    // oauth-personal, vertex-ai, compute-default-credentials (Code Assist
    // branch, base URL never read), or an unknown value — must be reported
    // as guided-required instead of configured (Codex round 11, PR 159).
    // The check covers EVERY merged scope (workspace > user > system) and
    // also security.auth.enforcedType, which upstream rejects a run for when
    // it differs from the effective type.
    const effectiveAuth = await resolveEffectiveGeminiAuth(
      await this.getProjectCandidateDirs()
    );
    const pinnedIncompatible =
      effectiveAuth.undetermined ||
      (effectiveAuth.selectedType !== undefined
        && !GATEWAY_COMPATIBLE_AUTH_TYPES.has(effectiveAuth.selectedType))
      || (effectiveAuth.enforcedType !== undefined
        && !GATEWAY_COMPATIBLE_AUTH_TYPES.has(effectiveAuth.enforcedType));
    if (pinnedIncompatible) {
      // eslint-disable-next-line no-console
      console.log('DBG', JSON.stringify(effectiveAuth));
      const pinnedMode = effectiveAuth.selectedType
        ?? effectiveAuth.enforcedType
        ?? 'unreadable';
      const settingsPath = effectiveAuth.sourcePath ?? getSystemSettingsPath();
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'The existing Gemini CLI installation is pinned to an incompatible auth mode',
        assistantKey: 'gemini-cli',
        data: {
          configurationStatus: 'manual-configuration-required',
          message: effectiveAuth.undetermined
            ? `A Gemini CLI settings scope that participates in the effective configuration (workspace, user, or system settings.json) could not be read, so the pinned authentication mode (security.auth.selectedType/enforcedType) cannot be ruled out. Gemini chooses its auth mode before reading environment variables, so Switchboard cannot verify that the gateway endpoint and API key it writes would be used.`
            : `The existing Gemini CLI installation selects "${pinnedMode}" authentication (security.auth in ${settingsPath}). Gemini chooses this mode before reading environment variables, so the gateway endpoint and API key Switchboard writes would be bypassed.`,
          steps: [
            effectiveAuth.undetermined
              ? `Make the unreadable settings file (${settingsPath}) readable or remove it, and ensure no merged scope (workspace, user, or system settings.json) pins security.auth.selectedType/enforcedType to a mode other than "gemini-api-key".`
              : `Switch the auth mode to Gemini API-key authentication (for example: gemini, then choose "Gemini API Key" in the auth dialog, or set security.auth.selectedType to "gemini-api-key" in ${settingsPath}).`,
            `Then reapply so Switchboard writes GOOGLE_GEMINI_BASE_URL=${profile.baseUrl} and the profile credential to ${resolveGeminiEnvFilePath()}.`,
            'Restart Gemini CLI (or start a new one) after the change so it reloads its configuration.',
            'Re-run the wizard afterwards to confirm the configuration.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL',
          limitation: 'selected-auth-type-incompatible-with-gateway',
          selectedAuthType: pinnedMode,
          tier: DESCRIPTOR?.tier ?? 'A'
        } satisfies GuidedStepsData,
        reversible: false
      });
    }

    // Inherited environment overrides (Codex round 9, PR 159): Gemini's
    // dotenv loader only imports a file value when the key is ABSENT from
    // the process environment, so when the extension host was started with
    // one of the managed variables already set (e.g. shell guidance from a
    // previous release), the automatic file write would have no effect while
    // reporting success. Report guided steps that ask for the variable to be
    // unset instead of claiming Tier A configuration.
    const inheritedOverrides = [
      ...SUPPORTED_BASE_URL_VARIABLES,
      'GEMINI_API_KEY',
      'GOOGLE_API_KEY'
    ].filter(name => Object.prototype.hasOwnProperty.call(process.env, name));
    if (inheritedOverrides.length > 0) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Inherited environment variables override the Gemini CLI env file',
        assistantKey: 'gemini-cli',
        data: {
          configurationStatus: 'manual-configuration-required',
          message: `The environment that launched this session already defines ${inheritedOverrides.join(', ')}. Gemini's dotenv loader leaves inherited variables in place and does not import the file value, so Switchboard's automatic write would have no effect.`,
          steps: [
            `Unset ${inheritedOverrides.join(' ')} in the shell profile or launcher that starts VS Code (or remove them from the session environment), then reapply.`,
            `Switchboard will then write the gateway endpoint (${profile.baseUrl}) to ${resolveGeminiEnvFilePath()} where Gemini actually reads it.`,
            'Restart Gemini CLI (or start a new one) after the change so it reloads its environment.',
            'Re-run the wizard afterwards to confirm the configuration.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL',
          limitation: 'inherited-env-overrides-gemini-env-file',
          inheritedOverrides,
          tier: DESCRIPTOR?.tier ?? 'A'
        } satisfies GuidedStepsData,
        reversible: false
      });
    }

    // Project env-file shadowing (Codex PR 159 round 8): Gemini CLI loads
    // the FIRST env file found walking from its launch directory (upstream
    // findEnvFile) and does not merge dotenv files. When a project-level
    // `.gemini/.env` or `.env` shadows the user-level file, the automatic
    // write below would never be read while the applier reported success —
    // so report guided steps instead of a false Tier A configuration.
    const shadowingEnvFile = await findProjectEnvShadowing(
      await this.getProjectCandidateDirs()
    );
    if (shadowingEnvFile) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'A project env file shadows the Gemini CLI user-level env file',
        assistantKey: 'gemini-cli',
        data: {
          configurationStatus: 'manual-configuration-required',
          message: `Gemini CLI loads ${shadowingEnvFile} instead of the user-level env file (project env files win and are not merged), so Switchboard's automatic write would have no effect.`,
          steps: [
            `Gemini CLI resolves its env file from its launch directory: ${shadowingEnvFile} is found before ${resolveGeminiEnvFilePath()} and dotenv files are not merged.`,
            `Either add GOOGLE_GEMINI_BASE_URL=${profile.baseUrl} (and GEMINI_API_KEY when the profile has a saved secret) directly to ${shadowingEnvFile}, or remove/rename that file so the user-level env file becomes active.`,
            'Restart Gemini CLI (or start a new one) after editing so it reloads the env file.',
            'If you launch Gemini from a terminal after cd-ing into a workspace subdirectory, a .env or .gemini/.env in THAT directory (or any directory between it and your home) also shadows the user-level env file — Gemini walks up from its launch directory, and project files win.',
            'Re-run the wizard afterwards to confirm the configuration.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL',
          limitation: 'project-env-file-shadows-user-env-file',
          shadowingEnvFile,
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
