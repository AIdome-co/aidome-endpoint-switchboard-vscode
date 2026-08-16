/**
 * Configuration file patcher for Continue.dev.
 * Handles JSONC-compatible config file modification.
 */

import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { getContinueConfigPath } from './paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';
import { validateUrl } from '../../core/profiles/profileValidator';

interface ContinueModel extends Record<string, unknown> {
  provider?: unknown;
  apiBase?: unknown;
}

interface ContinueConfig extends Record<string, unknown> {
  models?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Gets the Continue.dev config path.
 * @returns Config file path
 */
export { getContinueConfigPath };

/**
 * Patches Continue.dev config file with new endpoint.
 * @param profile Endpoint profile to configure
 * @param configPath Path to config file
 * @returns Promise resolving when complete
 */
export async function patchContinueConfig(
  profile: EndpointProfile,
  configPath: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  const updated = buildContinueConfigContent(profile.baseUrl, content);
  await writeFileAtomic(configPath, updated);
}

/**
 * Builds Continue.dev config content.
 * @param baseUrl Base URL to set
 * @param existingContent Existing config content
 * @returns Patched config content
 */
export function buildContinueConfigContent(
  baseUrl: string,
  existingContent?: string
): string {
  if (!validateUrl(baseUrl)) {
    throw new Error('Continue.dev endpoint URL is invalid or uses an unsupported scheme');
  }

  let config: ContinueConfig = {};

  if (existingContent !== undefined) {
    const parsed = parseJsonc<unknown>(existingContent);
    if (!isRecord(parsed)) {
      throw new SyntaxError('Continue config must be a JSON object');
    }
    config = parsed;
  }

  if (config.models === undefined) {
    config.models = [];
  }
  if (!Array.isArray(config.models) || !config.models.every(isRecord)) {
    throw new TypeError('Continue config models must be an array of objects');
  }

  const models = config.models as ContinueModel[];
  const modelEntry = models.find((model) => model.provider === 'openai');

  if (modelEntry) {
    modelEntry.apiBase = baseUrl;
  } else {
    models.push({
      title: 'AIdome Gateway',
      provider: 'openai',
      apiBase: baseUrl,
      model: 'gpt-4'
    });
  }

  return stringifyJsonc(config);
}
