/**
 * Configuration file patcher for Kilo Code v7.4+.
 * Handles JSONC config file modification at ~/.config/kilo/kilo.jsonc.
 */

import * as os from 'os';
import * as path from 'path';

function join(...parts: string[]): string {
  return path.join(...parts);
}
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { renderConfigFileContent } from '../../core/providerConfig/drivers';
import { normalizeOpenAiBaseUrl } from '../../core/providerConfig/endpointUrl';

interface KiloProviderModel {
  name: string;
  [key: string]: unknown;
}

/** The provider slug used for AIdome Gateway entries. */
const AIDOME_PROVIDER_SLUG = 'aidome-gateway';

/** The AI SDK package for OpenAI-compatible providers. */
const AI_SDK_OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible';

/**
 * Resolved Kilo Code configuration target.
 *
 * `kind: 'file'` is a safe writable target. `kind: 'guided'` means Kilo's
 * configuration source cannot be determined safely (explicit content, or
 * multiple legacy candidates) and Switchboard must guide instead of guessing.
 */
export type KiloConfigTarget =
  | { kind: 'file'; path: string; source: string }
  | { kind: 'guided'; reason: string };

/**
 * Resolves the active Kilo Code configuration target following Kilo's own
 * precedence (packages/core/src/global.ts, config-file.ts):
 *
 *   1. KILO_CONFIG          — explicit file, wins outright
 *   2. KILO_CONFIG_DIR      — explicit directory (kilo.jsonc, then kilo.json)
 *   3. KILO_CONFIG_CONTENT  — content supplied via env: there may be no safe
 *                             writable file target → guided
 *   4. $XDG_CONFIG_HOME/kilo/kilo.jsonc | kilo.json   (all platforms — Kilo
 *                             resolves the global dir via XDG, NOT
 *                             platform AppData/Application Support paths)
 *   5. ~/.config/kilo/kilo.jsonc | kilo.json
 *   6. Legacy candidates: ~/.kilo, ~/.kilocode, ~/.opencode (kilo.jsonc /
 *      kilo.json when present)
 *
 * If more than one existing candidate file is found at different levels the
 * active source is ambiguous → guided. Project-local candidates are
 * intentionally not considered: the extension host spans multiple projects
 * and mutating one project's config for a global profile is unsafe.
 *
 * @param deps Injectable environment/FS for tests.
 */
export function resolveKiloConfigTarget(
  deps: {
    env?: NodeJS.ProcessEnv;
    homedir?: () => string;
    existsSync?: (path: string) => boolean;
  } = {}
): KiloConfigTarget {
  const env = deps.env ?? process.env;
  const home = deps.homedir?.() ?? os.homedir();
  const exists = deps.existsSync ?? ((candidate: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('fs').existsSync(candidate);
    } catch {
      return false;
    }
  });

  const candidates = (dir: string): string[] => [
    join(dir, 'kilo.jsonc'),
    join(dir, 'kilo.json')
  ];

  // 1. KILO_CONFIG — explicit file
  const explicitConfig = env.KILO_CONFIG?.trim();
  if (explicitConfig) {
    return { kind: 'file', path: explicitConfig, source: 'KILO_CONFIG' };
  }

  // 3. KILO_CONFIG_CONTENT — no safe writable target
  const explicitContent = env.KILO_CONFIG_CONTENT?.trim();
  if (explicitContent) {
    return {
      kind: 'guided',
      reason: 'KILO_CONFIG_CONTENT supplies configuration directly; there may be no writable config file to patch safely.'
    };
  }

  // 2. KILO_CONFIG_DIR — explicit directory
  const explicitDir = env.KILO_CONFIG_DIR?.trim();
  if (explicitDir) {
    const existing = candidates(explicitDir).find(candidate => exists(candidate));
    return { kind: 'file', path: existing ?? join(explicitDir, 'kilo.jsonc'), source: 'KILO_CONFIG_DIR' };
  }

  // 4. XDG_CONFIG_HOME/kilo — Kilo's global dir on ALL platforms
  // 5. ~/.config/kilo — XDG default
  // 6. Legacy candidate directories
  const xdgConfig = env.XDG_CONFIG_HOME?.trim();
  const searchLevels: Array<{ label: string; dirs: string[] }> = [
    ...(xdgConfig ? [{ label: 'XDG_CONFIG_HOME', dirs: [join(xdgConfig, 'kilo')] }] : []),
    { label: '~/.config/kilo', dirs: [join(home, '.config', 'kilo')] },
    { label: '~/.kilo', dirs: [join(home, '.kilo')] },
    { label: '~/.kilocode', dirs: [join(home, '.kilocode')] },
    { label: '~/.opencode', dirs: [join(home, '.opencode')] }
  ];

  const found: Array<{ path: string; source: string }> = [];
  for (const level of searchLevels) {
    for (const dir of level.dirs) {
      const existing = candidates(dir).find(candidate => exists(candidate));
      if (existing) {
        found.push({ path: existing, source: level.label });
      }
    }
  }

  if (found.length > 1) {
    return {
      kind: 'guided',
      reason: `Multiple Kilo configuration files detected (${found.map(item => `${item.source}: ${item.path}`).join('; ')}); Switchboard cannot determine which one Kilo is actively using. Configure it manually or remove the stale candidates.`
    };
  }

  if (found.length === 1) {
    return { kind: 'file', path: found[0].path, source: found[0].source };
  }

  // Nothing exists yet: create at Kilo's default global location,
  // honoring XDG_CONFIG_HOME when set.
  const defaultDir = xdgConfig ? join(xdgConfig, 'kilo') : join(home, '.config', 'kilo');
  return {
    kind: 'file',
    path: join(defaultDir, 'kilo.jsonc'),
    source: 'default'
  };
}

/**
 * Convenience wrapper resolving the writable config path for the current
 * process, or undefined when the target is guided.
 */
export function getKiloConfigPath(): string | undefined {
  const target = resolveKiloConfigTarget();
  return target.kind === 'file' ? target.path : undefined;
}

/**
 * Discovers models from an OpenAI-compatible endpoint.
 * Mimics Kilo's own fetchOpenAIModels logic.
 * @param baseUrl The base URL of the endpoint
 * @param apiKey Optional API key for authentication
 * @returns Promise resolving to array of model slugs
 */
export async function discoverModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000)
    });

    if (!response.ok) {
      return [];
    }

    const body = await response.json() as { data?: Array<{ id?: string }> };
    if (!body.data || !Array.isArray(body.data)) {
      return [];
    }

    return body.data
      .map((item) => item.id?.trim() ?? '')
      .filter((id): id is string => id.length > 0);
  } catch {
    return [];
  }
}

/**
 * Builds model entries for the Kilo provider config.
 * @param modelSlugs Array of model identifier strings
 * @returns Model records keyed by slug
 */
export function buildModelEntries(modelSlugs: string[]): Record<string, KiloProviderModel> {
  const models: Record<string, KiloProviderModel> = {};
  for (const slug of modelSlugs) {
    models[slug] = { name: slug };
  }
  return models;
}

/**
 * Builds Kilo Code config content with an AIdome Gateway provider entry.
 * @param baseUrl The AIdome Gateway base URL
 * @param existingContent Existing config content (JSONC)
 * @param _apiKey Deprecated compatibility parameter. Secrets are never written
 * to Kilo config; Kilo manages authentication through its own auth store.
 * @param models Optional models to configure (auto-discovered or user-provided)
 * @returns Patched config content as JSON
 */
export function buildKiloConfigContent(
  baseUrl: string,
  existingContent?: string,
  _apiKey?: string,
  models?: Record<string, KiloProviderModel>
): string {
  return renderConfigFileContent({
    baseUrl,
    existingContent,
    format: 'jsonc',
    options: {
      driver: 'jsonc-provider-map',
      mapPath: ['provider'],
      providerId: AIDOME_PROVIDER_SLUG,
      defaults: {
        name: 'AIdome Gateway',
        npm: AI_SDK_OPENAI_COMPATIBLE
      },
      baseUrlPath: ['options', 'baseURL'],
      models
    }
  });
}

/**
 * Patches Kilo Code config file with a new endpoint.
 * @param profile Endpoint profile to configure
 * @param configPath Path to config file
 * @returns Promise resolving when complete
 */
export async function patchKiloConfig(
  profile: EndpointProfile,
  configPath: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  // Single source of truth for Kilo URL normalization: the same
  // normalizeOpenAiBaseUrl helper the descriptor/engine execution path uses
  // (adapter buildPlan -> step.data.baseUrl). Both paths MUST produce the
  // identical baseURL for the same profile.
  const updated = buildKiloConfigContent(normalizeOpenAiBaseUrl(profile.baseUrl), content);
  await writeFileAtomic(configPath, updated);
}
