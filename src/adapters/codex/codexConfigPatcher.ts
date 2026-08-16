/**
 * Configuration file patcher for OpenAI Codex CLI.
 *
 * Codex user configuration uses `model_providers.<id>` for custom providers.
 * The adapter deliberately leaves credentials in the environment (through
 * Codex's `env_key` setting) instead of writing them to config.toml.
 */

import { parse, stringify } from 'smol-toml';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { expandTilde } from '../../util/paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { validateUrl } from '../../core/profiles/profileValidator';

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
  /** Legacy key emitted by older Switchboard versions; migrated on write. */
  providers?: Record<string, CodexProvider>;
  [key: string]: unknown;
}

const CODEX_PROVIDER_ID = 'aidome';
const CODEX_PROVIDER_NAME = 'AIdome Gateway';
const CODEX_API_KEY_ENV_VAR = 'OPENAI_API_KEY';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseCodexConfig(existingContent: string): CodexConfig {
  try {
    const parsed = parse(existingContent) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('configuration root must be a TOML table');
    }
    return parsed as CodexConfig;
  } catch {
    throw new Error('Codex config.toml is not valid TOML');
  }
}

function readProviderTable(config: CodexConfig, key: 'model_providers' | 'providers'): Record<string, CodexProvider> {
  const value = config[key];
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`Codex config key "${key}" must be a TOML table`);
  }

  for (const [providerId, provider] of Object.entries(value)) {
    if (!isRecord(provider)) {
      throw new Error(`Codex provider "${providerId}" must be a TOML table`);
    }
  }

  return value as Record<string, CodexProvider>;
}

function ensureProviderNames(providers: Record<string, CodexProvider>): void {
  for (const [providerId, provider] of Object.entries(providers)) {
    if (typeof provider.name !== 'string' || provider.name.trim().length === 0) {
      provider.name = providerId;
    }
  }
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
  configPath: string,
  apiKeyEnvVar?: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  const updated = buildCodexConfigContent(profile.baseUrl, content, apiKeyEnvVar);
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
  existingContent?: string,
  apiKeyEnvVar?: string
): string {
  if (!validateUrl(baseUrl)) {
    throw new Error('Codex provider base URL must use https:// or localhost http://');
  }

  if (apiKeyEnvVar !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnvVar)) {
    throw new Error('Codex provider API key environment variable name is invalid');
  }

  const config = existingContent ? parseCodexConfig(existingContent) : {};
  const modelProviders = readProviderTable(config, 'model_providers');

  // Older Switchboard releases wrote [providers.*]. Codex rejects that root
  // key, so migrate those entries into the current native table while
  // preserving any provider that is not being selected by this profile.
  const legacyProviders = readProviderTable(config, 'providers');
  for (const [providerId, provider] of Object.entries(legacyProviders)) {
    if (!modelProviders[providerId]) {
      modelProviders[providerId] = provider;
    }
  }
  ensureProviderNames(modelProviders);
  delete config.providers;

  const aidomeProvider: CodexProvider = {
    ...(modelProviders[CODEX_PROVIDER_ID] ?? {}),
    name: CODEX_PROVIDER_NAME,
    base_url: baseUrl,
    wire_api: 'responses'
  };

  // `api_key` was used by older adapter assumptions but is not a Codex
  // ModelProviderInfo field. Remove it rather than preserving an invalid,
  // plaintext credential field in the generated config.
  delete aidomeProvider.api_key;

  // Codex reads provider credentials from the named environment variable.
  // Never copy the profile secret into config.toml.
  if (apiKeyEnvVar && !aidomeProvider.env_key) {
    aidomeProvider.env_key = apiKeyEnvVar;
  }
  modelProviders[CODEX_PROVIDER_ID] = aidomeProvider;
  config.model_providers = modelProviders;

  // Set AIdome as the active provider without changing the user's model.
  config.model_provider = CODEX_PROVIDER_ID;

  // Convert back to TOML and write. Codex supplies its own model default when
  // the user has not selected one, so do not invent or overwrite model IDs.
  return stringify(config);
}
