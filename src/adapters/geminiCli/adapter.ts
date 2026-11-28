/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { parse as parseJsonc, ParseError } from 'jsonc-parser';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import { validateUrl } from '../../core/profiles/profileValidator';
import { fileExists, readFileSafe } from '../../util/fsSafe';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

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
 * platform-specific location. System settings are the HIGHEST-precedence
 * scope in Gemini's merge (they act as overrides), so they can pin
 * security.auth.selectedType over every other scope.
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

/**
 * System-defaults path (upstream packages/cli/src/config/settings.ts
 * getSystemDefaultsPath): $GEMINI_CLI_SYSTEM_DEFAULTS_PATH when set, else a
 * system-defaults.json next to the system settings file. System defaults are
 * the LOWEST-precedence merged scope (below user settings).
 */
function getSystemDefaultsPath(): string {
  const override = process.env['GEMINI_CLI_SYSTEM_DEFAULTS_PATH'];
  if (override) {
    return path.resolve(override);
  }
  return path.join(path.dirname(getSystemSettingsPath()), 'system-defaults.json');
}

type AuthScopeRead =
  | { kind: 'absent' }
  | { kind: 'undetermined' }
  | {
    kind: 'read';
    selectedType?: string;
    enforcedType?: string;
    folderTrustEnabled?: boolean;
  };

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
  let parsed: {
    security?: {
      auth?: { selectedType?: unknown; enforcedType?: unknown };
      folderTrust?: { enabled?: unknown };
    };
  };
  try {
    // Gemini parses settings scopes as JSONC (stripJsonComments before
    // JSON.parse, upstream settings.ts:1660). jsonc-parser is CJS-compatible
    // (strip-json-comments v5 is ESM-only, breaking CommonJS emit on older
    // VS Code extension hosts) and strips comments the same way; parse
    // errors mean the file cannot be classified.
    const errors: ParseError[] = [];
    parsed = parseJsonc(content, errors) as typeof parsed;
    if (errors.length > 0) {
      return { kind: 'undetermined' };
    }
  } catch {
    return { kind: 'undetermined' };
  }
  const auth = parsed.security?.auth;
  return {
    kind: 'read',
    selectedType: typeof auth?.selectedType === 'string' ? auth.selectedType : undefined,
    enforcedType: typeof auth?.enforcedType === 'string' ? auth.enforcedType : undefined,
    folderTrustEnabled: typeof parsed.security?.folderTrust?.enabled === 'boolean'
      ? parsed.security.folderTrust.enabled
      : undefined
  };
}

type EffectiveGeminiAuth = {
  selectedType?: string;
  enforcedType?: string;
  sourcePath?: string;
  undetermined: boolean;
};

/**
 * Per-launch-context resolution of security.auth.selectedType/enforcedType.
 * Upstream loadSettings loads exactly ONE workspace settings file from the
 * directory passed to it (settings.ts), so each candidate workspace root has
 * its OWN effective auth — a multi-root workspace is evaluated independently
 * per root (Codex round 13, PR 159: workspace roots are precedence layers
 * only for their OWN loadSettings call, not for each other).
 */
type EffectiveGeminiRoot = {
  dir?: string;
  undetermined: boolean;
  selectedType?: string;
  enforcedType?: string;
  sourcePath?: string;
};

/**
 * Resolves the effective security.auth.selectedType/enforcedType for EVERY
 * candidate launch context. Upstream mergeSettings (packages/cli/src/config/
 * settings.ts) merges with LAST ONE WINS: schema defaults, systemDefaults,
 * user, workspace, system (overrides), so SYSTEM settings.json is the
 * HIGHEST-precedence scope and systemDefaults the LOWEST. Scopes are probed
 * highest-precedence first and the FIRST scope that defines each field wins;
 * if a higher-precedence scope exists but cannot be read, that root's result
 * is undetermined and the caller must fall back to guided steps instead of
 * claiming automatic configuration (Codex round 12, PR 159).
 */
async function resolveEffectiveGeminiAuth(
  workspaceDirs: readonly string[]
): Promise<{ undetermined: boolean; roots: EffectiveGeminiRoot[] }> {
  const globalScopes = [
    path.join(resolveGeminiDir(), 'settings.json'),
    getSystemDefaultsPath()
  ];
  const rootFor = async (dir: string | undefined): Promise<EffectiveGeminiRoot> => {
    const scopes: string[] = [
      getSystemSettingsPath(),
      ...(dir ? [path.join(dir, '.gemini', 'settings.json')] : []),
      ...globalScopes
    ];
    const root: EffectiveGeminiRoot = { dir, undetermined: false };
    for (const scopePath of scopes) {
      const scope = await readAuthScope(scopePath);
      if (scope.kind === 'undetermined') {
        root.undetermined = true;
        break;
      }
      if (scope.kind === 'absent') {
        continue;
      }
      if (scope.selectedType !== undefined && root.selectedType === undefined) {
        root.selectedType = scope.selectedType;
        root.sourcePath = scopePath;
      }
      if (scope.enforcedType !== undefined && root.enforcedType === undefined) {
        root.enforcedType = scope.enforcedType;
        if (root.sourcePath === undefined) {
          root.sourcePath = scopePath;
        }
      }
    }
    return root;
  };
  const roots: EffectiveGeminiRoot[] = [];
  if (workspaceDirs.length === 0) {
    roots.push(await rootFor(undefined));
  } else {
    for (const dir of workspaceDirs) {
      roots.push(await rootFor(dir));
    }
  }
  return { undetermined: roots.some(r => r.undetermined), roots };
}

/**
 * A root's effective auth after the automatic write: an explicitly selected
 * type wins (configuredAuthType beats env discovery upstream), otherwise the
 * post-write environment discovery selects 'gateway' (getAuthTypeFromEnv
 * checks GOOGLE_GEMINI_BASE_URL before the API-key branch).
 */
function postWriteAuthType(root: EffectiveGeminiRoot): string {
  return root.selectedType ?? 'gateway';
}

function isRootAuthCompatible(root: EffectiveGeminiRoot): boolean {
  if (root.undetermined) {
    return false;
  }
  if (
    root.selectedType !== undefined
    && !GATEWAY_COMPATIBLE_AUTH_TYPES.has(root.selectedType)
  ) {
    return false;
  }
  // Upstream validateNonInteractiveAuth rejects any run whose effective type
  // differs from security.auth.enforcedType — the enforced value must equal
  // the selected or post-write effective type, not merely be allowlisted
  // (Codex round 13, PR 159: enforced 'gemini-api-key' with an env-discovered
  // 'gateway' effective type still exits with an authentication error).
  if (root.enforcedType !== undefined && root.enforcedType !== postWriteAuthType(root)) {
    return false;
  }
  return true;
}

/**
 * Resolves security.folderTrust.enabled across the merged scopes with
 * upstream's actual merge order (LOWEST first, last one wins): system
 * defaults → user → workspace → system overrides. Defaults to true, which
 * mirrors upstream's `settings.security?.folderTrust?.enabled ?? true`.
 */
async function resolveFolderTrustEnabled(
  workspaceDirs: readonly string[],
  options: { includeWorkspace?: boolean } = {}
): Promise<boolean | undefined> {
  // Upstream performs its INITIAL trust check over schema defaults, system
  // defaults, user settings, and system settings ONLY — workspace settings
  // are not resolved until trust has already been established (settings
  // loader order). An untrusted workspace that flips
  // security.folderTrust.enabled=false must therefore not disable the trust
  // requirement (Codex round 13, PR 159).
  const scopesLowestFirst: string[] = [
    getSystemDefaultsPath(),
    path.join(resolveGeminiDir(), 'settings.json'),
    ...(options.includeWorkspace === true
      ? workspaceDirs.map(dir => path.join(dir, '.gemini', 'settings.json'))
      : []),
    getSystemSettingsPath()
  ];
  let enabled: boolean | undefined = true;
  for (const scopePath of scopesLowestFirst) {
    const scope = await readAuthScope(scopePath);
    if (scope.kind === 'undetermined') {
      // A pre-trust scope that cannot be read leaves the initial trust
      // merge undetermined — never assume either way.
      return undefined;
    }
    if (scope.kind === 'read' && scope.folderTrustEnabled !== undefined) {
      enabled = scope.folderTrustEnabled;
    }
  }
  return enabled;
}

type WorkspaceTrustResolution = {
  trusted: boolean;
  /** true when trust could not be DETERMINED (neither proven nor disproven). */
  unverifiable: boolean;
};

/**
 * Normalizes a path for trust-rule comparison (upstream normalizePath +
 * canonicalization): resolved, forward-slash separators, case-insensitive on
 * case-insensitive filesystems (win32, darwin). Gemini canonicalizes BOTH
 * the launch directory and each rule path with realpath before comparing
 * (packages/core/src/utils/trust.ts:146-170), so a workspace that reaches a
 * location outside a trusted directory THROUGH a symlink is not trusted even
 * when its lexical path is inside. When a path (or a symlink target) cannot
 * be resolved on disk, the lexical resolution is used as the best available
 * approximation.
 */
function normalizeTrustPath(value: string): string {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(value);
  } catch {
    resolved = path.resolve(value);
  }
  const unified = resolved.replace(/\\/g, '/');
  return process.platform === 'win32' || process.platform === 'darwin'
    ? unified.toLowerCase()
    : unified;
}

function isTrustSubpath(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

/**
 * Mirrors LoadedTrustedFolders.isPathTrusted (upstream
 * packages/core/src/utils/trust.ts): longest matching rule wins;
 * TRUST_PARENT rules extend trust to the rule path's PARENT directory;
 * returns undefined when no rule matches.
 */
function isPathTrustedByRules(
  config: Record<string, unknown>,
  targetDir: string
): boolean | undefined {
  const normalizedTarget = normalizeTrustPath(targetDir);
  let longestRuleLength = -1;
  let longestTrust: string | undefined;
  for (const [rawPath, rawLevel] of Object.entries(config)) {
    if (
      rawLevel !== 'TRUST_FOLDER'
      && rawLevel !== 'TRUST_PARENT'
      && rawLevel !== 'DO_NOT_TRUST'
    ) {
      continue;
    }
    const effectivePath = rawLevel === 'TRUST_PARENT'
      ? path.dirname(rawPath)
      : rawPath;
    const normalizedRule = normalizeTrustPath(effectivePath);
    if (isTrustSubpath(normalizedRule, normalizedTarget) && rawPath.length > longestRuleLength) {
      longestRuleLength = rawPath.length;
      longestTrust = rawLevel;
    }
  }
  if (longestTrust === 'DO_NOT_TRUST') {
    return false;
  }
  return longestTrust === 'TRUST_FOLDER' || longestTrust === 'TRUST_PARENT'
    ? true
    : undefined;
}

/**
 * Resolves whether Gemini CLI would consider the candidate launch context
 * TRUSTED, mirroring upstream checkPathTrust (packages/core/src/utils/trust.ts)
 * as observable from the extension host:
 * 1. GEMINI_RESTRICTED_MODE=true / GEMINI_CLI_TRUST_WORKSPACE=false → untrusted.
 * 2. GEMINI_CLI_TRUST_WORKSPACE=true → trusted.
 * 3. security.folderTrust.enabled=false → trust feature disabled → trusted.
 * 4. The IDE trust channel (ideContextStore) is NOT observable from the
 *    extension host, so trust can only be proven via the trustedFolders.json
 *    rules file — a missing/unparsable file or an unmatched directory leaves
 *    trust UNVERIFIABLE. Upstream treats undetermined trust as UNTRUSTED at
 *    the env-file call site (`trustResult.isTrusted ?? false`, settings.ts),
 *    and untrusted findEnvFile skips EVERY .gemini/.env — including the
 *    user-level file this adapter writes — so an unverifiable context must
 *    not claim automatic configuration (Codex round 12, PR 159).
 */
async function resolveWorkspaceTrust(
  workspaceDirs: readonly string[]
): Promise<WorkspaceTrustResolution> {
  if (
    process.env['GEMINI_RESTRICTED_MODE'] === 'true'
    || process.env['GEMINI_CLI_TRUST_WORKSPACE'] === 'false'
  ) {
    return { trusted: false, unverifiable: false };
  }
  if (process.env['GEMINI_CLI_TRUST_WORKSPACE'] === 'true') {
    return { trusted: true, unverifiable: false };
  }
  const folderTrustEnabled = await resolveFolderTrustEnabled(workspaceDirs);
  if (folderTrustEnabled === undefined) {
    // A pre-trust scope exists but cannot be read: upstream's initial trust
    // merge cannot be resolved, so trust is unverifiable.
    return { trusted: false, unverifiable: true };
  }
  if (!folderTrustEnabled) {
    return { trusted: true, unverifiable: false };
  }
  const trustedFoldersPath = process.env['GEMINI_CLI_TRUSTED_FOLDERS_PATH']
    ?? path.join(resolveGeminiDir(), 'trustedFolders.json');
  const content = await readFileSafe(trustedFoldersPath);
  if (content === undefined) {
    return { trusted: false, unverifiable: true };
  }
  let parsed: unknown;
  try {
    // trustedFolders.json is parsed by Gemini with JSON comments stripped
    // (upstream packages/core/src/utils/trust.ts:94-99). jsonc-parser keeps
    // CJS compatibility and reports failures via the errors array.
    const errors: ParseError[] = [];
    parsed = parseJsonc(content, errors);
    if (errors.length > 0) {
      return { trusted: false, unverifiable: true };
    }
  } catch {
    return { trusted: false, unverifiable: true };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { trusted: false, unverifiable: true };
  }
  if (workspaceDirs.length === 0) {
    // Upstream resolves trust for the CLI process's working directory, which
    // the extension host cannot observe when no workspace is open.
    return { trusted: false, unverifiable: true };
  }
  for (const dir of workspaceDirs) {
    const trusted = isPathTrustedByRules(parsed as Record<string, unknown>, dir);
    if (trusted !== true) {
      return { trusted: false, unverifiable: trusted === undefined };
    }
  }
  return { trusted: true, unverifiable: false };
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
    // The check covers EVERY merged scope in upstream's real precedence order
    // (system overrides > workspace > user > system defaults) and
    // also security.auth.enforcedType, which upstream rejects a run for when
    // it differs from the effective type.
    const projectCandidateDirs = await this.getProjectCandidateDirs();
    const effectiveAuth = await resolveEffectiveGeminiAuth(
      projectCandidateDirs
    );
    const incompatibleRoot = effectiveAuth.roots.find(root => !isRootAuthCompatible(root));
    if (effectiveAuth.undetermined || incompatibleRoot) {
      const pinnedMode = incompatibleRoot
        ? (incompatibleRoot.selectedType
          ?? incompatibleRoot.enforcedType
          ?? 'unreadable')
        : 'unreadable';
      const settingsPath = incompatibleRoot?.sourcePath ?? getSystemSettingsPath();
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'The existing Gemini CLI installation is pinned to an incompatible auth mode',
        assistantKey: 'gemini-cli',
        data: {
          configurationStatus: 'manual-configuration-required',
          message: effectiveAuth.undetermined
            ? `A Gemini CLI settings scope that participates in the effective configuration (system overrides, workspace, user, or system-defaults settings.json) could not be read, so the pinned authentication mode (security.auth.selectedType/enforcedType) cannot be ruled out. Gemini chooses its auth mode before reading environment variables, so Switchboard cannot verify that the gateway endpoint and API key it writes would be used.`
            : `The existing Gemini CLI installation selects "${pinnedMode}" authentication (security.auth in ${settingsPath}). Gemini chooses this mode before reading environment variables, so the gateway endpoint and API key Switchboard writes would be bypassed.`,
          steps: [
            effectiveAuth.undetermined
              ? `Make the unreadable settings file (${settingsPath}) readable or remove it, and ensure no merged scope (system overrides, workspace, user, or system-defaults settings.json) pins security.auth.selectedType/enforcedType to a mode other than "gemini-api-key".`
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

    // Inherited compute-ADC selectors (Codex round 12, PR 159): when NO auth
    // type is selected, Gemini's startup persists compute-default-credentials
    // purely from the environment (packages/cli/src/gemini.tsx: CLOUD_SHELL
    // or GEMINI_CLI_USE_COMPUTE_ADC === 'true' → security.auth.selectedType =
    // COMPUTE_ADC), and getAuthTypeFromEnv (packages/core/src/core/
    // contentGenerator.ts) selects COMPUTE_ADC from the same variables. The
    // Code Assist branch never reads GOOGLE_GEMINI_BASE_URL, so the written
    // gateway file would be bypassed — classify these sessions as
    // guided-required too. A COMPATIBLE pinned selectedType suppresses the
    // upstream env branch, so it keeps the automatic plan.
    const hasUnselectedRoot = effectiveAuth.roots.some(
      root => root.undetermined || root.selectedType === undefined
    );
    if (hasUnselectedRoot) {
      const inheritedAdcSelectors = ['CLOUD_SHELL', 'GEMINI_CLI_USE_COMPUTE_ADC']
        .filter(name => process.env[name] === 'true');
      if (inheritedAdcSelectors.length > 0) {
        return addStep(plan, {
          action: 'show-guided-steps',
          description: 'Inherited compute-ADC selectors bypass the gateway',
          assistantKey: 'gemini-cli',
          data: {
            configurationStatus: 'manual-configuration-required',
            message: `The environment that launched this session sets ${inheritedAdcSelectors.join(', ')} to "true" while no auth type is selected. Gemini CLI startup then selects compute-default-credentials (Code Assist) authentication and persists it, and those requests never read GOOGLE_GEMINI_BASE_URL — the gateway endpoint Switchboard writes would be bypassed.`,
            steps: [
              `Unset ${inheritedAdcSelectors.join(' ')} in the shell profile or launcher that starts VS Code, or pin security.auth.selectedType to "gemini-api-key" in the Gemini settings.`,
              `Switchboard will then write the gateway endpoint (${profile.baseUrl}) to ${resolveGeminiEnvFilePath()} where Gemini actually reads it.`,
              'Restart Gemini CLI (or start a new one) after the change so it reloads its configuration.',
              'Re-run the wizard afterwards to confirm the configuration.'
            ],
            baseUrl: profile.baseUrl,
            envVarName: 'GOOGLE_GEMINI_BASE_URL',
            limitation: 'inherited-compute-adc-selector',
            inheritedAdcSelectors,
            tier: DESCRIPTOR?.tier ?? 'A'
          } satisfies GuidedStepsData,
          reversible: false
        });
      }
    }

    // Inherited Google auth-mode selectors (Codex round 13, PR 159):
    // getAuthTypeFromEnv (packages/core/src/core/contentGenerator.ts) checks
    // GOOGLE_GENAI_USE_GCA=true and GOOGLE_GENAI_USE_VERTEXAI=true BEFORE
    // GOOGLE_GEMINI_BASE_URL, so with no selectedType these inherited values
    // select OAuth or Vertex authentication and bypass the written gateway
    // file entirely — guided-required, like the compute-ADC selectors.
    if (hasUnselectedRoot) {
      const inheritedAuthSelectors = [
        'GOOGLE_GENAI_USE_GCA',
        'GOOGLE_GENAI_USE_VERTEXAI'
      ].filter(name => process.env[name] === 'true');
      if (inheritedAuthSelectors.length > 0) {
        return addStep(plan, {
          action: 'show-guided-steps',
          description: 'Inherited Google auth-mode selectors bypass the gateway',
          assistantKey: 'gemini-cli',
          data: {
            configurationStatus: 'manual-configuration-required',
            message: `The environment that launched this session sets ${inheritedAuthSelectors.join(', ')} to "true" while no auth type is selected. Gemini's environment authentication discovery checks these selectors before GOOGLE_GEMINI_BASE_URL and then selects OAuth or Vertex authentication, so the gateway endpoint Switchboard writes would be bypassed.`,
            steps: [
              `Unset ${inheritedAuthSelectors.join(' ')} in the shell profile or launcher that starts VS Code, or pin security.auth.selectedType to "gemini-api-key" in the Gemini settings.`,
              `Switchboard will then write the gateway endpoint (${profile.baseUrl}) to ${resolveGeminiEnvFilePath()} where Gemini actually reads it.`,
              'Restart Gemini CLI (or start a new one) after the change so it reloads its configuration.',
              'Re-run the wizard afterwards to confirm the configuration.'
            ],
            baseUrl: profile.baseUrl,
            envVarName: 'GOOGLE_GEMINI_BASE_URL',
            limitation: 'inherited-google-auth-selector',
            inheritedAuthSelectors,
            tier: DESCRIPTOR?.tier ?? 'A'
          } satisfies GuidedStepsData,
          reversible: false
        });
      }
    }

    // Inherited environment overrides (Codex round 9, PR 159): Gemini's
    // dotenv loader only imports a file value when the key is ABSENT from
    // the process environment, so when the extension host was started with
    // one of the managed variables already set (e.g. shell guidance from a
    // previous release), the automatic file write would have no effect while
    // reporting success. Report guided steps that ask for the variable to be
    // unset instead of claiming Tier A configuration.
    const inheritedOverrides = [
      // Only the two MANAGED values can supersede the automatic gateway
      // configuration: post-write, Gemini selects 'gateway' (via the file's
      // GOOGLE_GEMINI_BASE_URL) and reads GEMINI_API_KEY — GOOGLE_API_KEY is
      // not consulted by the gateway mode and GOOGLE_VERTEX_BASE_URL only
      // matters under vertex-ai, so neither justifies guided steps
      // (Codex round 14, PR 159).
      'GOOGLE_GEMINI_BASE_URL',
      'GEMINI_API_KEY'
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
      projectCandidateDirs
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

    // Workspace trust gating (Codex round 12, PR 159): upstream findEnvFile
    // consults .gemini/.env candidates only when the launch context is
    // TRUSTED (packages/cli/src/config/settings.ts: findEnvFile's isTrusted
    // parameter, resolved via isWorkspaceTrusted → checkPathTrust). An
    // untrusted context skips EVERY .gemini/.env — including the user-level
    // file this adapter writes — and falls back to an ordinary .env, so the
    // written endpoint and credential would never be loaded. The extension
    // host cannot observe the IDE trust channel, so trust must be provable
    // via the env override, the folder-trust setting, or the trustedFolders
    // rules file; otherwise report guided steps instead of a false Tier A
    // configuration.
    const workspaceTrust = await resolveWorkspaceTrust(projectCandidateDirs);
    if (!workspaceTrust.trusted) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Gemini CLI workspace trust could not be verified for the launch context',
        assistantKey: 'gemini-cli',
        data: {
          configurationStatus: 'manual-configuration-required',
          message: workspaceTrust.unverifiable
            ? `Gemini CLI loads .gemini/.env files only from a trusted launch context, and Switchboard cannot verify that this context is trusted (the IDE trust decision Gemini makes at startup is not observable here). In an untrusted context Gemini skips every .gemini/.env — including the user-level file Switchboard writes — so the gateway endpoint and credential would not be loaded.`
            : `The launch context is explicitly untrusted for Gemini CLI (restricted mode or GEMINI_CLI_TRUST_WORKSPACE=false, or a DO_NOT_TRUST rule covers it). Gemini skips every .gemini/.env — including the user-level file Switchboard writes — so the gateway endpoint and credential would not be loaded.`,
          steps: [
            'Trust the launch folder for Gemini CLI (answer "Trust" in Gemini\'s folder-trust dialog), or set GEMINI_CLI_TRUST_WORKSPACE=true in the environment that launches Gemini, or add a TRUST_FOLDER rule for the folder in ~/.gemini/trustedFolders.json.',
            'Alternatively set security.folderTrust.enabled to false in the Gemini settings if folder trust is not wanted.',
            `Then reapply so Switchboard writes GOOGLE_GEMINI_BASE_URL=${profile.baseUrl} and the profile credential to ${resolveGeminiEnvFilePath()}.`,
            'Restart Gemini CLI (or start a new one) after the change so it reloads its configuration.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL',
          limitation: 'gemini-workspace-trust-unverifiable',
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
