/**
 * Configuration file patcher for Claude Code.
 * Handles shared Claude Code settings JSON used by both the CLI and VS Code extension.
 */

import * as path from 'path';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { createBackup, fileExists, readFileSafe, writeFileAtomic } from '../../util/fsSafe';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';
import { expandTilde } from '../../util/paths';
import { validatePath, validateUrl } from '../../core/profiles/profileValidator';

interface ClaudeCodeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface ClaudeCodeGatewayConfig {
  baseUrl?: string;
  apiKey?: string;
  modelDiscoveryEnabled: boolean;
}

/**
 * Gets the Claude Code shared settings path.
 * @returns Config file path
 */
export function getClaudeCodeSettingsPath(): string {
  const defaultPath = expandTilde('~/.claude/settings.json');
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) {
    const expandedConfigDir = expandTilde(configDir);
    if (validatePath(expandedConfigDir)) {
      return path.join(expandedConfigDir, 'settings.json');
    }
  }

  return defaultPath;
}

export async function readClaudeCodeGatewayConfig(
  configPath = getClaudeCodeSettingsPath()
): Promise<ClaudeCodeGatewayConfig | undefined> {
  const content = await readFileSafe(configPath);
  if (!content) {
    return undefined;
  }

  const settings = parseClaudeCodeSettings(content);
  const env = isStringRecord(settings.env) ? settings.env : undefined;
  if (!env) {
    return undefined;
  }

  const baseUrl = typeof env.ANTHROPIC_BASE_URL === 'string' && env.ANTHROPIC_BASE_URL.trim()
    ? normalizeClaudeBaseUrl(env.ANTHROPIC_BASE_URL.trim())
    : undefined;
  const apiKey = typeof env.ANTHROPIC_API_KEY === 'string' && env.ANTHROPIC_API_KEY.trim()
    ? env.ANTHROPIC_API_KEY.trim()
    : undefined;
  const discoveryFlag = env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY?.trim().toLowerCase();

  return {
    baseUrl,
    apiKey,
    modelDiscoveryEnabled: discoveryFlag === '1' || discoveryFlag === 'true'
  };
}

/**
 * Builds Claude Code settings content with AIdome gateway routing enabled.
 * @param profile Endpoint profile to configure
 * @param content Existing settings content, if any
 * @param apiKey Optional gateway API key to persist in Claude settings
 * @returns Updated settings JSON content
 */
export function buildClaudeCodeSettingsContent(
  profile: EndpointProfile,
  content?: string,
  apiKey?: string
): string {
  if (!validateUrl(profile.baseUrl)) {
    throw new Error('Invalid Claude Code endpoint URL');
  }

  const settings = parseClaudeCodeSettings(content);
  const env = isStringRecord(settings.env) ? settings.env : {};
  const claudeBaseUrl = normalizeClaudeBaseUrl(profile.baseUrl);
  const normalizedApiKey = apiKey?.trim();

  const nextEnv: Record<string, string> = {
    ...env,
    ANTHROPIC_BASE_URL: claudeBaseUrl,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1'
  };

  if (normalizedApiKey) {
    nextEnv.ANTHROPIC_API_KEY = normalizedApiKey;
  } else {
    delete nextEnv.ANTHROPIC_API_KEY;
  }

  settings.env = nextEnv;

  return `${stringifyJsonc(settings, 2)}\n`;
}

/**
 * Patches Claude Code settings with new endpoint configuration.
 * @param profile Endpoint profile to configure
 * @param configPath Path to Claude Code settings file
 * @param apiKey Optional gateway API key to persist in Claude settings
 * @returns Promise resolving when complete
 */
export async function patchClaudeCodeConfig(
  profile: EndpointProfile,
  configPath: string,
  apiKey?: string
): Promise<void> {
  const content = await readFileSafe(configPath);

  if (await fileExists(configPath)) {
    const backupPath = await createBackup(configPath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${configPath}`);
    }
  }

  const updated = buildClaudeCodeSettingsContent(profile, content, apiKey);
  const success = await writeFileAtomic(configPath, updated);
  if (!success) {
    throw new Error(`Failed to write Claude Code settings to ${configPath}`);
  }
}

function parseClaudeCodeSettings(content?: string): ClaudeCodeSettings {
  if (!content) {
    return {};
  }

  try {
    const parsed = parseJsonc<unknown>(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ClaudeCodeSettings;
    }
  } catch {
    // If parse fails, start with empty settings.
  }

  return {};
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(item => typeof item === 'string');
}

export function normalizeClaudeBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  let pathname = parsed.pathname.replace(/\/+$/, '');

  if (pathname === '/v1') {
    pathname = '';
  } else if (pathname.endsWith('/v1')) {
    pathname = pathname.slice(0, -3);
  }

  return `${parsed.origin}${pathname}${parsed.search}`;
}
