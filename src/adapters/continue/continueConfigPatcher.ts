/**
 * Configuration file patcher for Continue.dev.
 * Handles JSON config file modification with backup.
 */

import { readFileSafe, writeFileAtomic, createBackup } from '../../util/fsSafe';
import { getContinueConfigPath } from './paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';

interface ContinueModel {
  provider?: string;
  apiBase?: string;
  apiKey?: string;
  model?: string;
  [key: string]: unknown;
}

interface ContinueConfig {
  models?: ContinueModel[];
  [key: string]: unknown;
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
  let config: ContinueConfig;

  if (existingContent) {
    try {
      config = JSON.parse(existingContent);
    } catch {
      config = {};
    }
  } else {
    config = {};
  }

  if (!config.models) {
    config.models = [];
  }

  let modelEntry = config.models.find((m) => m.apiBase === baseUrl);
  if (!modelEntry) {
    modelEntry = config.models.find((m) => m.provider === 'openai');
  }

  if (modelEntry) {
    modelEntry.apiBase = baseUrl;
    modelEntry.provider = 'openai';
  } else {
    config.models.push({
      provider: 'openai',
      apiBase: baseUrl,
      model: 'gpt-4'
    });
  }

  return JSON.stringify(config, null, 2);
}
