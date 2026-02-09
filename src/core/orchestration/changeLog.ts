/**
 * Change log tracking for configuration changes.
 * Records all applied changes for undo/rollback functionality.
 */

import * as vscode from 'vscode';
import { PlanStepAction } from './planBuilder';

/**
 * A single applied step recorded in the change log.
 */
export interface AppliedStep {
  type: PlanStepAction;
  target: string;          // setting key or file path
  oldValue: unknown;
  newValue: unknown;
  backupPath?: string;     // for file-based changes
  timestamp: string;
}

/**
 * A complete change log entry for a profile application.
 */
export interface ChangeLogEntry {
  id: string;
  timestamp: string;
  assistantKey: string;
  profileName: string;
  steps: AppliedStep[];
}

const CHANGE_LOG_KEY = 'aidome.changeLog';

/**
 * Manages change log for tracking and undoing configuration changes.
 */
export class ChangeLog {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Records a completed plan application.
   * @param entry The change log entry to record
   */
  async recordApply(entry: ChangeLogEntry): Promise<void> {
    const entries = await this.getEntries();
    entries.push(entry);
    await this.context.globalState.update(CHANGE_LOG_KEY, entries);
  }

  /**
   * Gets all change log entries.
   * @returns Promise resolving to array of entries
   */
  async getEntries(): Promise<ChangeLogEntry[]> {
    return this.context.globalState.get<ChangeLogEntry[]>(CHANGE_LOG_KEY, []);
  }

  /**
   * Gets entries for a specific assistant.
   * @param assistantKey The assistant key
   * @returns Promise resolving to array of entries
   */
  async getEntriesForAssistant(assistantKey: string): Promise<ChangeLogEntry[]> {
    const entries = await this.getEntries();
    return entries.filter(e => e.assistantKey === assistantKey);
  }

  /**
   * Gets entries for a specific profile.
   * @param profileName The profile name
   * @returns Promise resolving to array of entries
   */
  async getEntriesForProfile(profileName: string): Promise<ChangeLogEntry[]> {
    const entries = await this.getEntries();
    return entries.filter(e => e.profileName === profileName);
  }

  /**
   * Removes an entry from the change log.
   * @param entryId The entry ID to remove
   */
  async removeEntry(entryId: string): Promise<void> {
    const entries = await this.getEntries();
    const filtered = entries.filter(e => e.id !== entryId);
    await this.context.globalState.update(CHANGE_LOG_KEY, filtered);
  }

  /**
   * Removes all entries for a specific assistant.
   * @param assistantKey The assistant key
   */
  async removeEntriesForAssistant(assistantKey: string): Promise<void> {
    const entries = await this.getEntries();
    const filtered = entries.filter(e => e.assistantKey !== assistantKey);
    await this.context.globalState.update(CHANGE_LOG_KEY, filtered);
  }

  /**
   * Removes all entries for a specific profile.
   * @param profileName The profile name
   */
  async removeEntriesForProfile(profileName: string): Promise<void> {
    const entries = await this.getEntries();
    const filtered = entries.filter(e => e.profileName !== profileName);
    await this.context.globalState.update(CHANGE_LOG_KEY, filtered);
  }

  /**
   * Clears all change log entries.
   */
  async clearAll(): Promise<void> {
    await this.context.globalState.update(CHANGE_LOG_KEY, undefined);
  }

  /**
   * Gets a summary of changes for display.
   * @param entry The change log entry
   * @returns Human-readable summary string
   */
  getEntrySummary(entry: ChangeLogEntry): string {
    const stepTypes = entry.steps.map(s => s.type);
    const uniqueTypes = [...new Set(stepTypes)];
    return `${entry.steps.length} changes (${uniqueTypes.join(', ')})`;
  }
}
