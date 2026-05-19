/**
 * Configuration file patcher for Continue.dev.
 * Handles both JSON/JSONC and YAML config formats.
 */

import * as path from 'path';
import { parse, stringify } from 'yaml';
import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { getContinueConfigPath } from './paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Dialect } from '../../core/dialects/dialectTypes';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';

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

type ContinueConfigFormat = 'json' | 'yaml';

/**
 * Gets the Continue.dev config path.
 * @returns Config file path
 */
export { getContinueConfigPath };

function getContinueConfigFormat(configPath: string): ContinueConfigFormat {
  return configPath.endsWith('.yaml') || configPath.endsWith('.yml')
    ? 'yaml'
    : 'json';
}

function getContinueProvider(dialect: Dialect): 'anthropic' | 'openai' {
  return dialect === 'anthropic.messages' ? 'anthropic' : 'openai';
}

function getDefaultContinueModel(dialect: Dialect): string {
  return dialect === 'anthropic.messages' ? 'claude-3-5-sonnet-latest' : 'gpt-4';
}

export function parseContinueConfigContent(content: string, configPath: string): ContinueConfig {
  const format = getContinueConfigFormat(configPath);
  const parsed = format === 'yaml'
    ? parse(content)
    : parseJsonc<unknown>(content);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path.basename(configPath)} is not a valid object`);
  }

  return parsed as ContinueConfig;
}

export function buildContinueConfigContent(
  profile: EndpointProfile,
  content: string | undefined,
  configPath: string,
  apiKey?: string
): string {
  let config: ContinueConfig = {};

  if (content) {
    try {
      config = parseContinueConfigContent(content, configPath);
    } catch {
      config = {};
    }
  }

  if (!Array.isArray(config.models)) {
    config.models = [];
  }

  const provider = getContinueProvider(profile.dialect);
  const trimmedApiKey = apiKey?.trim();

  let modelEntry = config.models.find(
    (model) => model.apiBase === profile.baseUrl && (!model.provider || model.provider === provider)
  );
  if (!modelEntry) {
    modelEntry = config.models.find((model) => model.provider === provider);
  }
  if (!modelEntry && config.models.length === 1) {
    modelEntry = config.models[0];
  }

  if (modelEntry) {
    modelEntry.apiBase = profile.baseUrl;
    modelEntry.provider = provider;
    if (!modelEntry.model) {
      modelEntry.model = getDefaultContinueModel(profile.dialect);
    }
  } else {
    config.models.push({
      provider,
      apiBase: profile.baseUrl,
      model: getDefaultContinueModel(profile.dialect)
    });
    modelEntry = config.models[config.models.length - 1];
  }

  if (trimmedApiKey) {
    modelEntry.apiKey = trimmedApiKey;
  } else {
    delete modelEntry.apiKey;
  }

  const updated = getContinueConfigFormat(configPath) === 'yaml'
    ? stringify(config)
    : stringifyJsonc(config, 2);

  return updated.endsWith('\n') ? updated : `${updated}\n`;
}

/**
 * Patches Continue.dev config file with new endpoint.
 * @param profile Endpoint profile to configure
 * @param configPath Path to config file
 * @returns Promise resolving when complete
 */
export async function patchContinueConfig(
  profile: EndpointProfile,
  configPath: string,
  apiKey?: string
): Promise<void> {
  const content = await readFileSafe(configPath);
  const updated = buildContinueConfigContent(profile, content, configPath, apiKey);
  const success = await writeFileAtomic(configPath, updated);
  if (!success) {
    throw new Error(`Failed to write Continue.dev config to ${configPath}`);
  }
}
