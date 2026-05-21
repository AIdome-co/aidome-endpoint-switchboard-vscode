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

/**
 * Gets the Claude Code shared settings path.
 * @returns Config file path
 */
export function getClaudeCodeSettingsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (configDir) {
    const expandedConfigDir = expandTilde(configDir);
    if (validatePath(expandedConfigDir)) {
      return path.join(expandedConfigDir, 'settings.json');
    }
  }
  // Claude Code CLI uses ~/.claude/ on ALL platforms (Windows, macOS, Linux).
  // Do not use getConfigDir('Claude') — that resolves to Claude Desktop paths.
  return expandTilde('~/.claude/settings.json');
}

/**
 * Builds Claude Code settings content with AIdome gateway routing enabled.
 * @param profile Endpoint profile to configure
 * @param content Existing settings content, if any
 * @returns Updated settings JSON content
 */
export function buildClaudeCodeSettingsContent(
  profile: EndpointProfile,
  content?: string,
  authSecret?: string | null
): string {
  if (!validateUrl(profile.baseUrl)) {
    throw new Error('Invalid Claude Code endpoint URL');
  }

  const settings = parseClaudeCodeSettings(content);
  const env = isStringRecord(settings.env) ? settings.env : {};
  const normalizedAuthSecret = typeof authSecret === 'string' ? authSecret.trim() : authSecret;

  const nextEnv: Record<string, string> = {
    ...env,
    ANTHROPIC_BASE_URL: profile.baseUrl,
    CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1'
  };

  if (typeof normalizedAuthSecret === 'string' && normalizedAuthSecret.length > 0) {
    nextEnv.ANTHROPIC_API_KEY = normalizedAuthSecret;
  } else if (authSecret !== undefined) {
    delete nextEnv.ANTHROPIC_API_KEY;
  }

  settings.env = nextEnv;

  return `${stringifyJsonc(settings, 2)}\n`;
}

/**
 * Patches Claude Code settings with new endpoint configuration.
 * @param profile Endpoint profile to configure
 * @param configPath Path to Claude Code settings file
 * @returns Promise resolving when complete
 */
export async function patchClaudeCodeConfig(
  profile: EndpointProfile,
  configPath: string
): Promise<void> {
  const content = await readFileSafe(configPath);

  if (await fileExists(configPath)) {
    const backupPath = await createBackup(configPath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${configPath}`);
    }
  }

  const updated = buildClaudeCodeSettingsContent(profile, content);
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
