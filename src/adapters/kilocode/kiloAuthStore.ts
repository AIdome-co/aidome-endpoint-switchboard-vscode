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
import { randomUUID } from 'crypto';
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
): Promise<string> {
  let targetPath = authPath;
  try {
    const linkStat = await fs.lstat(authPath);
    if (linkStat.isSymbolicLink()) {
      // readlink (not realpath): a DANGLING link (dotfiles target temporarily
        // absent) must still resolve to its recorded target — realpath would
      // throw and fall back to replacing the link itself (Codex 154 round 9).
      const linkText = await fs.readlink(authPath);
      targetPath = path.isAbsolute(linkText)
        ? linkText
        : path.resolve(path.dirname(authPath), linkText);
    }
  } catch {
    // lstat/readlink failure on the path is handled by the caller's write.
  }
  // Unique per invocation: two concurrent profile activations share the
  // global Kilo store — a fixed temp path would let one rename/remove the
  // file the other is still writing (ENOENT or cross-activation PAT swap).
  const tmpPath = `${targetPath}.aidome-tmp-${randomUUID()}`;
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fs.writeFile(tmpPath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(tmpPath, 0o600);
    await fs.rename(tmpPath, targetPath);
    return targetPath;
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
  // A whitespace-only token is NOT a credential: normalize it to missing so
  // the no-op/gap classification and the written key stay truthful
  // (Codex 154 round 7).
  const apiKey = options.apiKey?.trim() || undefined;
  const normalized = { ...options, apiKey };
  const authPath = resolveKiloAuthPath(options.dataDir);

  // Symlink handling: a symlinked auth.json (dotfiles-managed) must keep
  // pointing at its target after any write/rollback — including a DANGLING
  // link whose target is temporarily absent (lstat succeeds, content reads
  // fail). Rollback then restores the LINK ITSELF, not a regular file.
  let danglingSymlinkText: string | undefined;
  let authExisted = false;
  try {
    const linkStat = await fs.lstat(authPath);
    authExisted = true; // any existing directory entry counts as existing
    if (linkStat.isSymbolicLink()) {
      const linkText = await fs.readlink(authPath);
      const resolved = path.isAbsolute(linkText)
        ? linkText
        : path.resolve(path.dirname(authPath), linkText);
      try {
        await fs.stat(resolved); // target present → normal content flow
      } catch {
        danglingSymlinkText = linkText; // target absent → dangling link
      }
    }
  } catch {
    authExisted = false; // no entry at all
  }

  let document: Record<string, unknown> = {};
  if (authExisted && danglingSymlinkText === undefined) {
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
  if (!apiKey && !(KILO_PROVIDER_SLUG in document)) {
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

  // A dangling symlink has no content to back up — the LINK TEXT itself is
  // the recoverable state (restoreAuth recreates it).
  const authBackupPath =
    authExisted && danglingSymlinkText === undefined
      ? await createBackup(authPath)
      : undefined;
  if (authBackupPath) {
    // createBackup preserves the SOURCE mode (fs.copyFile): a legacy 0644
    // auth.json would leave a world-readable backup containing the old PAT
    // and every other Kilo credential. Credential backups are always 0600
    // (Codex 154 round 6, finding a) — and if the mode cannot be tightened
    // (filesystems without POSIX modes), fail closed and REMOVE the backup
    // instead of leaving a permissive credential copy on disk
    // (Codex 154 round 11, finding U1QG).
    try {
      await fs.chmod(authBackupPath, 0o600);
    } catch (error) {
      await fs.rm(authBackupPath, { force: true }).catch(() => undefined);
      throw new Error(
        `Could not restrict the credential backup ${authBackupPath} to 0600 and removed it; refusing to continue while a permissive copy of the credentials exists. (${error instanceof Error ? error.message : String(error)})`
      );
    }
  }
  if (authExisted && danglingSymlinkText === undefined && !authBackupPath) {
    throw new Error(
      `Could not create a backup of ${authPath}; refusing to mutate it without a recoverable copy`
    );
  }

  // Guarded commit: Kilo (or another extension host) may have updated
  // auth.json between our read and the rename — the atomic replacement would
  // silently discard that concurrent update, including credentials we
  // promised to preserve. Re-read immediately before committing and re-apply
  // OUR single-entry change onto the fresh document (Codex 154 round 8).
  const applyChange = (doc: Record<string, unknown>): void => {
    if (apiKey) {
      // Explicit set — never preserve a previous profile's token (Area 7.3).
      doc[KILO_PROVIDER_SLUG] = { type: 'api', key: apiKey } satisfies KiloAuthKeyEntry;
    } else {
      // A credential-less profile must CLEAR our entry, not replay the old key.
      delete doc[KILO_PROVIDER_SLUG];
    }
  };
  const firstRaw = authExisted && danglingSymlinkText === undefined
    ? await readFileSafe(authPath)
    : undefined;
  const freshRaw = danglingSymlinkText === undefined
    ? await readFileSafe(authPath)
    : undefined;
  if (freshRaw === undefined && authExisted && danglingSymlinkText === undefined) {
    throw new Error(
      `${authPath} disappeared before the credential could be written; re-run the setup.`
    );
  }
  if (freshRaw !== undefined && freshRaw !== firstRaw) {
    // The file changed under us — re-parse and re-apply onto the fresh doc.
    try {
      const parsed: unknown = JSON.parse(freshRaw);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
      }
      document = parsed as Record<string, unknown>;
      applyChange(document);
    } catch (error) {
      throw new Error(
        `${authPath} changed concurrently and is no longer valid JSON; refusing to overwrite it. Fix the file manually, then re-run the setup. (${error instanceof Error ? error.message : String(error)})`
      );
    }
  } else {
    applyChange(document);
  }

  let resolvedTarget: string | undefined;
  try {
    resolvedTarget = await writeAuthFileAtomically(authPath, document);
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
    if (danglingSymlinkText !== undefined) {
      // The write may have MATERIALIZED the previously absent target — a
      // rollback must remove that file too, or the PAT survives behind the
      // recreated dangling link while the step reports rolled-back
      // (Codex 154 round 11, finding U1QL).
      if (resolvedTarget) {
        await fs.rm(resolvedTarget, { force: true });
      }
      // Restore the LINK ITSELF — the managed store stays symlink-managed.
      await fs.rm(authPath, { force: true });
      await fs.symlink(danglingSymlinkText, authPath);
    } else if (authBackupPath) {
      await fs.copyFile(authBackupPath, authPath);
    } else if (!authExisted) {
      await fs.rm(authPath, { force: true });
    }
  };

  try {
    const { extraRollbacks, modelsApplied } = await refreshKiloModels(normalized);
    return {
      backupPath: authBackupPath,
      // For a dangling symlink the credential lives in the MATERIALIZED
      // target, not at the link path — report the resolved target so a
      // generic rollback removes the created file and the dangling link
      // survives untouched (Codex 154 round 10).
      target: resolvedTarget ?? authPath,
      createdFile: !authExisted || danglingSymlinkText !== undefined,
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
  // Guarded commit (same pattern as the auth.json write): Kilo or the user
  // may have saved kilo.jsonc while discovery was running — re-read
  // immediately before rendering and re-apply OUR change onto the fresh
  // content instead of overwriting a concurrent edit with the stale
  // snapshot (Codex 154 round 11, finding U1QP).
  let baseContent = existingContent;
  const freshContent = await readFileSafe(configPath);
  if (freshContent === undefined) {
    throw new Error(
      `${configPath} disappeared before the model list could be written; re-run the setup.`
    );
  }
  if (freshContent !== existingContent) {
    try {
      parseJsonc(freshContent);
    } catch (error) {
      throw new Error(
        `${configPath} changed concurrently and is no longer valid JSONC; refusing to overwrite it. (${error instanceof Error ? error.message : String(error)})`
      );
    }
    baseContent = freshContent;
  }

  const merged = reconcileModelEntries(baseContent, slugs);
  const models =
    Object.keys(merged).length > 0
      ? (merged as Record<string, { name: string }>)
      : buildModelEntries(slugs);
  const rendered = buildKiloConfigContent(options.baseUrl, baseContent, undefined, models);

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

  // Prototype-free records: a gateway model ID inherited from
  // Object.prototype ('constructor', 'toString', '__proto__') must round-trip
  // as an OWN model entry, not collide with inherited members (Codex 154
  // round 10).
  const reconciled: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const slug of slugs) {
    // Surviving entries keep their whole existing metadata; new ids fall
    // back to a name-only entry.
    const inherited =
      Object.prototype.hasOwnProperty.call(existing, slug) ? existing[slug] : undefined;
    if (inherited !== undefined) {
      Object.defineProperty(reconciled, slug, { value: inherited, enumerable: true, writable: true });
    } else {
      Object.defineProperty(reconciled, slug, {
        value: { name: slug },
        enumerable: true,
        writable: true
      });
    }
  }
  return reconciled;
}
