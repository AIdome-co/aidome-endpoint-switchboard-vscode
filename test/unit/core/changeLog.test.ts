/**
 * Unit tests for ChangeLog.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChangeLog, ChangeLogEntry, AppliedStep } from '../../../src/core/orchestration/changeLog';

// Mock VS Code extension context
class MockExtensionContext {
  private storage = new Map<string, unknown>();

  globalState = {
    get: <T>(key: string, defaultValue?: T): T => {
      return (this.storage.get(key) as T) ?? (defaultValue as T);
    },
    update: async (key: string, value: unknown): Promise<void> => {
      this.storage.set(key, value);
    }
  };

  workspaceState = this.globalState;
  subscriptions: unknown[] = [];
  extensionPath = '';
  storagePath = '';
  globalStoragePath = '';
  logPath = '';
  extensionUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  environmentVariableCollection = {} as any;
  extensionMode = 1;
  storageUri = undefined;
  globalStorageUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  logUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  secrets = {} as any;
  extension = {} as any;
  languageModelAccessInformation = {} as any;
}

describe('ChangeLog', () => {
  let changeLog: ChangeLog;
  let context: MockExtensionContext;

  beforeEach(() => {
    context = new MockExtensionContext();
    changeLog = new ChangeLog(context as any);
  });

  it('should start with no entries', async () => {
    const entries = await changeLog.getEntries();
    expect(entries).toEqual([]);
  });

  it('should record a new entry', async () => {
    const entry: ChangeLogEntry = {
      id: 'plan-123',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'aidome-dev',
      steps: [
        {
          type: 'set-vscode-setting',
          target: 'continue.baseUrl',
          oldValue: undefined,
          newValue: 'https://api.aidome.cloud',
          timestamp: new Date().toISOString()
        }
      ]
    };

    await changeLog.recordApply(entry);
    const entries = await changeLog.getEntries();
    
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(entry);
  });

  it('should retrieve entries for a specific assistant', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'profile2',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);

    const continueEntries = await changeLog.getEntriesForAssistant('continue');
    expect(continueEntries).toHaveLength(1);
    expect(continueEntries[0].assistantKey).toBe('continue');
  });

  it('should retrieve entries for a specific profile', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'aidome-prod',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'aidome-dev',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);

    const prodEntries = await changeLog.getEntriesForProfile('aidome-prod');
    expect(prodEntries).toHaveLength(1);
    expect(prodEntries[0].profileName).toBe('aidome-prod');
  });

  it('should remove a specific entry', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'profile2',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);
    await changeLog.removeEntry('plan-1');

    const entries = await changeLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('plan-2');
  });

  it('should remove all entries for an assistant', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile2',
      steps: []
    };

    const entry3: ChangeLogEntry = {
      id: 'plan-3',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'profile3',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);
    await changeLog.recordApply(entry3);
    await changeLog.removeEntriesForAssistant('continue');

    const entries = await changeLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].assistantKey).toBe('cline');
  });

  it('should remove all entries for a profile', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'aidome-dev',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'aidome-dev',
      steps: []
    };

    const entry3: ChangeLogEntry = {
      id: 'plan-3',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'aidome-prod',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);
    await changeLog.recordApply(entry3);
    await changeLog.removeEntriesForProfile('aidome-dev');

    const entries = await changeLog.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].profileName).toBe('aidome-prod');
  });

  it('should clear all entries', async () => {
    const entry1: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: []
    };

    const entry2: ChangeLogEntry = {
      id: 'plan-2',
      timestamp: new Date().toISOString(),
      assistantKey: 'cline',
      profileName: 'profile2',
      steps: []
    };

    await changeLog.recordApply(entry1);
    await changeLog.recordApply(entry2);
    await changeLog.clearAll();

    const entries = await changeLog.getEntries();
    expect(entries).toEqual([]);
  });

  it('should generate entry summary', () => {
    const entry: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: [
        {
          type: 'set-vscode-setting',
          target: 'continue.baseUrl',
          oldValue: undefined,
          newValue: 'https://api.aidome.cloud',
          timestamp: new Date().toISOString()
        },
        {
          type: 'edit-config-file',
          target: '/path/to/config.json',
          oldValue: '{}',
          newValue: '{"key": "value"}',
          timestamp: new Date().toISOString()
        }
      ]
    };

    const summary = changeLog.getEntrySummary(entry);
    expect(summary).toContain('2 changes');
    expect(summary).toContain('set-vscode-setting');
    expect(summary).toContain('edit-config-file');
  });

  it('should handle duplicate step types in summary', () => {
    const entry: ChangeLogEntry = {
      id: 'plan-1',
      timestamp: new Date().toISOString(),
      assistantKey: 'continue',
      profileName: 'profile1',
      steps: [
        {
          type: 'set-vscode-setting',
          target: 'setting1',
          oldValue: undefined,
          newValue: 'value1',
          timestamp: new Date().toISOString()
        },
        {
          type: 'set-vscode-setting',
          target: 'setting2',
          oldValue: undefined,
          newValue: 'value2',
          timestamp: new Date().toISOString()
        }
      ]
    };

    const summary = changeLog.getEntrySummary(entry);
    expect(summary).toContain('2 changes');
    expect(summary).toContain('set-vscode-setting');
    // Should only mention the type once
    expect(summary.match(/set-vscode-setting/g)?.length).toBe(1);
  });
});
