/**
 * Configuration file compatibility wrapper for Continue.dev.
 * Plan execution uses the shared YAML/JSONC model-array driver.
 */

import { readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { getContinueConfigPath } from './paths';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { parseDocument } from 'yaml';
import { renderConfigFileContent } from '../../core/providerConfig/drivers';
import { ConfigFormat } from '../../core/providerConfig/types';
import { parseJsonc } from '../../util/jsonc';

interface ContinueModel {
  provider?: string;
  apiBase?: string;
  apiKey?: string;
  model?: string;
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
  const format: 'yaml' | 'jsonc' = configPath.endsWith('.yaml') ? 'yaml' : 'jsonc';
  const updated = buildContinueConfigContent(profile.baseUrl, content, format);
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
  existingContent?: string,
  format: 'yaml' | 'jsonc' = 'jsonc'
): string {
  return renderConfigFileContent({
    baseUrl,
    existingContent,
    format,
    options: {
      driver: 'yaml-model-array',
      format
    }
  });
}

/** Parses Continue models from either current YAML or legacy JSONC content. */
export function parseContinueModels(
  content: string,
  format: ConfigFormat
): ContinueModel[] {
  try {
    const parsed: unknown = format === 'yaml'
      ? parseDocument(content).toJSON()
      : parseJsonc<unknown>(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return [];
    }
    const models = (parsed as { models?: unknown }).models;
    return Array.isArray(models)
      ? models.filter((model): model is ContinueModel => Boolean(model) && typeof model === 'object' && !Array.isArray(model))
      : [];
  } catch {
    return [];
  }
}
