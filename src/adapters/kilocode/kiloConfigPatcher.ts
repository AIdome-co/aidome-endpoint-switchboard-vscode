/**
 * Configuration file patcher for Kilo Code v7.4+.
 * Handles JSONC config file modification at ~/.config/kilo/kilo.jsonc.
 */

import * as os from 'os';
import * as path from 'path';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { parseJsonc, safeParseJsonc, stringifyJsonc } from '../../util/jsonc';
import { EndpointProfile } from '../../core/profiles/profileTypes';

interface KiloProviderOptions {
  baseURL: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

interface KiloProviderModel {
  name: string;
  [key: string]: unknown;
}

interface KiloProvider {
  name: string;
  npm: string;
  options: KiloProviderOptions;
  env?: string[];
  models?: Record<string, KiloProviderModel>;
  [key: string]: unknown;
}

interface KiloConfig {
  $schema?: string;
  provider?: Record<string, KiloProvider>;
  disabled_providers?: string[];
  permission?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The provider slug used for AIdome Gateway entries. */
const AIDOME_PROVIDER_SLUG = 'aidome-gateway';

/** The AI SDK package for OpenAI-compatible providers. */
const AI_SDK_OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible';

/**
 * Gets the Kilo Code global config file path.
 * Matches Kilo's own globalConfigDir() resolution:
 *   $XDG_CONFIG_HOME/kilo/kilo.jsonc  (Linux)
 *   ~/.config/kilo/kilo.jsonc         (default Linux)
 *   ~/Library/Application Support/kilo/kilo.jsonc  (macOS)
 *   %APPDATA%/Kilo/kilo.jsonc         (Windows)
 * @returns Config file path
 */
export function getKiloConfigPath(): string {
  const platform = os.platform();
  let dir: string;

  if (platform === 'win32') {
    dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Kilo');
  } else if (platform === 'darwin') {
    dir = path.join(os.homedir(), 'Library', 'Application Support', 'kilo');
  } else {
    // Linux and others: XDG_CONFIG_HOME or ~/.config
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    dir = xdgConfig ? path.join(xdgConfig, 'kilo') : path.join(os.homedir(), '.config', 'kilo');
  }

  // Kilo looks for kilo.jsonc first, then kilo.json
  return path.join(dir, 'kilo.jsonc');
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
 * @param apiKey Optional API key (stored as OPENAI_API_KEY env var)
 * @param models Optional models to configure (auto-discovered or user-provided)
 * @returns Patched config content as JSON
 */
export function buildKiloConfigContent(
  baseUrl: string,
  existingContent?: string,
  apiKey?: string,
  models?: Record<string, KiloProviderModel>
): string {
  let config: KiloConfig = {};

  if (existingContent) {
    const parsed = safeParseJsonc<KiloConfig>(existingContent);
    if (parsed) {
      config = parsed;
    }
  }

  // Initialize provider section if it doesn't exist
  if (!config.provider) {
    config.provider = {};
  }

  // Add or update the AIdome Gateway provider entry
  const existingProvider = config.provider[AIDOME_PROVIDER_SLUG];
  if (existingProvider) {
    // Update only the baseURL, preserving existing name, headers, models, etc.
    existingProvider.options = existingProvider.options || {};
    existingProvider.options.baseURL = baseUrl;

    // Override models if explicitly provided (auto-discovered or from user)
    if (models && Object.keys(models).length > 0) {
      existingProvider.models = models;
    }

    // Set env var for API key if provided
    if (apiKey) {
      const existingEnv = existingProvider.env as string[] | undefined;
      const env = existingEnv ? [...existingEnv] : [];
      const filtered = env.filter((e) => !e.startsWith('OPENAI_API_KEY='));
      filtered.push(`OPENAI_API_KEY=${apiKey}`);
      existingProvider.env = filtered;
    }
  } else {
    config.provider[AIDOME_PROVIDER_SLUG] = {
      name: 'AIdome Gateway',
      npm: AI_SDK_OPENAI_COMPATIBLE,
      options: {
        baseURL: baseUrl
      },
      models: (models && Object.keys(models).length > 0) ? models : undefined,
      ...(apiKey ? { env: [`OPENAI_API_KEY=${apiKey}`] } : {})
    };
  }

  return stringifyJsonc(config);
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
  const updated = buildKiloConfigContent(profile.baseUrl, content);
  await writeFileAtomic(configPath, updated);
}