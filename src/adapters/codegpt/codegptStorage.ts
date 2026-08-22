/**
 * CodeGPT local-provider storage access.
 *
 * CodeGPT persists its local/OpenAI-compatible provider configuration in a
 * plain SQLite database at `~/.codegpt/db.sqlite` (or `$CODEGPT_HOME/db.sqlite`)
 * plus a `settings.json` in the same directory — NOT in VS Code contributed
 * settings. This module reads and writes that storage so the switchboard can
 * configure CodeGPT exactly as CodeGPT's own "Manage my AI Models" UI does.
 *
 * Contract (verified against CodeGPT v3.24.52 bundled source):
 *  - `connection` table: `INSERT ... ON CONFLICT(provider) DO UPDATE` with
 *    `custom_link` (the bare base URL, NO trailing slash and NO `/v1`) and
 *    `apikey`. Provider keys are lowercased/space-stripped (e.g. `lmstudio`).
 *  - CodeGPT appends `/v1/models` itself, so `custom_link` must be the bare
 *    origin (e.g. `http://host:port`).
 *  - `settings.json` may carry a `local-server-flavor-<provider>: "custom"` key.
 *
 * This module uses Node's built-in `node:sqlite` (available in the VS Code
 * extension host and Node 20+), so no native dependency is added.
 */

import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../util/log';
import { createBackup } from '../../util/fsSafe';

/**
 * The provider key CodeGPT uses in the `connection` table for local /
 * OpenAI-compatible servers. Lowercased, no spaces.
 */
export const CODEGPT_LOCAL_PROVIDER = 'lmstudio';

/** Name of the settings file CodeGPT keeps next to the database. */
const CODEGPT_SETTINGS_FILE = 'settings.json';

/** The SQLite database file name inside the CodeGPT home directory. */
const CODEGPT_DB_FILE = 'db.sqlite';

/**
 * Resolves the CodeGPT home directory, mirroring CodeGPT's own logic:
 * `$CODEGPT_HOME` if set, otherwise `~/.codegpt`.
 */
export function resolveCodeGptHome(homeDir: string = os.homedir()): string {
  const envHome = process.env.CODEGPT_HOME?.trim();
  if (envHome && envHome.length > 0) {
    return envHome;
  }
  return path.join(homeDir, '.codegpt');
}

/** Absolute path to the CodeGPT SQLite database. */
export function resolveDbPath(homeDir: string = os.homedir()): string {
  return path.join(resolveCodeGptHome(homeDir), CODEGPT_DB_FILE);
}

/** Absolute path to the CodeGPT settings.json file. */
export function resolveSettingsPath(homeDir: string = os.homedir()): string {
  return path.join(resolveCodeGptHome(homeDir), CODEGPT_SETTINGS_FILE);
}

/**
 * Normalizes a profile base URL to the bare origin form CodeGPT stores in
 * `custom_link`. Removes a trailing slash and any `/v1` (or `/v1/models`)
 * suffix, because CodeGPT appends `/v1/models` itself when fetching models.
 * Examples:
 *   "http://host:8100/v1"      -> "http://host:8100"
 *   "http://host:8100/"        -> "http://host:8100"
 *   "http://host:8100/v1/models"-> "http://host:8100"
 */
export function normalizeStorageBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  const withoutTrailingSlash = trimmed.replace(/\/+$/, '');
  return withoutTrailingSlash.replace(/\/v1(?:\/models)?$/, '');
}

/**
 * Fetches the current connection row for the local provider from the CodeGPT
 * database. Returns undefined when the DB does not exist, the row is absent,
 * or node:sqlite is unavailable; does not throw.
 */
export async function readCodeGptConnection(
  homeDir: string = os.homedir()
): Promise<{ customLink?: string; apikey?: string } | undefined> {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dbPath = resolveDbPath(homeDir);
    const exists = await fileExists(dbPath);
    if (!exists) {
      return undefined;
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare('SELECT custom_link, apikey FROM connection WHERE provider = ?')
        .get(CODEGPT_LOCAL_PROVIDER) as
        | { custom_link: string | null; apikey: string | null }
        | undefined;
      if (!row) {
        return undefined;
      }
      return {
        customLink: row.custom_link ?? undefined,
        apikey: row.apikey ?? undefined,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    logSqlite('read', error);
    return undefined;
  }
}

/**
 * Writes (or updates) the local provider's connection row in the CodeGPT
 * database. Backs up the DB first. Preserves other columns/rows via the
 * same ON CONFLICT ... DO UPDATE CodeGPT uses. Missing DB is tolerated
 * (node:sqlite will create it).
 *
 * @returns The backup path if a backup was created, else undefined.
 */
export async function writeCodeGptConnection(
  baseUrl: string,
  apiKey: string | undefined,
  homeDir: string = os.homedir()
): Promise<string | undefined> {
  const dbPath = resolveDbPath(homeDir);
  const backupPath = await createBackup(dbPath);

  try {
    const { DatabaseSync } = await import('node:sqlite');
    // Ensure the CodeGPT home directory (and thus the DB) can be created.
    const { mkdir } = await import('fs/promises');
    await mkdir(path.dirname(dbPath), { recursive: true });

    const db = new DatabaseSync(dbPath);

    db.exec(`
      CREATE TABLE IF NOT EXISTS "connection" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "provider" TEXT NOT NULL UNIQUE,
        "apikey" TEXT,
        "organization_id" TEXT DEFAULT NULL,
        "custom_link" TEXT DEFAULT NULL,
        "google_Oauth" TEXT DEFAULT NULL,
        "region" TEXT DEFAULT NULL,
        "access_key_id" TEXT DEFAULT NULL,
        "secret_access_key" TEXT DEFAULT NULL,
        "session_token" TEXT DEFAULT NULL,
        "created_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Upsert exactly like CodeGPT's own store (COALESCE preserves existing
    // values when the incoming value is NULL).
    db.prepare(`
      INSERT INTO connection
        (provider, apikey, organization_id, custom_link, google_Oauth, region,
         access_key_id, secret_access_key, session_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        apikey = COALESCE(excluded.apikey, connection.apikey),
        custom_link = COALESCE(excluded.custom_link, connection.custom_link),
        updated_at = CURRENT_TIMESTAMP
    `).run(
      CODEGPT_LOCAL_PROVIDER,
      apiKey ?? null,
      null,
      baseUrl,
      null,
      null,
      null,
      null,
      null
    );

    db.close();
    return backupPath;
  } catch (error) {
    logSqlite('write', error);
    throw error;
  }
}

/**
 * Ensures the `local-server-flavor-<provider>` key in CodeGPT's settings.json
 * is set to "custom", matching what CodeGPT writes when a local provider is
 * configured. Backs up settings.json first. Uses an atomic write.
 *
 * Returns true when the settings file is in the desired state afterward.
 */
export async function writeCodeGptLocalFlavor(
  homeDir: string = os.homedir()
): Promise<boolean> {
  const settingsPath = resolveSettingsPath(homeDir);
  try {
    const { readFileSafe, writeFileAtomic } = await import('../../util/fsSafe');
    const existingRaw = await readFileSafe(settingsPath);
    let settings: Record<string, unknown> = {};
    if (existingRaw) {
      try {
        settings = JSON.parse(existingRaw);
      } catch {
        settings = {};
      }
    }

    const key = `local-server-flavor-${CODEGPT_LOCAL_PROVIDER}`;
    if (settings[key] === 'custom') {
      return true; // Already correct.
    }

    await createBackup(settingsPath);
    settings[key] = 'custom';
    return await writeFileAtomic(settingsPath, JSON.stringify(settings, null, 2));
  } catch (error) {
    Logger.getInstance().warning(
      `Failed to update CodeGPT settings.json (${settingsPath}): ${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const { access } = await import('fs/promises');
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function logSqlite(op: 'read' | 'write', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (op === 'write') {
    Logger.getInstance().error(`CodeGPT SQLite write failed: ${message}`);
  } else {
    Logger.getInstance().debug(`CodeGPT SQLite read unavailable: ${message}`);
  }
}
