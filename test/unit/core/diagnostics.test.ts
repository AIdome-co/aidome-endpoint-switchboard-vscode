/**
 * Unit tests for generateDiagnostics and formatAsMarkdown in diagnostics.ts.
 * Covers: recentLogs in report, "Recent Logs" section in markdown output.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock vscode before any imports that depend on it
vi.mock('vscode', () => ({
  version: '1.85.0',
  extensions: {
    all: [],
    getExtension: vi.fn().mockReturnValue(undefined),
    onDidChange: vi.fn().mockReturnValue({ dispose: vi.fn() })
  },
  window: {
    showWarningMessage: vi.fn().mockResolvedValue('OK')
  }
}));

// Mock Logger so detectExtensions doesn't fail in unit context
vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: vi.fn().mockReturnValue({
      info: vi.fn(),
      debug: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      scoped: vi.fn().mockReturnValue({
        info: vi.fn(),
        debug: vi.fn(),
        warning: vi.fn(),
        error: vi.fn()
      }),
      getBuffer: vi.fn().mockReturnValue([])
    })
  },
  LogLevel: { Debug: 0, Info: 1, Warning: 2, Error: 3 }
}));

import { generateDiagnostics, formatAsMarkdown, DiagnosticsReport } from '../../../src/core/orchestration/diagnostics';
import { LogEntry } from '../../../src/util/log';

// Minimal mock for vscode.ExtensionContext
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
  extension = { packageJSON: { version: '1.2.3' } } as any;
  languageModelAccessInformation = {} as any;
}

function makeSampleLogs(count: number): LogEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: `2024-01-01T00:00:00.00${i}Z`,
    level: i % 2 === 0 ? 'INFO' : 'WARNING',
    message: `log message ${i}`
  }));
}

describe('generateDiagnostics — recentLogs', () => {
  let context: MockExtensionContext;

  beforeEach(() => {
    context = new MockExtensionContext();
  });

  it('includes recentLogs in the returned report when provided', async () => {
    const logs = makeSampleLogs(3);
    const report = await generateDiagnostics(context as any, { recentLogs: logs });

    expect(report.recentLogs).toHaveLength(3);
    expect(report.recentLogs[0]).toEqual(logs[0]);
    expect(report.recentLogs[2]).toEqual(logs[2]);
  });

  it('returns an empty recentLogs array when no logs are provided', async () => {
    const report = await generateDiagnostics(context as any, {});
    expect(report.recentLogs).toEqual([]);
  });

  it('returns a copy of the provided logs (not the same reference)', async () => {
    const logs = makeSampleLogs(2);
    const report = await generateDiagnostics(context as any, { recentLogs: logs });

    // Mutating the original array should not affect the report
    logs.push({ timestamp: 'x', level: 'DEBUG', message: 'injected' });
    expect(report.recentLogs).toHaveLength(2);
  });
});

describe('formatAsMarkdown — Recent Logs section', () => {
  let context: MockExtensionContext;
  let baseReport: DiagnosticsReport;

  beforeEach(async () => {
    context = new MockExtensionContext();
    baseReport = await generateDiagnostics(context as any, {});
  });

  it('renders a "Recent Logs" section when recentLogs has entries', () => {
    const report: DiagnosticsReport = {
      ...baseReport,
      recentLogs: [
        { timestamp: '2024-01-01T00:00:00.000Z', level: 'INFO', message: 'server started' },
        { timestamp: '2024-01-01T00:00:01.000Z', level: 'WARNING', message: 'slow response' }
      ]
    };

    const markdown = formatAsMarkdown(report);

    expect(markdown).toContain('## Recent Logs');
    expect(markdown).toContain('[INFO] server started');
    expect(markdown).toContain('[WARNING] slow response');
  });

  it('omits the "Recent Logs" section when recentLogs is empty', () => {
    const report: DiagnosticsReport = {
      ...baseReport,
      recentLogs: []
    };

    const markdown = formatAsMarkdown(report);

    expect(markdown).not.toContain('## Recent Logs');
  });

  it('renders at most 50 log entries in the section', async () => {
    const logs = makeSampleLogs(60);
    const report: DiagnosticsReport = {
      ...baseReport,
      recentLogs: logs
    };

    const markdown = formatAsMarkdown(report);

    // Only the last 50 entries should appear (indices 10-59)
    expect(markdown).toContain('[INFO] log message 10');
    expect(markdown).toContain('[WARNING] log message 59');
    // Entry 9 is not among the last 50 (which start at index 10)
    expect(markdown).not.toContain('[WARNING] log message 9');
  });
});
