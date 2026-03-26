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
  error(message: string, error?: Error, ...args: unknown[]): void {
    this.parent.error(`[${this.scope}] ${message}`, error, ...args);
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

  error(message: string, error?: Error, ...args: unknown[]): void {
    if (this.logLevel <= LogLevel.Error) {
      this.log('ERROR', message, error, ...args);
    }
  }

  private log(level: string, message: string, ...args: unknown[]): void {
    const timestamp = new Date().toISOString();
    let formattedMessage = `[${timestamp}] [${level}] ${message}`;
    
    // Redact sensitive information from message
    formattedMessage = redactString(formattedMessage);
    
    let outputLine: string;
    if (args.length > 0) {
      const argsStr = JSON.stringify(args, null, 2);
      // Redact sensitive information from args
      const redactedArgs = redactString(argsStr);
      outputLine = `${formattedMessage} ${redactedArgs}`;
    } else {
      outputLine = formattedMessage;
    }

    this.outputChannel.appendLine(outputLine);

    // Append to ring buffer, evicting the oldest entry when full
    this.buffer.push({ timestamp, level, message: redactString(message) });
    if (this.buffer.length > LOG_BUFFER_MAX) {
      this.buffer.shift();
    }
  }

  show(): void {
    this.outputChannel.show();
  }
}
