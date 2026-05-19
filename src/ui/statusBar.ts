/**
 * Status bar management for extension.
 */

import * as vscode from 'vscode';
import { AssistantMapping, EndpointProfile } from '../core/profiles/profileTypes';

let statusBarItem: vscode.StatusBarItem | undefined;

export interface StatusBarSummary {
  configuredAssistantCount: number;
  profilesInUse: Array<{ id: string; name: string }>;
}

/**
 * StatusBarManager class for managing status bar states.
 */
export class StatusBarManager {
  constructor(private item: vscode.StatusBarItem) {}

  /**
   * Set status bar to configured state.
   * @param summary The configured profile summary
   */
  setConfigured(summary: string | StatusBarSummary): void {
    const normalizedSummary = normalizeSummary(summary);
    if (!normalizedSummary) {
      this.setNotConfigured();
      return;
    }

    applyConfiguredState(this.item, normalizedSummary);
  }

  /**
   * Set status bar to not configured state.
   */
  setNotConfigured(): void {
    this.item.text = '$(warning) AIdome: Not configured';
    this.item.tooltip = 'No assistant profile assignments\nClick for quick actions';
    this.item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    this.item.accessibilityInformation = {
      label: 'AIdome Switchboard has no configured assistant profile assignments. Click to setup.',
      role: 'button'
    };
    this.item.show();
  }

  /**
   * Set status bar to error state.
   * @param message Optional error message
   */
  setError(message?: string): void {
    this.item.text = '$(error) AIdome: Error';
    this.item.tooltip = message ? `Error: ${message}\nClick for quick actions` : 'Verification failed\nClick for quick actions';
    this.item.color = new vscode.ThemeColor('statusBarItem.errorForeground');
    this.item.accessibilityInformation = {
      label: message ? `AIdome Switchboard error: ${message}` : 'AIdome Switchboard verification failed',
      role: 'button'
    };
    this.item.show();
  }

  /**
   * Set status bar to verifying state.
   */
  setVerifying(): void {
    this.item.text = '$(sync~spin) AIdome: Verifying...';
    this.item.tooltip = 'Verifying configuration...';
    this.item.color = undefined;
    this.item.accessibilityInformation = {
      label: 'AIdome Switchboard verifying configuration',
      role: 'status'
    };
    this.item.show();
  }

  /**
   * Dispose the status bar item.
   */
  dispose(): void {
    this.item.dispose();
  }
}

/**
 * Creates and initializes the status bar item.
 * @returns The status bar item
 */
export function createStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'aidome-switchboard.statusBarAction';
  }
  return statusBarItem;
}

/**
 * Updates the status bar with configured profile usage.
 * @param summaryOrProfileName The configured profile summary or a single profile name
 */
export function updateStatusBar(summaryOrProfileName?: string | StatusBarSummary): void {
  const item = createStatusBarItem();

  const summary = normalizeSummary(summaryOrProfileName);
  if (summary) {
    applyConfiguredState(item, summary);
  } else {
    item.text = '$(warning) AIdome: Not configured';
    item.tooltip = 'No assistant profile assignments\nClick for quick actions';
    item.color = new vscode.ThemeColor('statusBarItem.warningForeground');
    item.show();
  }
}

export function buildStatusBarSummary(
  profiles: EndpointProfile[],
  mappings: AssistantMapping[]
): StatusBarSummary | undefined {
  const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
  const uniqueProfileIds = [...new Set(mappings.map(mapping => mapping.profileId).filter(profileId => profilesById.has(profileId)))];

  if (uniqueProfileIds.length === 0) {
    return undefined;
  }

  return {
    configuredAssistantCount: mappings.filter(mapping => profilesById.has(mapping.profileId)).length,
    profilesInUse: uniqueProfileIds.map(profileId => ({
      id: profileId,
      name: profilesById.get(profileId)?.name || profileId
    }))
  };
}

function normalizeSummary(summaryOrProfileName?: string | StatusBarSummary): StatusBarSummary | undefined {
  if (!summaryOrProfileName) {
    return undefined;
  }

  if (typeof summaryOrProfileName === 'string') {
    return {
      configuredAssistantCount: 1,
      profilesInUse: [{ id: summaryOrProfileName, name: summaryOrProfileName }]
    };
  }

  return summaryOrProfileName.profilesInUse.length > 0 ? summaryOrProfileName : undefined;
}

function applyConfiguredState(item: vscode.StatusBarItem, summary: StatusBarSummary): void {
  const profileCount = summary.profilesInUse.length;
  const profileNames = summary.profilesInUse.map(profile => profile.name);
  const label = profileCount === 1 ? profileNames[0] : `${profileCount} profiles`;
  const tooltip = profileCount === 1
    ? `Profile in use: ${profileNames[0]}\nConfigured assistants: ${summary.configuredAssistantCount}\nClick for quick actions`
    : `Profiles in use: ${profileNames.join(', ')}\nConfigured assistants: ${summary.configuredAssistantCount}\nClick for quick actions`;

  item.text = `$(shield) AIdome: ${label}`;
  item.tooltip = tooltip;
  item.color = undefined;
  item.accessibilityInformation = {
    label: profileCount === 1
      ? `AIdome Switchboard configured with profile ${profileNames[0]} for ${summary.configuredAssistantCount} assistants`
      : `AIdome Switchboard configured with ${profileCount} profiles for ${summary.configuredAssistantCount} assistants`,
    role: 'button'
  };
  item.show();
}

/**
 * Hides the status bar item.
 */
export function hideStatusBar(): void {
  statusBarItem?.hide();
}

/**
 * Disposes the status bar item.
 */
export function disposeStatusBar(): void {
  statusBarItem?.dispose();
  statusBarItem = undefined;
}
