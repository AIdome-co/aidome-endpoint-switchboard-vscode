/**
 * Native Cline provider configuration support.
 *
 * Current Cline releases do not expose provider settings through VS Code's
 * configuration API. They persist the OpenAI-compatible provider in
 * providers.json and select it through globalState.json instead.
 */

import * as os from 'os';
import * as path from 'path';
import { validateUrl } from '../../core/profiles/profileValidator';

export const CLINE_PROVIDER_ID = 'openai-compatible';
export const CLINE_LEGACY_PROVIDER_ID = 'openai';

interface JsonObject {
  [key: string]: unknown;
}

export interface ClineConfigPaths {
  dataDir: string;
  globalStatePath: string;
  providerSettingsPath: string;
}

/**
 * Resolves Cline's file-backed data paths using the current Cline VS Code
 * host's environment contract. The VS Code host explicitly constructs
 * `<dataDir>/settings/providers.json`; unlike the shared CLI path helper, it
 * does not consume CLINE_PROVIDER_SETTINGS_PATH.
 */
export function getClineConfigPaths(): ClineConfigPaths {
  const configuredDataDir = process.env.CLINE_DATA_DIR?.trim();
  const configuredClineDir = process.env.CLINE_DIR?.trim();
  const clineDir = configuredClineDir || path.join(os.homedir(), '.cline');
  const dataDir = configuredDataDir || path.join(clineDir, 'data');
  const providerSettingsPath = path.join(dataDir, 'settings', 'providers.json');

  return {
    dataDir,
    globalStatePath: path.join(dataDir, 'globalState.json'),
    providerSettingsPath
  };
}

/**
 * Builds the current Cline provider-settings envelope while preserving all
 * unrelated providers, provider fields, modes, and last-used metadata.
 *
 * @param baseUrl The validated endpoint base URL.
 * @param existingContent Existing providers.json content, if present.
 * @param updatedAt Timestamp for a newly-created provider entry.
 * @returns JSON content suitable for Cline's providers.json.
 */
export function buildProviderSettingsContent(
  baseUrl: string,
  existingContent?: string,
  updatedAt: string = new Date().toISOString()
): string {
  assertValidBaseUrl(baseUrl);
  const current = parseJsonObject(existingContent);
  const providers = asObject(current.providers);
  const currentEntry = asObject(providers[CLINE_PROVIDER_ID]);
  const currentSettings = asObject(currentEntry.settings);
  const currentTokenSource = currentEntry.tokenSource;

  const nextEntry: JsonObject = {
    ...currentEntry,
    settings: {
      ...currentSettings,
      provider: CLINE_PROVIDER_ID,
      baseUrl
    },
    updatedAt: typeof currentEntry.updatedAt === 'string' && currentEntry.updatedAt.length > 0
      ? currentEntry.updatedAt
      : updatedAt,
    tokenSource: currentTokenSource === 'manual'
      || currentTokenSource === 'oauth'
      || currentTokenSource === 'migration'
      ? currentTokenSource
      : 'manual'
  };

  const next: JsonObject = {
    ...current,
    version: 1,
    modes: asObject(current.modes),
    providers: {
      ...providers,
      [CLINE_PROVIDER_ID]: nextEntry
    }
  };

  if (typeof current.lastUsedProvider !== 'string' || current.lastUsedProvider.trim().length === 0) {
    delete next.lastUsedProvider;
  }

  return `${JSON.stringify(next, null, 2)}\n`;
}

/**
 * Builds Cline's legacy global state while preserving unrelated state.
 *
 * Cline's current provider catalog uses the SDK spelling
 * "openai-compatible", but its extension state stores the canonical legacy
 * provider alias "openai". The active endpoint is also read from
 * openAiBaseUrl before the provider-store fallback, so both representations
 * must be kept coherent.
 *
 * @param baseUrl The validated endpoint base URL.
 * @param existingContent Existing globalState.json content, if present.
 * @returns JSON content suitable for Cline's globalState.json.
 */
export function buildGlobalStateContent(baseUrl: string, existingContent?: string): string {
  assertValidBaseUrl(baseUrl);
  const current = parseJsonObject(existingContent);

  return `${JSON.stringify({
    ...current,
    openAiBaseUrl: baseUrl,
    planModeApiProvider: CLINE_LEGACY_PROVIDER_ID,
    actModeApiProvider: CLINE_LEGACY_PROVIDER_ID
  }, null, 2)}\n`;
}

/**
 * Parses a Cline JSON file as an object.
 *
 * Invalid or unsupported content is treated as an empty native config. This
 * matches Cline's current file-backed readers, which fall back to empty state
 * before writing a schema-valid replacement; the applier creates a backup
 * before that replacement is written.
 */
export function parseJsonObject(content?: string): JsonObject {
  if (!content) {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(content);
    return asObject(parsed);
  } catch {
    return {};
  }
}

/**
 * Returns a parsed object or undefined for missing/malformed content.
 * Used by verification so malformed files are not reported as configured.
 */
export function parseJsonObjectForVerification(content?: string): JsonObject | undefined {
  if (!content) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as JsonObject;
  } catch {
    return undefined;
  }
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function assertValidBaseUrl(baseUrl: string): void {
  if (!validateUrl(baseUrl)) {
    throw new Error('Invalid Cline endpoint URL');
  }
}
