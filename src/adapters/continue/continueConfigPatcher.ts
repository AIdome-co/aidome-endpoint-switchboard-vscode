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
  let config: ContinueConfig;

  if (content) {
    try {
      config = JSON.parse(content);
    } catch (error) {
      const { Logger } = await import('../../util/log');
      Logger.getInstance().warning(
        `Continue.dev config at ${configPath} is malformed JSON, starting with empty config: ${error instanceof Error ? error.message : String(error)}`
      );
      config = {};
    }
  } else {
    config = {};
  }

  if (!config.models) {
    config.models = [];
  }

  let modelEntry = config.models.find((m) => m.apiBase === profile.baseUrl);
  if (!modelEntry) {
    modelEntry = config.models.find((m) => m.provider === 'openai');
  }

  if (modelEntry) {
    modelEntry.apiBase = profile.baseUrl;
    modelEntry.provider = 'openai';
  } else {
    config.models.push({
      provider: 'openai',
      apiBase: profile.baseUrl,
      model: 'gpt-4'
    });
  }

  const updated = JSON.stringify(config, null, 2);
  await writeFileAtomic(configPath, updated);
}
