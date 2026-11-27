/**
 * Configuration file patcher for OpenCode CLI.
 * Handles the legacy `provider.<id>` config file shape used by installed
 * opencode releases (verified live against opencode 1.19.5; the newer
 * top-level `providers` + `package`/`settings` upstream shape is NOT
 * accepted by installed releases).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { createBackup, fileExists, readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';
import { expandTilde } from '../../util/paths';
import { validateUrl } from '../../core/profiles/profileValidator';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';

export const OPENCODE_PROVIDER_ID = 'aidome';
export const OPENCODE_PROVIDER_NPM = '@ai-sdk/openai-compatible';
export const OPENCODE_PROVIDER_NAME = 'AIdome Gateway';

interface OpenCodeProviderConfig {
  npm?: string;
  name?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    [key: string]: unknown;
  };
  models?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OpenCodeConfig {
  provider?: Record<string, OpenCodeProviderConfig>;
  [key: string]: unknown;
}

export interface OpenCodeConfigBuildOptions {
  /** Gateway PAT resolved from SecretStorage at apply time; never logged. */
  apiKey?: string;
  /** Discovered model id to expose in the managed provider's models map. */
  model?: string;
}

/**
 * Gets the OpenCode config path.
 *
 * Resolution order (mirrors the snap-aware Codex pattern):
 *  1. OPENCODE_CONFIG (upstream explicit-config-file env, highest vendor
 *     priority — packages/cli/src/server-process.ts passes it as the explicit
 *     config source, which overrides the global directory)
 *  2. OPENCODE_CONFIG_PATH explicit override (Switchboard's own escape hatch)
 *  3. ~/.config/opencode/opencode.json[c] (standard location; upstream
 *     resolves the global config dir as $XDG_CONFIG_HOME/opencode, with
 *     OPENCODE_CONFIG_DIR overriding it — packages/util/src/global.ts:7,79)
 *  4. snap-confined candidates: $SNAP_USER_COMMON/opencode.json, then the
 *     newest numeric ~/snap/opencode/<revision>/opencode.json
 *
 * Within a directory, an existing `.jsonc` file is preferred over `.json`:
 * upstream loads both and merges documents lowest-to-highest priority in
 * ConfigDiscovery.names order ("opencode.json" then "opencode.jsonc"), so a
 * key present in both files resolves to the `.jsonc` value, and upstream's
 * own config writer also picks the `.jsonc` candidate when both exist
 * (packages/core/src/config.ts `Effect.filter(candidates, fs.isFile)).at(-1)`).
 * Writing to `.json` when `.jsonc` also defines the managed provider would
 * therefore be shadowed.
 * @returns Config file path
 */
export function getOpenCodeConfigPath(): string {
  const vendorExplicitConfig = process.env.OPENCODE_CONFIG?.trim();
  if (vendorExplicitConfig) {
    return expandTilde(vendorExplicitConfig);
  }

  const explicitConfigPath = process.env.OPENCODE_CONFIG_PATH?.trim();
  if (explicitConfigPath) {
    return expandTilde(explicitConfigPath);
  }

  const snapCommon = process.env.SNAP_USER_COMMON?.trim();
  const snapCommonConfig = snapCommon
    ? path.join(snapCommon, 'opencode.json')
    : undefined;

  // Upstream: OPENCODE_CONFIG_DIR replaces the global config directory
  // (packages/util/src/global.ts), which defaults to $XDG_CONFIG_HOME/opencode
  // and then ~/.config/opencode (packages/util/src/global-roots.ts).
  const configDirOverride = process.env.OPENCODE_CONFIG_DIR?.trim();
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim();
  const standardDir = configDirOverride
    ? expandTilde(configDirOverride)
    : xdgConfigHome
      ? path.join(expandTilde(xdgConfigHome), 'opencode')
      : expandTilde('~/.config/opencode');

  if (configDirOverride) {
    // An explicit directory override REPLACES the global directory: snap
    // candidates live in a different HOME than the one OpenCode reads with
    // this override set, so never fall through to them — pick the config
    // inside the override directory only.
    return pickExistingConfigVariant([path.join(standardDir, 'opencode.json')])
      ?? path.join(standardDir, 'opencode.json');
  }

  const candidates: string[] = [
    path.join(standardDir, 'opencode.json'),
    ...(snapCommonConfig ? [snapCommonConfig] : [])
  ];

  // Snap runs opencode with a confined HOME (for example ~/snap/opencode/299).
  // The extension host does not inherit that HOME, so prefer the current
  // numeric snap revision when it has a config file.
  const snapRoot = path.join(os.homedir(), 'snap', 'opencode');
  try {
    const revisions = fs.readdirSync(snapRoot)
      .filter(revision => /^\d+$/.test(revision))
      .sort((left, right) => Number(right) - Number(left));
    for (const revision of revisions) {
      candidates.push(path.join(snapRoot, revision, 'opencode.json'));
    }
  } catch {
    // A missing snap installation is normal; use the standard opencode path.
  }
  candidates.push(path.join(snapRoot, 'common', 'opencode.json'));

  for (const candidate of candidates) {
    const selected = pickExistingConfigVariant([candidate]);
    if (selected !== undefined) {
      return selected;
    }
  }

  return path.join(standardDir, 'opencode.json');
}

/** Returns the first candidate that exists, preferring an existing .jsonc sibling. */
function pickExistingConfigVariant(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    // Prefer an existing .jsonc sibling: upstream merges documents in
    // ["opencode.json", "opencode.jsonc"] order, so .jsonc has the higher
    // priority and a .json write would be shadowed when both exist.
    const jsoncVariant = candidate.replace(/\.json$/, '.jsonc');
    if (fs.existsSync(jsoncVariant)) {
      return jsoncVariant;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Builds OpenCode config content with the AIdome gateway provider configured.
 * Preserves all unknown top-level fields (for example `$schema`) and unrelated
 * providers; only the managed `aidome` provider entry is mutated.
 * @param baseUrl Base URL to set (normalized to a single `/v1` suffix)
 * @param existingContent Existing config content, if any
 * @param options Optional API key and model id
 * @returns Updated config JSON content
 */
export function buildOpenCodeConfigContent(
  baseUrl: string,
  existingContent?: string,
  options: OpenCodeConfigBuildOptions = {}
): string {
  if (!validateUrl(baseUrl)) {
    throw new Error('Invalid OpenCode endpoint URL');
  }

  const config = parseOpenCodeConfig(existingContent);
  const provider = isRecord(config.provider) ? config.provider : {};
  const existing = isRecord(provider[OPENCODE_PROVIDER_ID])
    ? provider[OPENCODE_PROVIDER_ID] as OpenCodeProviderConfig
    : {};
  const existingOptions = isRecord(existing.options) ? existing.options : {};

  const nextOptions: OpenCodeProviderConfig['options'] = { ...existingOptions };
  // Gateway URLs already end with `/v1`; normalizeOpenAiBaseUrl is idempotent,
  // so appending never doubles the version suffix.
  nextOptions.baseURL = normalizeOpenAiBaseUrl(baseUrl);

  const apiKey = options.apiKey?.trim();
  if (apiKey) {
    nextOptions.apiKey = apiKey;
  } else {
    // A previous profile's credential must never survive a profile switch.
    delete nextOptions.apiKey;
  }

  const nextProvider: OpenCodeProviderConfig = {
    ...existing,
    npm: OPENCODE_PROVIDER_NPM,
    name: OPENCODE_PROVIDER_NAME,
    options: nextOptions
  };

  if (options.model?.trim()) {
    const existingModels = isRecord(existing.models) ? existing.models : {};
    nextProvider.models = { ...existingModels, [options.model.trim()]: {} };
  }

  config.provider = {
    ...provider,
    [OPENCODE_PROVIDER_ID]: nextProvider
  };

  return `${stringifyJsonc(config, 2)}\n`;
}

/**
 * Patches OpenCode config file with new endpoint configuration.
 * Creates a timestamped backup before modifying an existing file.
 * @param profile Endpoint profile to configure
 * @param configPath Path to OpenCode config file
 * @param options Optional API key and model id
 * @returns Promise resolving when complete
 */
export async function patchOpenCodeConfig(
  profile: EndpointProfile,
  configPath: string,
  options: OpenCodeConfigBuildOptions = {}
): Promise<void> {
  const content = await readFileSafe(configPath);

  if (await fileExists(configPath)) {
    const backupPath = await createBackup(configPath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${configPath}`);
    }
  }

  const updated = buildOpenCodeConfigContent(profile.baseUrl, content, options);
  const success = await writeFileAtomic(configPath, updated);
  if (!success) {
    throw new Error(`Failed to write OpenCode config to ${configPath}`);
  }
}

/**
 * Parses an OpenCode config document for verification.
 * Fail closed: a malformed existing config must never be silently replaced
 * or treated as verified.
 * @param content Raw config file content
 * @returns Parsed config object
 */
export function parseOpenCodeConfigForVerification(content: string): OpenCodeConfig {
  const parsed = parseJsonc<unknown>(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenCode config document root must be a JSON object');
  }
  return parsed as OpenCodeConfig;
}

function parseOpenCodeConfig(content?: string): OpenCodeConfig {
  if (!content) {
    return {};
  }

  // Fail closed: never replace a malformed user configuration with a
  // regenerated partial file. Abort so the original file is preserved.
  const parsed = parseJsonc<unknown>(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenCode config document root must be a JSON object');
  }
  return parsed as OpenCodeConfig;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
