/**
 * Codex `.env` credential persistence.
 *
 * Codex upstream (`codex-rs/arg0/src/lib.rs`, `load_dotenv`) loads
 * `<codex_home>/.env` at every startup and injects the variables into the
 * process environment — this is the upstream-supported on-disk location for
 * provider credentials (`env_key = "OPENAI_API_KEY"` in config.toml points at
 * it). Only variables prefixed `CODEX_` are filtered out; OPENAI_API_KEY is
 * honored.
 *
 * This makes Codex's auth automation the exact parallel of Claude Code's
 * settings.json contract: the secret is persisted at apply time
 * (`target-persisted-at-apply`), never in config.toml.
 *
 * The dotenv mechanics live in the generic, provider-neutral driver
 * (`src/core/providerConfig/envFileDriver.ts`); this module is a thin Codex
 * wrapper over it. Dependency direction: Codex -> generic capability, never
 * generic core -> Codex.
 */

import {
  buildDotEnvContent as buildDotEnvContentGeneric,
  patchEnvFile as patchEnvFileGeneric,
  parseDotEnv as parseDotEnvGeneric,
  readEnvFileValue as readEnvFileValueGeneric
} from '../../core/providerConfig/envFileDriver';

const CODEX_ENV_LABEL = 'Codex .env file';

/** Parses a .env file into key/value records. */
export function parseDotEnv(content: string | undefined): Record<string, string> {
  return parseDotEnvGeneric(content, { fileLabel: CODEX_ENV_LABEL });
}

/**
 * Builds the merged .env content: managed variables are updated, unrelated
 * variables and comments are preserved.
 */
export function buildDotEnvContent(
  existingContent: string | undefined,
  vars: Record<string, string>
): string {
  return buildDotEnvContentGeneric(existingContent, vars, { fileLabel: CODEX_ENV_LABEL });
}

/**
 * Patches the Codex .env file with the managed variables.
 * Backup-before-modify, atomic write, unrelated variables preserved.
 *
 * @returns The backup path, or undefined when the file did not exist.
 */
export async function patchCodexEnvFile(
  envFilePath: string,
  vars: Record<string, string>
): Promise<string | undefined> {
  return patchEnvFileGeneric(envFilePath, vars, { fileLabel: CODEX_ENV_LABEL });
}

/** Reads a managed variable value from the Codex .env file. */
export async function readCodexEnvValue(
  envFilePath: string,
  key: string
): Promise<string | undefined> {
  return readEnvFileValueGeneric(envFilePath, key, { fileLabel: CODEX_ENV_LABEL });
}
