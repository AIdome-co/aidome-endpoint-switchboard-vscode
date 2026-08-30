/**
 * Configuration file patcher for Kilo Code v7.4+.
 * Handles JSONC config file modification at ~/.config/kilo/kilo.jsonc.
 */

import * as os from 'os';
import * as path from 'path';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { renderConfigFileContent } from '../../core/providerConfig/drivers';

interface KiloProviderModel {
  name: string;
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
  const updated = buildKiloConfigContent(profile.baseUrl, content);
  await writeFileAtomic(configPath, updated);
}
