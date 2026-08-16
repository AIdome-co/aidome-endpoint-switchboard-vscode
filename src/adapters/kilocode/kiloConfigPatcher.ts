/**
 * Configuration file patcher for Kilo Code v7.4+.
 * Handles JSONC config file modification at ~/.config/kilo/kilo.jsonc.
 */

import * as os from 'os';
import * as path from 'path';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { safeParseJsonc, stringifyJsonc } from '../../util/jsonc';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { validateUrl } from '../../core/profiles/profileValidator';
import { joinApiPath } from '../../util/apiUrl';

interface KiloProviderOptions {
  baseURL?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  [key: string]: unknown;
}

export interface KiloProviderModel {
  name?: string;
  [key: string]: unknown;
}

interface KiloProvider {
  name?: string;
  npm?: string;
  options?: KiloProviderOptions;
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

/** Summary of the AIdome provider entry in a Kilo config file. */
export interface KiloProviderInspection {
  hasProvider: boolean;
  baseUrl?: string;
  modelCount: number;
  hasAuthReference: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isModel(value: unknown): value is KiloProviderModel {
  return isRecord(value);
}

/**
 * Inspects the native AIdome provider entry without accepting malformed JSONC
 * as a successful configuration.
 * @param content Existing Kilo JSONC content
 * @returns Provider inspection, or undefined when the document is malformed
 */
export function inspectKiloConfigContent(content: string): KiloProviderInspection | undefined {
  const config = safeParseJsonc<Record<string, unknown>>(content);
  if (!config || !isRecord(config)) {
    return undefined;
  }

  const providers = config.provider;
  if (!isRecord(providers)) {
    return { hasProvider: false, modelCount: 0, hasAuthReference: false };
  }

  const provider = providers[AIDOME_PROVIDER_SLUG];
  if (!isRecord(provider)) {
    return { hasProvider: false, modelCount: 0, hasAuthReference: false };
  }

  const options = isRecord(provider.options) ? provider.options : undefined;
  const models = isRecord(provider.models) ? provider.models : undefined;
  const modelCount = models
    ? Object.values(models).filter(isModel).length
    : 0;
  const env = provider.env;

  return {
    hasProvider: true,
    baseUrl: typeof options?.baseURL === 'string' ? options.baseURL : undefined,
    modelCount,
    hasAuthReference:
      (typeof options?.apiKey === 'string' && options.apiKey.trim().length > 0) ||
      (Array.isArray(env) && env.some((value) => typeof value === 'string' && value.trim().length > 0))
  };
}

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
  const explicitConfig = process.env.KILO_CONFIG?.trim();
  if (explicitConfig) {
    return explicitConfig;
  }

  const configuredDirectory = process.env.KILO_CONFIG_DIR?.trim();
  if (configuredDirectory) {
    return path.join(configuredDirectory, 'kilo.jsonc');
  }

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
  if (!validateUrl(baseUrl)) {
    return [];
  }

  const url = joinApiPath(baseUrl, '/models');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const trimmedApiKey = apiKey?.trim();
  if (trimmedApiKey) {
    headers['Authorization'] = `Bearer ${trimmedApiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(15_000)
    });

    if (!response.ok) {
      return [];
    }

    const body = await response.json() as unknown;
    if (!isRecord(body) || !Array.isArray(body.data)) {
      return [];
    }

    const ids = new Set<string>();
    for (const item of body.data) {
      if (!isRecord(item) || typeof item.id !== 'string') {
        continue;
      }
      const id = item.id.trim();
      if (id) {
        ids.add(id);
      }
    }

    return [...ids].sort((left, right) => left.localeCompare(right));
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
    const trimmedSlug = slug.trim();
    if (trimmedSlug) {
      models[trimmedSlug] = { name: trimmedSlug };
    }
  }
  return models;
}

function mergeModelEntries(
  existingModels: unknown,
  discoveredModels: Record<string, KiloProviderModel>
): Record<string, KiloProviderModel> {
  const merged: Record<string, KiloProviderModel> = {};
  if (isRecord(existingModels)) {
    for (const [id, model] of Object.entries(existingModels)) {
      if (isModel(model)) {
        merged[id] = model;
      }
    }
  }

  for (const [id, model] of Object.entries(discoveredModels)) {
    merged[id] = {
      ...model,
      ...(merged[id] ?? {})
    };
  }
  return merged;
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
  // The API key is used by the applier for authenticated model discovery only.
  // Kilo credentials must remain in its native auth store or an environment
  // reference; never serialize a SecretStorage value into JSONC.
  void apiKey;

  let config: KiloConfig = {};

  if (existingContent) {
    const parsed = safeParseJsonc<KiloConfig>(existingContent);
    if (parsed) {
      config = parsed;
    }
  }

  // Initialize provider section if it doesn't exist
  if (!isRecord(config.provider)) {
    config.provider = {};
  }

  // Add or update the AIdome Gateway provider entry
  const existingProvider = config.provider[AIDOME_PROVIDER_SLUG];
  if (existingProvider && isRecord(existingProvider)) {
    // Update only the baseURL, preserving existing name, headers, models, etc.
    existingProvider.options = isRecord(existingProvider.options) ? existingProvider.options : {};
    existingProvider.options.baseURL = baseUrl;

    // Add discovered models without deleting manually configured metadata.
    if (models && Object.keys(models).length > 0) {
      existingProvider.models = mergeModelEntries(existingProvider.models, models);
    }
  } else {
    const provider: KiloProvider = {
      name: 'AIdome Gateway',
      npm: AI_SDK_OPENAI_COMPATIBLE,
      options: {
        baseURL: baseUrl
      }
    };
    if (models && Object.keys(models).length > 0) {
      provider.models = models;
    }
    config.provider[AIDOME_PROVIDER_SLUG] = provider;
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
