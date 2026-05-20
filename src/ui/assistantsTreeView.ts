/**
 * TreeDataProvider for the AIdome Assistants panel.
 * Shows all registered assistants with tier badge and configured/unconfigured status.
 */

import * as vscode from 'vscode';
import { loadRegistry } from '../core/registry/registryLoader';
import { ProfileStore } from '../core/profiles/profileStore';
import { Logger } from '../util/log';

/**
 * Represents a single assistant row in the tree view.
 */
export class AssistantTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly assistantKey: string,
    public readonly tier: 'A' | 'B' | 'C',
    isConfigured: boolean,
    isInstalled: boolean
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = `${label} (Tier ${tier})`;
    this.description = `Tier ${tier}`;
    this.contextValue = isConfigured ? 'configured' : 'unconfigured';

    if (isConfigured) {
      this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
    } else if (!isInstalled) {
      this.iconPath = new vscode.ThemeIcon('circle-outline');
    } else {
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    }
  }
}

/**
 * Provides the data for the AIdome Assistants tree view.
 */
export class AssistantsTreeProvider implements vscode.TreeDataProvider<AssistantTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AssistantTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private logger = Logger.getInstance();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Fire a change event to trigger a tree refresh. */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: AssistantTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<AssistantTreeItem[]> {
    try {
      const registry = await loadRegistry();
      const profileStore = new ProfileStore(this.context);
      const activeProfile = await profileStore.getActiveProfile();

      return registry.assistants.map(assistant => {
        // If there's an active profile, Tier A/B assistants are considered configured
        const isConfigured = !!activeProfile && (assistant.endpointSwitching.tier === 'A' || assistant.endpointSwitching.tier === 'B');
        const isInstalled = true; // Detection is async; treat all as installed in tree
        return new AssistantTreeItem(
          assistant.displayName,
          assistant.key,
          assistant.endpointSwitching.tier,
          isConfigured,
          isInstalled
        );
      });
    } catch (error) {
      this.logger.error('Failed to load assistants for tree view', error instanceof Error ? error : undefined);
      return [];
    }
  }
}
