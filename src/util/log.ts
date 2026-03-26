/**
 * Logging utilities for the extension.
 */

import * as vscode from 'vscode';
import { redactString } from './redact';

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
}

/** Maximum number of log entries kept in the in-memory ring buffer. */
const LOG_BUFFER_MAX = 200;

/**
 * A scoped logger that prepends `[scope]` to every log message.
 * Obtain one via {@link Logger.scoped}.
 */
export class ScopedLogger {
  constructor(
    private readonly parent: Logger,
    private readonly scope: string
  ) {}

  /** @see Logger.debug */
  debug(message: string, ...args: unknown[]): void {
    this.parent.debug(`[${this.scope}] ${message}`, ...args);
  }

  /** @see Logger.info */
  info(message: string, ...args: unknown[]): void {
    this.parent.info(`[${this.scope}] ${message}`, ...args);
  }

  /** @see Logger.warning */
  warning(message: string, ...args: unknown[]): void {
    this.parent.warning(`[${this.scope}] ${message}`, ...args);
  }

  /** @see Logger.error */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.parent.error(`[${this.scope}] ${message}`, error, context);
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

  private constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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
   * Returns a copy of the recent log ring buffer (up to {@link LOG_BUFFER_MAX}
   * entries, oldest first). Use for diagnostics export.
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
      entry.context = JSON.parse(redactString(JSON.stringify(context))) as Record<string, unknown>;
    }
    this.buffer.push(entry);
    if (this.buffer.length > LOG_BUFFER_MAX) {
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
      return `[${e.timestamp}] [${e.level}] ${e.message}${ctx}`;
    });
    return lines.join('\n');
  }

  show(): void {
    this.outputChannel.show();
  }
}
