/**
 * Configuration file patcher for OpenAI Codex CLI.
 * Handles TOML config file modification with backup.
 */

import { parse, stringify } from 'smol-toml';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { expandTilde } from '../../util/paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';

interface CodexProvider {
  base_url?: string;
  api_key?: string;
  wire_api?: string;
  [key: string]: unknown;
}

interface CodexConfig {
  model_provider?: string;
  model?: string;
  providers?: Record<string, CodexProvider>;
  [key: string]: unknown;
}

/**
 * Gets the Codex config path.
 * @returns Config file path
 */
export function getCodexConfigPath(): string {
  return expandTilde('~/.codex/config.toml');
}

/**
 * Patches Codex config file with new endpoint.
 * @param profile Endpoint profile to configure
 * @param configPath Path to config file
 * @returns Promise resolving when complete
 */
export async function patchCodexConfig(
  profile: EndpointProfile,
  configPath: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  let config: CodexConfig;

  if (content) {
    try {
      config = parse(content) as CodexConfig;
    } catch {
      // If parse fails, start with empty config
      config = {};
    }
  } else {
    config = {};
  }

  // Initialize providers section if it doesn't exist
  if (!config.providers) {
    config.providers = {};
  }

  // Configure AIdome provider
  config.providers.aidome = {
    base_url: profile.baseUrl,
    wire_api: 'responses' // OpenAI Responses API (Codex's preferred wire format)
    // Note: API key is stored in SecretStorage, not in config file
  };

  // Set AIdome as the default model provider
  config.model_provider = 'aidome';

  // Set a default model if not already set
  if (!config.model) {
    config.model = 'gpt-4';
  }

  // Convert back to TOML and write
  const updated = stringify(config);
  await writeFileAtomic(configPath, updated);
}
