/**
 * Kilo Code credential store writer.
 *
 * Kilo persists provider credentials in `<XDG_DATA_HOME|~/.local/share>/kilo/auth.json`
 * (opencode LegacyAuth format) and reconciles that file into its credential
 * database on every backend startup (pub-refs kilocode
 * `packages/core/src/credential.ts`, `legacyImportLayer` — upstream comment:
 * "reconcile on every startup so a released client can update auth.json after
 * import"). At request time the runner resolves the credential for the model's
 * provider id and sends it as `Auth.bearer(key)`
 * (`packages/core/src/session/runner/model.ts`).
 *
 * We therefore merge-write ONLY our own provider entry and never touch any
 * other integration's credential. The file is Kilo's own storage contract
 * (its UI writes the same shape via `writeLegacy` at mode 0o600).
 *
 * Security: the key material originates from the extension's SecretStorage and
 * is only persisted into Kilo's own credential file — the same place Kilo's UI
 * stores it. It is never written to kilo.jsonc (the custom-provider schema
 * strips `options.apiKey` and the `env` array is env-var NAMES only).
 */

import os from 'os';
import path from 'path';
import * as fs from 'fs/promises';
import { createBackup, fileExists, readFileSafe } from '../../util/fsSafe';
import { parseJsonc } from '../../util/jsonc';
import { Logger } from '../../util/log';
import {
  buildKiloConfigContent,
  buildModelEntries,
  discoverModels,
  getKiloConfigPath
} from './kiloConfigPatcher';

/** The provider slug the adapter manages inside kilo.jsonc and auth.json. */
export const KILO_PROVIDER_SLUG = 'aidome-gateway';

/** Shape of one LegacyAuth "api key" credential entry. */
interface KiloAuthKeyEntry {
  type: 'api';
  key: string;
}

export interface KiloAuthWriteResult {
  /** Backup of auth.json before the write (absent when newly created). */
  backupPath?: string;
  /** Absolute path of auth.json. */
  target: string;
  /** True when auth.json did not exist before the write. */
  createdFile: boolean;
  /** Additional mutated targets (kilo.jsonc model re-render) for rollback. */
  extraRollbacks?: Array<{ target: string; backupPath?: string; createdFile?: boolean }>;
  /** True when the writer confirmed there was nothing to write (no credential and no managed entry). */
  noOp?: boolean;
  /** True — Kilo cannot authenticate without a credential (GAP 9 outcome gate). */
  authRequired?: boolean;
  /** True when the provider's model map was successfully populated/refreshed. */
  modelsApplied?: boolean;
  /** True — Kilo requires at least one model for the provider to be usable. */
  modelsRequired?: boolean;
}

export interface WriteKiloProviderAuthOptions {
  baseUrl: string;
  /** PAT resolved from SecretStorage; when absent our entry is CLEARED. */
  apiKey?: string;
  /** Test seam: overrides the Kilo data directory. */
  dataDir?: string;
  /** Test seam: overrides the kilo.jsonc path. */
  configPath?: string;
}

/**
 * Atomically replaces auth.json: writes a 0600 temp file in the same
 * directory and renames it over the target. Rename is atomic per-filesystem,
 * so a failure can never leave a truncated credential file, and replacing a
 * pre-existing permissive-mode file enforces 0600 (writeFile's mode is only
 * applied on CREATE — chmod via the fresh temp file is what guarantees it).
 *
 * SYMLINKS: a symlinked auth.json (dotfiles-managed Kilo setups) must keep
 * pointing at its managed target after the write — renaming over the link
 * itself would silently replace it with a regular file and diverge from the
 * centrally managed store. The real target is therefore resolved before the
 * temp file is written, and the rename lands on the target (Codex 154
 * round 5).
 */
async function writeAuthFileAtomically(
  authPath: string,
  document: Record<string, unknown>
): Promise<void> {
  let targetPath = authPath;
  try {
    const linkStat = await fs.lstat(authPath);
    if (linkStat.isSymbolicLink()) {
      targetPath = await fs.realpath(authPath);
    }
  } catch {
    // lstat failure on the target path is handled by the caller's write.
  }
  const tmpPath = `${targetPath}.aidome-tmp`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(tmpPath, 0o600);
    await fs.rename(tmpPath, targetPath);
  } finally {
    // A mid-write failure (ENOSPC, permissions) can leave a stale credential
    // fragment in the temp file beside the resolved target — always clean up
    // the LOCALLY computed tmp path (Codex 154 round 6, finding b).
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }
}

/** Resolves Kilo's global data dir the same way Kilo's xdg-basedir Path.data does. */
export function resolveKiloAuthPath(dataDir?: string): string {
  const base =
    dataDir?.trim() ||
    process.env.XDG_DATA_HOME?.trim() ||
    path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'kilo', 'auth.json');
}

/**
 * Writes the AIdome credential into Kilo's auth.json and (when a credential is
 * available) refreshes the provider entry's model list in kilo.jsonc from an
 * AUTHENTICATED discovery call. Follows the fail-closed storage-write hygiene:
 * never mutate without a recoverable backup, never replace an unparsable file,
 * self-restore earlier mutations when a later one fails, and report every
 * mutated target for applier rollback.
 */
export async function writeKiloProviderAuth(
  options: WriteKiloProviderAuthOptions
): Promise<KiloAuthWriteResult> {
  const authPath = resolveKiloAuthPath(options.dataDir);
  const authExisted = await fileExists(authPath);

  let document: Record<string, unknown> = {};
  if (authExisted) {
    const raw = await readFileSafe(authPath);
    if (raw === undefined || raw.trim().length === 0) {
      throw new Error(
        `${authPath} exists but could not be read; refusing to overwrite it. Fix or remove the file manually, then re-run the setup.`
      );
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      document = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `${authPath} exists but is not valid JSON; refusing to overwrite it. Fix or remove the file manually, then re-run the setup. (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }

  // A credential-less profile with no managed entry present is a confirmed
  // no-op — nothing to clear, nothing to write. Report it BEFORE creating a
  // backup: a no-op must not accumulate stale credential copies on disk
  // (Codex 154 round 2, finding L). The result still flags authRequired so
  // the applier classifies the outcome as guided-required (GAP 9).
  if (!options.apiKey && !(KILO_PROVIDER_SLUG in document)) {
    // A confirmed credential no-op can still leave a USABLE model map
    // (planning-probe or user-curated) — the gap is judged from the
    // resulting config (Codex 154 round 4).
    const configPath = options.configPath ?? getKiloConfigPath();
    const modelsApplied = configPath ? await configHasModels(configPath) : false;
    return {
      noOp: true,
      authRequired: true,
      modelsApplied,
      modelsRequired: true,
      target: authPath,
      createdFile: false
    };
  }

  const authBackupPath = authExisted ? await createBackup(authPath) : undefined;
  if (authBackupPath) {
    // createBackup preserves the SOURCE mode (fs.copyFile): a legacy 0644
    // auth.json would leave a world-readable backup containing the old PAT
    // and every other Kilo credential. Credential backups are always 0600
    // (Codex 154 round 6, finding a).
    await fs.chmod(authBackupPath, 0o600).catch(() => undefined);
  }
  if (authExisted && !authBackupPath) {
    throw new Error(
      `Could not create a backup of ${authPath}; refusing to mutate it without a recoverable copy`
    );
  }

  if (options.apiKey) {
    // Explicit set — never preserve a previous profile's token (Area 7.3).
    document[KILO_PROVIDER_SLUG] = { type: 'api', key: options.apiKey } satisfies KiloAuthKeyEntry;
  } else {
    // A credential-less profile must CLEAR our entry, not replay the old key.
    delete document[KILO_PROVIDER_SLUG];
  }

  try {
    await writeAuthFileAtomically(authPath, document);
  } catch (error) {
    // The write is ATOMIC (temp file + rename): a failure can never leave a
    // truncated or partially replaced auth.json behind, so no restore of the
    // pre-write content is needed — the original file (or its absence) is
    // intact (Codex 154 round 3, finding X: atomic 0600 replacement also
    // enforces 0600 on files that existed with permissive modes). Temp-file
    // cleanup is guaranteed inside writeAuthFileAtomically.
    throw new Error(
      `Failed to write ${authPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Auth write committed. A later failure must self-restore it before
  // propagating (a rejected step never enters the applier's rollback list).
  // Restore failures PROPAGATE — the caller attaches manual-recovery
  // instructions instead of silently keeping the committed credential.
  const restoreAuth = async (): Promise<void> => {
    if (authBackupPath) {
      await fs.copyFile(authBackupPath, authPath);
    } else if (!authExisted) {
      await fs.rm(authPath, { force: true });
    }
  };

  try {
    const { extraRollbacks, modelsApplied } = await refreshKiloModels(options);
    return {
      backupPath: authBackupPath,
      target: authPath,
      createdFile: !authExisted,
      extraRollbacks,
      // Kilo's provider cannot authenticate without a key — a missing
      // credential is an authentication gap (GAP 9), not a valid config.
      authRequired: true,
      // Kilo requires at least one model per provider (upstream schema:
      // "At least one model is required") — an unpopulated model list is
      // an incomplete configuration, not a valid one.
      modelsApplied,
      modelsRequired: true
    };
  } catch (error) {
    let restoreNote = '';
    try {
      await restoreAuth();
    } catch (restoreError) {
      // NEVER swallow a failed restore: without actionable recovery
      // instructions the committed PAT would remain active after a reported
      // failure (Codex 154 round 3, finding b).
      restoreNote = authBackupPath
        ? ` MANUAL RECOVERY REQUIRED: restoring ${authPath} from the backup also failed — copy it back manually: cp "${authBackupPath}" "${authPath}"`
        : ` MANUAL RECOVERY REQUIRED: cleaning up the newly created ${authPath} also failed — remove it manually.`;
      Logger.getInstance().warning(
        `Failed to restore ${authPath} after a failed Kilo model refresh: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
      );
    }
    throw new Error(
      `Kilo model refresh failed; the committed credential write was rolled back.${restoreNote} (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

/**
 * True when the provider entry in the given config already carries a
 * nonempty `models` map — e.g. the planning probe populated it (a gateway
 * that serves unauthenticated model lists), or the user configured models
 * earlier. The models-gap outcome must be judged from the RESULTING config,
 * not solely from whether this refresh ran (Codex 154 round 4).
 */
async function configHasModels(configPath: string): Promise<boolean> {
  try {
    const content = await readFileSafe(configPath);
    if (content === undefined) {
      return false;
    }
    const parsed = parseJsonc<Record<string, unknown>>(content);
    const providerMap =
      parsed !== null && typeof parsed === 'object' ? parsed['provider'] : undefined;
    const entry =
      providerMap !== null && typeof providerMap === 'object' && !Array.isArray(providerMap)
        ? (providerMap as Record<string, unknown>)[KILO_PROVIDER_SLUG]
        : undefined;
    const models =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)['models']
        : undefined;
    return (
      models !== null && typeof models === 'object' && !Array.isArray(models)
      && Object.keys(models as Record<string, unknown>).length > 0
    );
  } catch {
    return false;
  }
}

/**
 * Reconciles kilo.jsonc's `models` map with models discovered using the
 * authenticated endpoint probe (see reconcileModelEntries). Best-effort:
 * when no credential or no config file exists the config is left untouched.
 * Returns rollback targets for the config write plus whether the resulting
 * config carries a usable model map (`modelsApplied`) — judged from the
 * resulting config, not solely from this refresh.
 */
async function refreshKiloModels(
  options: WriteKiloProviderAuthOptions
): Promise<{ extraRollbacks: KiloAuthWriteResult['extraRollbacks']; modelsApplied: boolean }> {
  const configPath = options.configPath ?? getKiloConfigPath();
  if (!configPath) {
    return { extraRollbacks: [], modelsApplied: false };
  }
  if (!options.apiKey) {
    // No credential — but the planning probe or the user may already have
    // populated models; the gap is judged from the resulting config.
    return { extraRollbacks: [], modelsApplied: await configHasModels(configPath) };
  }
  const configExisted = await fileExists(configPath);
  if (!configExisted) {
    return { extraRollbacks: [], modelsApplied: false };
  }

  const slugs = await discoverModels(options.baseUrl, options.apiKey);
  if (slugs.length === 0) {
    // Empty probe = discovery failure, not an empty catalog: leave the
    // config untouched. The models gap is judged from the resulting config —
    // planning-supplied or user-curated models still count as applied.
    return { extraRollbacks: [], modelsApplied: await configHasModels(configPath) };
  }

  const existingContent = await readFileSafe(configPath);
  if (existingContent === undefined) {
    return { extraRollbacks: [], modelsApplied: await configHasModels(configPath) };
  }

  // Reconcile semantics (Activate Profile = authoritative sync): the
  // discovered list IS the gateway's current model set. Entries still served
  // keep their full existing metadata; models the gateway no longer serves
  // are REMOVED, so profile re-activation picks up removals too.
  const merged = reconcileModelEntries(existingContent, slugs);
  const models =
    Object.keys(merged).length > 0
      ? (merged as Record<string, { name: string }>)
      : buildModelEntries(slugs);
  const rendered = buildKiloConfigContent(options.baseUrl, existingContent, undefined, models);

  const configBackupPath = await createBackup(configPath);
  if (!configBackupPath) {
    throw new Error(
      `Could not create a backup of ${configPath}; refusing to mutate it without a recoverable copy`
    );
  }

  try {
    await fs.writeFile(configPath, rendered);
  } catch (error) {
    let restoreNote = '';
    try {
      await fs.copyFile(configBackupPath, configPath);
    } catch (restoreError) {
      // NEVER swallow a failed restore: a truncated kilo.jsonc without
      // recovery instructions would leave the user's config corrupted
      // (Codex 154 round 4, finding a).
      restoreNote = ` MANUAL RECOVERY REQUIRED: restoring ${configPath} from the backup also failed — copy it back manually: cp "${configBackupPath}" "${configPath}"`;
      Logger.getInstance().warning(
        `Failed to restore ${configPath} after a failed model write: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`
      );
    }
    throw new Error(
      `Failed to write the discovered models to ${configPath}.${restoreNote} (${error instanceof Error ? error.message : String(error)})`
    );
  }

  return {
    extraRollbacks: [{ target: configPath, backupPath: configBackupPath, createdFile: !configExisted }],
    modelsApplied: true
  };
}

/**
 * Reconciles the provider's `models` map to the discovered gateway list:
 * the discovery result is authoritative. Entries for models still served
 * keep their WHOLE existing metadata object (limits, costs, modalities,
 * variants, user-curated names); models the gateway no longer serves are
 * dropped; newly served models get a name-only fallback entry. Callers must
 * NOT invoke this with an empty `slugs` result — an empty probe is treated
 * as a discovery failure, not an empty catalog.
 */
export function reconcileModelEntries(
  existingContent: string,
  slugs: string[]
): Record<string, unknown> {
  let existing: Record<string, unknown> = {};
  try {
    const parsed = parseJsonc<Record<string, unknown>>(existingContent);
    const providerMap = parsed?.['provider'];
    const entry =
      providerMap !== null && typeof providerMap === 'object' && !Array.isArray(providerMap)
        ? (providerMap as Record<string, unknown>)[KILO_PROVIDER_SLUG]
        : undefined;
    const models =
      entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)['models']
        : undefined;
    if (models !== null && typeof models === 'object' && !Array.isArray(models)) {
      existing = { ...(models as Record<string, unknown>) };
    }
  } catch {
    existing = {};
  }

  const reconciled: Record<string, unknown> = {};
  for (const slug of slugs) {
    // Surviving entries keep their whole existing metadata; new ids fall
    // back to a name-only entry.
    reconciled[slug] = existing[slug] ?? { name: slug };
  }
  return reconciled;
}
