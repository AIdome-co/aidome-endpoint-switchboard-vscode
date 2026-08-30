/**
 * Configuration file patcher for OpenAI Codex CLI.
 * Handles TOML config file modification with backup.
 */

import { parse, stringify } from 'smol-toml';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { expandTilde } from '../../util/paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';

interface CodexProvider {
  name?: string;
  base_url?: string;
  env_key?: string;
  wire_api?: string;
  [key: string]: unknown;
}

interface CodexConfig {
  model_provider?: string;
  model?: string;
  model_providers?: Record<string, CodexProvider>;
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
  const updated = buildCodexConfigContent(profile.baseUrl, content);
  await writeFileAtomic(configPath, updated);
}

/**
 * Builds Codex config content.
 * @param baseUrl Base URL to set
 * @param existingContent Existing config content
 * @returns Patched config content
 */
export function buildCodexConfigContent(
  baseUrl: string,
  existingContent?: string
): string {
  let config: CodexConfig;

  if (existingContent) {
    try {
      config = parse(existingContent) as CodexConfig;
    } catch {
      // If parse fails, start with empty config
      config = {};
    }
  } else {
    config = {};
  }

  // Current Codex uses model_providers for user-defined providers.
  if (!config.model_providers) {
    config.model_providers = {};
  }

  // Configure AIdome provider
  const existingProvider = config.model_providers.aidome ?? {};
  config.model_providers.aidome = {
    ...existingProvider,
    name: typeof existingProvider.name === 'string' ? existingProvider.name : 'aidome',
    base_url: baseUrl,
    wire_api: 'responses',
    env_key: typeof existingProvider.env_key === 'string' ? existingProvider.env_key : 'OPENAI_API_KEY'
  };

  // Set AIdome as the default model provider
  config.model_provider = 'aidome';

  // Convert back to TOML and write
  return stringify(config);
}
