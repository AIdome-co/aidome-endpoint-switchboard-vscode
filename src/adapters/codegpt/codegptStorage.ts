/**
 * CodeGPT local-provider storage access.
 *
 * CodeGPT persists its local/OpenAI-compatible provider configuration in a
 * plain SQLite database at `~/.codegpt/db.sqlite` (or `$CODEGPT_HOME/db.sqlite`)
 * plus a `settings.json` in the same directory — NOT in VS Code contributed
 * settings. This module reads and writes that storage so the switchboard can
 * configure CodeGPT exactly as CodeGPT's own "Manage my AI Models" UI does.
 *
 * Contract (verified against the official CodeGPT v3.24.84 sidecar server
 * code, `standalone/.next/server/chunks/`, in the installed extension):
 *  - `connection` table: `INSERT ... ON CONFLICT(provider) DO UPDATE` with
 *    `custom_link` (the bare base URL, NO trailing slash and NO `/v1`) and
 *    `apikey`. Provider keys are lowercased/space-stripped (e.g. `lmstudio`);
 *    `getByProvider` normalizes the same way, so either casing resolves.
 *  - CodeGPT appends `/v1/models` itself (model probe fetches
 *    `${custom_link}/v1/models`), so `custom_link` must be the bare origin;
 *    the chat builder additionally strips a `/v1` suffix before appending
 *    `/v1/chat/completions`.
 *  - `settings.json` carries `local-server-flavor-<provider>: "custom"`.
 *
 * Writes prefer CodeGPT's own sidecar HTTP API
 * (`POST http://localhost:54112/api/migrate-sqlite`, type "connection" — the
 * endpoint the VS Code extension itself uses) so the running sidecar observes
 * the change immediately; the direct `node:sqlite` write below is the
 * fallback when the sidecar is not running. This module uses Node's built-in
 * `node:sqlite` (available in the VS Code extension host and Node 20+), so no
 * native dependency is added.
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
 * database. Backs up the DB first unless `options.skipBackup` (the caller
 * already created one). Preserves other columns/rows via the same
 * ON CONFLICT ... DO UPDATE CodeGPT uses. Missing DB is tolerated
 * (node:sqlite will create it). A best-effort WAL checkpoint merges the
 * write into the main db file so on-disk inspection sees the new state.
 *
 * @returns The backup path if a backup was created, else undefined.
 */
export async function writeCodeGptConnection(
  baseUrl: string,
  apiKey: string | undefined,
  homeDir: string = os.homedir(),
  options: { skipBackup?: boolean } = {}
): Promise<string | undefined> {
  const dbPath = resolveDbPath(homeDir);
  const backupPath = options.skipBackup ? undefined : await createBackup(dbPath);

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

    // Best-effort: merge the WAL into the main db file so the on-disk file
    // reflects the committed write even while CodeGPT's sidecar holds the
    // database open in WAL mode. Never fails the write.
    await checkpointCodeGptDb(homeDir);

    return backupPath;
  } catch (error) {
    logSqlite('write', error);
    throw error;
  }
}

/**
 * Best-effort WAL checkpoint (PASSIVE) of the CodeGPT database. PASSIVE
 * never blocks concurrent readers/writers (CodeGPT's sidecar keeps the DB
 * open) and simply merges as much of the WAL into the main file as it can.
 * Returns true when a checkpoint ran (or the DB does not exist yet); false
 * on any error/busy outcome — callers must treat this as advisory only.
 */
export async function checkpointCodeGptDb(
  homeDir: string = os.homedir()
): Promise<boolean> {
  try {
    const dbPath = resolveDbPath(homeDir);
    if (!(await fileExists(dbPath))) {
      return true;
    }
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get();
    } finally {
      db.close();
    }
    return true;
  } catch (error) {
    logSqlite('checkpoint', error);
    return false;
  }
}

/**
 * Creates a backup of the CodeGPT database file (undefined when the DB does
 * not exist yet — nothing to back up).
 */
export async function backupCodeGptDb(
  homeDir: string = os.homedir()
): Promise<string | undefined> {
  const dbPath = resolveDbPath(homeDir);
  if (!(await fileExists(dbPath))) {
    return undefined;
  }
  return createBackup(dbPath);
}

/**
 * The CodeGPT VS Code extension persists connection objects through its
 * local sidecar agent rather than writing SQLite itself:
 * `POST http://localhost:54112/api/migrate-sqlite` with
 * `{type:"connection", provider, custom_link?, apikey?...}`.
 *
 * Preferred write path: when the sidecar is running it applies the same
 * COALESCE upsert the extension would, so no desync. Returns false when the
 * sidecar is unreachable, times out, or answers non-2xx — the caller then
 * falls back to the direct SQLite write.
 */
export async function writeCodeGptConnectionViaSidecar(
  baseUrl: string,
  apiKey: string | undefined,
  homeDir: string = os.homedir()
): Promise<boolean> {
  const port = process.env.CODEGPT_SIDECAR_PORT?.trim() || '54112';
  try {
    const response = await fetch(`http://localhost:${port}/api/migrate-sqlite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'connection',
        provider: CODEGPT_LOCAL_PROVIDER,
        custom_link: baseUrl,
        ...(apiKey ? { apikey: apiKey } : {}),
        ...(resolveCodeGptHome(homeDir) !== path.join(os.homedir(), '.codegpt')
          ? { codegpt_home: resolveCodeGptHome(homeDir) }
          : {})
      }),
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      Logger.getInstance().debug(
        `CodeGPT sidecar rejected the connection write (HTTP ${response.status}); falling back to direct SQLite`
      );
      return false;
    }
    return true;
  } catch (error) {
    Logger.getInstance().debug(
      `CodeGPT sidecar not reachable (${error instanceof Error ? error.message : String(error)}); falling back to direct SQLite`
    );
    return false;
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

function logSqlite(op: 'read' | 'write' | 'checkpoint', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (op === 'write') {
    Logger.getInstance().error(`CodeGPT SQLite write failed: ${message}`);
  } else {
    Logger.getInstance().debug(`CodeGPT SQLite ${op} unavailable: ${message}`);
  }
}
