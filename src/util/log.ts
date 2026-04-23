/**
 * Logging utilities for the extension.
 */

import * as vscode from 'vscode';
import { redactString } from './redact';
import { getRuntimeSettings } from '../config/runtimeSettings';

/**
 * Log level enumeration.
 */
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warning = 2,
  Error = 3
}

/** A single buffered log entry retained for diagnostics export. */
export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  /** Optional structured context attached to the entry (redacted before storage). */
  context?: Record<string, unknown>;
  /** Optional operation ID linking this entry to a specific lifecycle span. */
  operationId?: string;
}

/**
 * A scoped logger that prepends `[scope]` to every log message.
 * Optionally binds an `operationId` so all entries can be linked across
 * a single lifecycle span (e.g., one wizard run or one plan-apply cycle).
 * Obtain one via {@link Logger.scoped} or {@link Logger.withOperationId}.
 */
export class ScopedLogger {
  constructor(
    private readonly parent: Logger,
    private readonly scope: string,
    /** Optional operation ID added to every structured log entry. */
    public readonly operationId?: string
  ) {}

  /** @see Logger.debug */
  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(`[${this.scope}] ${message}`, ...this.prependContext(args));
  }

  /** @see Logger.info */
  info(message: string, ...args: unknown[]): void {
    this.parent.info(`[${this.scope}] ${message}`, ...this.prependContext(args));
  }

  /** @see Logger.warning */
  warning(message: string, ...args: unknown[]): void {
    this.parent.warning(`[${this.scope}] ${message}`, ...this.prependContext(args));
  }

  /** @see Logger.error */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.parent.error(
      `[${this.scope}] ${message}`,
      error,
      this.mergeContext(context)
    );
  }

  /**
   * Merges the operation ID into a context object (if present).
   * Returns `undefined` when there is no operation ID and no context.
   */
  private mergeContext(
    ctx?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!this.operationId) {
      return ctx;
    }
    return { operationId: this.operationId, ...ctx };
  }

  /**
   * Injects the operationId into the trailing context argument expected by
   * Logger.debug / info / warning (the last plain-object arg).
   */
  private prependContext(args: unknown[]): unknown[] {
    if (!this.operationId) {
      return args;
    }
    // Find an existing trailing context object, if any
    const lastIdx = args.length - 1;
    const last = args[lastIdx];
    if (
      lastIdx >= 0 &&
      last !== null &&
      typeof last === 'object' &&
      !(last instanceof Error)
    ) {
      const merged = { operationId: this.operationId, ...(last as Record<string, unknown>) };
      return [...args.slice(0, lastIdx), merged];
    }
    return [...args, { operationId: this.operationId }];
  }
}

/**
 * Logger class for extension logging.
 */
export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.Info;
  private buffer: LogEntry[] = [];
  private readonly bufferMax: number;

  private constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.bufferMax = getRuntimeSettings().logBufferSize;
  }

  static initialize(outputChannel: vscode.OutputChannel): void {
    Logger.instance = new Logger(outputChannel);
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      throw new Error('Logger not initialized');
    }
    return Logger.instance;
  }

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  /**
   * Creates a {@link ScopedLogger} that prefixes every message with `[scope]`.
   * Useful for subsystems (e.g., `logger.scoped('Detection')`).
   */
  scoped(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope);
  }

  /**
   * Creates a {@link ScopedLogger} bound to both a `scope` prefix and an
   * `operationId`. Every log entry produced by the returned logger will include
   * `{ operationId }` in its structured context, making it possible to filter
   * the ring buffer for a single wizard run or plan-apply cycle.
   *
   * @param scope       Prefix added to every message (e.g. `'Setup'`).
   * @param operationId Unique identifier for the current lifecycle span.
   *
   * @example
   * ```typescript
   * const opId = `setup-${Date.now()}`;
   * const log = logger.withOperationId('Setup', opId);
   * log.info('Step 1: detection started');  // includes { operationId }
   * ```
   */
  withOperationId(scope: string, operationId: string): ScopedLogger {
    return new ScopedLogger(this, scope, operationId);
  }

  /**
   * Returns a copy of the recent log ring buffer (up to the configured
   * maximum number of entries, oldest first). Use for diagnostics export.
   */
  getBuffer(): readonly LogEntry[] {
    return this.buffer.slice();
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.logLevel <= LogLevel.Debug) {
      this.log('DEBUG', message, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.logLevel <= LogLevel.Info) {
      this.log('INFO', message, ...args);
    }
  }

  warning(message: string, ...args: unknown[]): void {
    if (this.logLevel <= LogLevel.Warning) {
      this.log('WARNING', message, ...args);
    }
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    if (this.logLevel <= LogLevel.Error) {
      this.log('ERROR', message, error, context);
    }
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;
    
    // Redact sensitive information from message
    formattedMessage = redactString(formattedMessage);
    
    // Separate context object (last arg that is a plain object and not an Error)
    let context: Record<string, unknown> | undefined;
    const filteredArgs = args.filter(a => {
      if (a !== null && typeof a === 'object' && !(a instanceof Error) && !context) {
        context = a as Record<string, unknown>;
        return false;
      }
      return true;
    });

    let outputLine: string;
    if (filteredArgs.length > 0 || context) {
      const parts: string[] = [formattedMessage];
      if (filteredArgs.length > 0) {
        parts.push(redactString(JSON.stringify(filteredArgs, null, 2)));
      }
      if (context) {
        parts.push(redactString(JSON.stringify(context)));
      }
      outputLine = parts.join(' ');
    } else {
      outputLine = formattedMessage;
    }

    this.outputChannel.appendLine(outputLine);

    // Append to ring buffer, evicting the oldest entry when full.
    // Redact the context before storing so secrets never sit in memory.
    const entry: LogEntry = { timestamp, level, message: redactString(message) };
    if (context) {
      const redactedCtx = JSON.parse(redactString(JSON.stringify(context))) as Record<string, unknown>;
      entry.context = redactedCtx;
      // Promote operationId to a top-level field for easier filtering
      if (typeof redactedCtx['operationId'] === 'string') {
        entry.operationId = redactedCtx['operationId'];
      }
    }
    this.buffer.push(entry);
    if (this.buffer.length > this.bufferMax) {
      this.buffer.shift();
    }
  }

  /**
   * Returns a formatted plain-text summary of the last `maxEntries` log entries
   * (or all entries if `maxEntries` is omitted), suitable for attaching to
   * diagnostics exports or bug reports.
   *
   * @param maxEntries - Maximum number of entries to include (default: all).
   */
  dumpBuffer(maxEntries?: number): string {
    const entries = maxEntries !== undefined
      ? this.buffer.slice(-maxEntries)
      : this.buffer.slice();
    if (entries.length === 0) {
      return '(no log entries)';
    }
    const lines = entries.map(e => {
      const ctx = e.context ? ` ${JSON.stringify(e.context)}` : '';
      const opId = e.operationId ? ` [op:${e.operationId}]` : '';
      return `[${e.timestamp}] [${e.level}]${opId} ${e.message}${ctx}`;
    });
    return lines.join('\n');
  }

  show(): void {
    this.outputChannel.show();
  }
}
