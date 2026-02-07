/**
 * Logging utilities for the extension.
 */

import * as vscode from 'vscode';

/**
 * Log level enumeration.
 */
export enum LogLevel {
  Debug = 0,
  Info = 1,
  Warning = 2,
  Error = 3
}

/**
 * Logger class for extension logging.
 */
export class Logger {
  private static instance: Logger;
  private outputChannel: vscode.OutputChannel;
  private logLevel: LogLevel = LogLevel.Info;

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
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;
    
    if (args.length > 0) {
      this.outputChannel.appendLine(`${formattedMessage} ${JSON.stringify(args)}`);
    } else {
      this.outputChannel.appendLine(formattedMessage);
    }
  }

  show(): void {
    this.outputChannel.show();
  }
}
