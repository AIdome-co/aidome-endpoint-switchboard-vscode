/**
 * Post-apply reload prompt for assistants that hold file-backed state in
 * memory while running.
 *
 * Some assistants (notably Cline) load their configuration files into memory
 * once at activation and opportunistically persist their whole in-memory
 * state back over those files. Any external change to the files while the
 * assistant is live is unseen and gets clobbered by the next state save
 * (verified against upstream cline/cline `ClineFileStorage`, which snapshots
 * the file in the constructor and writes the full snapshot back on every
 * change). The only way external writes win is a fresh read at extension
 * startup — i.e. a window reload.
 */

import * as vscode from 'vscode';

export const RELOAD_WINDOW_ACTION = 'Reload Window';

/**
 * Offers a window reload when any of the given VS Code extensions is
 * currently active, so it re-reads its file-backed configuration from disk
 * instead of overwriting it with stale in-memory state.
 *
 * No-op when no listed extension is active (nothing holds stale state), when
 * the host lacks the extension API (unit-test environments), and on any
 * internal failure — this is an advisory UX affordance, never a step that
 * can fail an apply.
 *
 * @param extensionIds Extension IDs whose live state can clobber applied files.
 */
export async function promptReloadForExtensionIds(extensionIds: string[]): Promise<void> {
  if (extensionIds.length === 0) {
    return;
  }

  try {
    // Feature-detect: unit-test environments mock `vscode` sparsely, and the
    // prompt must be a no-op there rather than a broken test.
    const getExtension = (vscode as Partial<typeof vscode> | undefined)?.extensions?.getExtension;
    if (typeof getExtension !== 'function') {
      return;
    }

    const active = extensionIds
      .map(id => getExtension.call(vscode.extensions, id))
      .filter((ext): ext is NonNullable<typeof ext> => Boolean(ext?.isActive));

    if (active.length === 0) {
      return;
    }

    const names = active
      .map(ext => (typeof ext.packageJSON?.displayName === 'string' ? ext.packageJSON.displayName : ext.id))
      .join(', ');

    const answer = await vscode.window.showWarningMessage(
      `${names} ${active.length === 1 ? 'is' : 'are'} currently running and may overwrite the new configuration ` +
      'with in-memory state. Reload the window to load the new configuration.',
      RELOAD_WINDOW_ACTION
    );

    if (answer === RELOAD_WINDOW_ACTION) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  } catch {
    // Advisory only — never fail an apply because the prompt could not be shown.
  }
}

/**
 * Convenience for top-level command flows: prompts the reload AFTER the
 * caller's own post-apply state updates (setActiveProfile, mapping cleanup,
 * failure restoration, multi-assistant loops) are complete. Callers pass the
 * ApplierResult (or an aggregate) so the reload requirement survives the
 * whole workflow instead of terminating the extension host mid-flight.
 *
 * @param applyResult An ApplierResult or any object carrying reloadExtensionIds.
 */
export async function promptReloadAfterApply(
  applyResult: { reloadExtensionIds?: string[] } | undefined | null
): Promise<void> {
  await promptReloadForExtensionIds(applyResult?.reloadExtensionIds ?? []);
}
