/**
 * Client-side (UI-kind) extension detection and self-heal.
 *
 * Some assistants declare `extensionKind: ["ui", "workspace"]`, which makes
 * VS Code run them in the LOCAL extension host when a remote workspace is
 * open (Remote SSH/WSL/Codespaces). Such extensions are invisible to
 * `vscode.extensions.all` in the remote extension host, so normal detection
 * cannot see them even though they are installed on the remote machine —
 * and the credential/config files they read live on the client, not here.
 *
 * Detection fallback: scan the on-disk remote extensions directory for the
 * assistant's extension ID. If the on-disk manifest prefers "ui", report the
 * assistant with an `activationGap` so the wizard can offer a one-click
 * self-heal: a workspace-level `remote.extensionKind` override that forces
 * the extension to run in the remote (workspace) extension host.
 *
 * Reference: https://code.visualstudio.com/api/advanced-topics/remote-extensions
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../../util/log';

/**
 * Result of locating an assistant's extension on disk while it is NOT loaded
 * in this extension host.
 */
export interface ClientSideExtension {
  extensionId: string;
  version: string;
  /** Absolute path of the on-disk extension directory. */
  directory: string;
}

/**
 * Known platform-target suffixes used by extension directory names
 * (`<id>-<version>-<target>`). Everything before the trailing target is the
 * version.
 */
const TARGET_SUFFIXES = [
  'alpine-x64',
  'alpine-arm64',
  'linux-x64',
  'linux-arm64',
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'universal'
];

/**
 * Candidates for the remote extensions directory, in preference order.
 */
function getExtensionDirectoryCandidates(): string[] {
  const home = os.homedir();
  return [
    path.join(home, '.vscode-server', 'extensions'),
    path.join(home, '.vscode-server-insiders', 'extensions'),
    path.join(home, '.vscode-server-oss', 'extensions'),
    path.join(home, '.vscode', 'extensions')
  ];
}

/**
 * Parses `<id>-<version>[-<target>]` directory names into the version.
 */
function parseVersionFromDirectoryName(directoryName: string, idPrefix: string): string | undefined {
  const remainder = directoryName.slice(idPrefix.length);
  if (remainder.length === 0) {
    return undefined;
  }
  for (const target of TARGET_SUFFIXES) {
    const suffix = `-${target}`;
    if (remainder.endsWith(suffix)) {
      return remainder.slice(0, -suffix.length) || undefined;
    }
  }
  return remainder;
}

/**
 * Reads an on-disk extension directory and returns its metadata when the
 * manifest identifies the given extension ID and prefers the UI side.
 */
function inspectExtensionDirectory(
  directory: string,
  normalizedId: string
): ClientSideExtension | undefined {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const publisher = typeof manifest.publisher === 'string' ? manifest.publisher : '';
  const name = typeof manifest.name === 'string' ? manifest.name : '';
  const manifestId = `${publisher}.${name}`.toLowerCase();
  if (manifestId !== normalizedId) {
    return undefined;
  }

  const extensionKind = manifest.extensionKind;
  // Default extensionKind is ["workspace"]; only manifests that explicitly
  // prefer "ui" end up running client-side in a remote workspace.
  const prefersUi = Array.isArray(extensionKind) && extensionKind[0] === 'ui';
  if (!prefersUi) {
    return undefined;
  }

  const version = typeof manifest.version === 'string' ? manifest.version : 'unknown';
  return { extensionId: `${publisher}.${name}`, version, directory };
}

/**
 * Scans the on-disk remote extensions directories for an assistant whose
 * extension is installed there but NOT loaded in this (remote) extension
 * host, and whose manifest prefers the UI side.
 *
 * @param extensionId The declared extension ID from the registry.
 * @param directories Optional directory candidates (injectable for tests).
 *   Defaults to the standard remote extension directories.
 */
export function findClientSideExtension(
  extensionId: string,
  directories: string[] = getExtensionDirectoryCandidates()
): ClientSideExtension | undefined {
  const normalizedId = extensionId.toLowerCase().trim();
  const idPrefix = `${normalizedId}-`;

  for (const dir of directories) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const directoryName of entries) {
      if (!directoryName.toLowerCase().startsWith(idPrefix)) {
        continue;
      }
      const directory = path.join(dir, directoryName);
      const version = parseVersionFromDirectoryName(directoryName, idPrefix);
      const inspected = inspectExtensionDirectory(directory, normalizedId);
      if (inspected) {
        return version ? { ...inspected, version } : inspected;
      }
    }
  }
  return undefined;
}

/**
 * Merges a `remote.extensionKind` override for one extension ID into an
 * existing override map without clobbering the user's other entries.
 */
export function mergeExtensionKindOverride(
  existing: unknown,
  extensionId: string
): Record<string, string[]> {
  const merged: Record<string, string[]> =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? { ...(existing as Record<string, string[]>) }
      : {};
  merged[extensionId] = ['workspace'];
  return merged;
}

/**
 * Writes a workspace-level `remote.extensionKind` override that forces the
 * given extension to run in the remote (workspace) extension host. Existing
 * workspace-level entries are preserved.
 *
 * @returns true when the setting was written.
 */
export async function applyWorkspaceExtensionKindOverride(extensionId: string): Promise<boolean> {
  const logger = Logger.getInstance().scoped('Detection');
  try {
    const configuration = vscode.workspace.getConfiguration('remote');
    const inspected = configuration.inspect<Record<string, string[]>>('extensionKind');
    const merged = mergeExtensionKindOverride(inspected?.workspaceValue ?? {}, extensionId);
    await configuration.update('extensionKind', merged, vscode.ConfigurationTarget.Workspace);
    logger.info(`Wrote remote.extensionKind workspace override for ${extensionId}`);
    return true;
  } catch (error) {
    logger.warning(
      `Failed to write remote.extensionKind override for ${extensionId}: ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
    return false;
  }
}

/**
 * Offers a one-click self-heal for assistants that are installed remotely but
 * run client-side (UI-kind) and therefore cannot be configured by the
 * Switchboard. No-op when not connected to a remote or when there is no open
 * workspace folder to receive the override.
 *
 * @param gaps Detected assistants carrying an `activationGap`.
 */
export async function offerUiKindSelfHeal(
  gaps: Array<{ displayName: string; extensionId: string }>
): Promise<void> {
  if (gaps.length === 0 || typeof vscode.env.remoteName === 'undefined') {
    return;
  }
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    return;
  }

  const logger = Logger.getInstance().scoped('Detection');
  const names = gaps.map(gap => gap.displayName).join(', ');
  const pronoun = gaps.length === 1 ? 'it' : 'them';
  const choice = await vscode.window.showInformationMessage(
    `${names} ${gaps.length === 1 ? 'is' : 'are'} installed on this machine but running on your ` +
    'local computer, so the AIdome Switchboard cannot configure ' +
    `${pronoun} here. Move ${pronoun} into ` +
    'the remote workspace? This adds a remote.extensionKind override to the workspace settings.',
    { modal: true },
    'Move to remote workspace'
  );
  if (choice !== 'Move to remote workspace') {
    return;
  }

  for (const gap of gaps) {
    const applied = await applyWorkspaceExtensionKindOverride(gap.extensionId);
    if (!applied) {
      await vscode.window.showWarningMessage(
        `Could not write the remote.extensionKind override for ${gap.displayName}. ` +
        'Add it manually to your user settings: ' +
        `"remote.extensionKind": { "${gap.extensionId}": ["workspace"] }`
      );
      return;
    }
  }

  const reload = await vscode.window.showInformationMessage(
    `Done. Reload the window to run ${names} in the remote workspace.`,
    'Reload Window'
  );
  if (reload === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
  logger.info(`UI-kind self-heal applied for: ${gaps.map(gap => gap.extensionId).join(', ')}`);
}
