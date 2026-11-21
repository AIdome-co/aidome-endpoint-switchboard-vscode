/**
 * Client-side (UI-kind) extension detection and self-heal guidance.
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
 * assistant with an `activationGap` so the wizard can explain the situation,
 * copy ready-to-paste `remote.extensionKind` instructions into the user's
 * LOCAL clipboard, and exclude the assistant from switchable selection until
 * the user applies the override and reloads.
 *
 * Why guidance instead of a settings write: extension placement is decided
 * by the CLIENT before workspace settings load, and a `remote.extensionKind`
 * value in workspace settings is ignored (microsoft/vscode#309379, open).
 * Only the client's USER settings are effective — which a remote extension
 * cannot write. `vscode.env.clipboard.writeText` routes to the client, so
 * the exact snippet can still be delivered in one click.
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
    path.join(home, '.vscode-remote', 'extensions'),
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
 * Builds the ready-to-paste `remote.extensionKind` snippet for the given
 * extension IDs. The user must merge it into their LOCAL user settings
 * (existing `remote.extensionKind` entries, if any, must be kept).
 */
export function buildExtensionKindSnippet(extensionIds: string[]): string {
  const entries = extensionIds.map(id => `    "${id}": ["workspace"]`).join(',\n');
  return `{\n  "remote.extensionKind": {\n${entries}\n  }\n}`;
}

/**
 * Partitions detected assistants into the UI-kind activation gaps (installed
 * remotely but running client-side, not configurable by the Switchboard) and
 * the assistants that can proceed through the switchable flow.
 */
export function partitionUiKindGaps<T extends { activationGap?: 'ui-kind' }>(
  detected: T[]
): { gaps: T[]; switchable: T[] } {
  const gaps = detected.filter(assistant => assistant.activationGap === 'ui-kind');
  const switchable = detected.filter(assistant => assistant.activationGap !== 'ui-kind');
  return { gaps, switchable };
}

/**
 * Explains a detected UI-kind activation gap and copies the ready-to-paste
 * `remote.extensionKind` override into the user's LOCAL clipboard
 * (`vscode.env.clipboard` routes to the client). No-op outside remote
 * sessions or for an empty gap list.
 */
export async function offerUiKindSelfHeal(
  gaps: Array<{ displayName: string; extensionId: string }>
): Promise<void> {
  if (gaps.length === 0 || typeof vscode.env.remoteName === 'undefined') {
    return;
  }

  const logger = Logger.getInstance().scoped('Detection');
  const names = gaps.map(gap => gap.displayName).join(', ');
  const pronoun = gaps.length === 1 ? 'it' : 'them';
  const snippet = buildExtensionKindSnippet(gaps.map(gap => gap.extensionId));

  const message =
    `${names} ${gaps.length === 1 ? 'is' : 'are'} installed on this machine but running on your ` +
    `local computer, so the AIdome Switchboard cannot configure ${pronoun} here. ` +
    'Paste the copied snippet into your local user settings.json (merge with any existing ' +
    'remote.extensionKind entries) and reload the window — ' +
    `${gaps.length === 1 ? 'it' : 'they'} will then run in the remote workspace and be detected.`;

  try {
    await vscode.env.clipboard.writeText(snippet);
    await vscode.window.showInformationMessage(`${message}\n\n${snippet}`, { modal: true }, 'OK');
  } catch (error) {
    logger.warning(
      `Could not copy the remote.extensionKind snippet: ` +
      `${error instanceof Error ? error.message : String(error)}`
    );
    await vscode.window.showWarningMessage(`${message}\n\nManual snippet:\n${snippet}`);
  }
  logger.info(`UI-kind activation gap reported for: ${gaps.map(gap => gap.extensionId).join(', ')}`);
}
