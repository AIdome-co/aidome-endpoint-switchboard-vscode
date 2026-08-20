/**
 * Configuration file patcher for Continue.dev.
 * Handles JSONC and YAML config file modification with backup.
 */

import * as path from 'path';
import { parse, stringify } from 'yaml';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { getContinueConfigPath } from './paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';

interface ContinueModel {
  provider?: string;
  apiBase?: string;
  model?: string;
  [key: string]: unknown;
}

interface ContinueConfig {
  models?: ContinueModel[];
  [key: string]: unknown;
}

export interface ContinueConfigOptions {
  provider?: 'openai' | 'anthropic';
}

type ContinueConfigFormat = 'json' | 'yaml';

/**
 * Gets the Continue.dev config path.
 * @returns Config file path
 */
export { getContinueConfigPath };

function getContinueConfigFormat(configPath: string): ContinueConfigFormat {
  return configPath.endsWith('.yaml') || configPath.endsWith('.yml') ? 'yaml' : 'json';
}

/**
 * Parses a Continue config according to its file extension.
 * @param content File contents
 * @param configPath Path used to select JSONC or YAML parsing
 * @returns Parsed config object
 */
export function parseContinueConfigContent(content: string, configPath: string): ContinueConfig {
  const parsed = getContinueConfigFormat(configPath) === 'yaml'
    ? parse(content)
    : parseJsonc<unknown>(content);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path.basename(configPath)} is not a valid object`);
  }

  return parsed as ContinueConfig;
}

function getDefaultModel(provider: 'openai' | 'anthropic'): string {
  return provider === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-4';
}

/**
 * Patches Continue.dev config file with a new endpoint.
 * @param profile Endpoint profile to configure
 * @param configPath Path to config file
 * @returns Promise resolving when complete
 */
export async function patchContinueConfig(
  profile: EndpointProfile,
  configPath: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  const provider = profile.dialect === 'anthropic.messages' ? 'anthropic' : 'openai';
  const updated = buildContinueConfigContent(
    profile.baseUrl,
    content,
    configPath,
    { provider }
  );
  await writeFileAtomic(configPath, updated);
}

/**
 * Builds Continue.dev config content while preserving unrelated fields.
 * @param baseUrl Base URL to set
 * @param existingContent Existing config content
 * @param configPath Path used to select JSONC or YAML serialization
 * @param options Provider-specific configuration options
 * @returns Patched config content
 */
export function buildContinueConfigContent(
  baseUrl: string,
  existingContent?: string,
  configPath = getContinueConfigPath(),
  options: ContinueConfigOptions = {}
): string {
  let config: ContinueConfig = {};

  if (existingContent) {
    try {
      config = parseContinueConfigContent(existingContent, configPath);
    } catch {
      config = {};
    }
  }

  if (!Array.isArray(config.models)) {
    config.models = [];
  }

  const provider = options.provider ?? 'openai';
  let modelEntry = config.models.find(
    model => model.apiBase === baseUrl && (!model.provider || model.provider === provider)
  );
  if (!modelEntry) {
    modelEntry = config.models.find(model => model.provider === provider);
  }
  if (!modelEntry && config.models.length === 1) {
    modelEntry = config.models[0];
  }

  if (modelEntry) {
    modelEntry.apiBase = baseUrl;
    modelEntry.provider = provider;
    if (!modelEntry.model) {
      modelEntry.model = getDefaultModel(provider);
    }
  } else {
    config.models.push({
      provider,
      apiBase: baseUrl,
      model: getDefaultModel(provider)
    });
  }

  const updated = getContinueConfigFormat(configPath) === 'yaml'
    ? stringify(config)
    : stringifyJsonc(config, 2);

  return updated.endsWith('\n') ? updated : `${updated}\n`;
}
