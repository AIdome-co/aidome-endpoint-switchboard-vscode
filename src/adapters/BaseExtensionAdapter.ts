/**
 * Base adapter for VS Code extension-based assistants.
 *
 * Centralizes the common detect / apply / verify error-handling / logger
 * boilerplate shared by most adapters.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from './AssistantAdapter';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { Plan } from '../core/orchestration/planBuilder';
import { Logger } from '../util/log';

export interface FormattedThrowable {
  message: string;
  context: Record<string, unknown>;
  error?: Error;
}

function stringifyUnknownThrowable(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Converts any caught throwable into a safe message and logger context.
 *
 * JavaScript can throw arbitrary values, including strings, null, undefined,
 * symbols, and objects with circular references. Keep Error instances as Error
 * objects for logger stack handling, but never expose an undefined message.
 */
export function formatThrowable(error: unknown): FormattedThrowable {
  if (error instanceof Error) {
    const message = error.message || error.name || 'Unknown Error';
    return {
      message,
      error,
      context: {
        error: message,
        errorDetails: {
          name: error.name,
          message,
          stack: error.stack
        }
      }
    };
  }

  const serialized = stringifyUnknownThrowable(error);
  const message = serialized === undefined || serialized === '' ? String(error) : serialized;
  return {
    message: message || 'Unknown non-Error throwable',
    context: {
      error: message || 'Unknown non-Error throwable'
    }
  };
}

/**
 * Formats an unknown throwable into a guaranteed-serializable string.
 * Preserves Error name/message; falls back to String() for non-Error values.
 */
export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

/**
 * Abstract base class for adapters that detect presence via a VS Code extension ID.
 *
 * Subclasses must implement:
 *  - `extensionId` (or override `detect` for multi-extension / CLI detection)
 *  - `buildPlan`
 *  - `verifyConfiguration`
 *  - `getDisplayName`
 *  - `getTier`
 */
export abstract class BaseExtensionAdapter implements AssistantAdapter {
  protected readonly logger = Logger.getInstance();

  /**
   * The VS Code extension marketplace ID used for detection.
   * Override `detect()` directly if detection involves multiple extension IDs
   * or CLI detection.
   */
  protected abstract readonly extensionId: string;

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension(this.extensionId);
      return extension !== undefined;
    } catch (error) {
      const formatted = formatThrowable(error);
      this.logger.error(
        `Error detecting ${this.getDisplayName()}: ${formatted.message}`,
        formatted.error,
        formatted.context
      );
      return false;
    }
  }

  abstract buildPlan(profile: EndpointProfile): Promise<Plan>;

  /**
   * Default no-op apply — the PlanApplier handles actual execution.
   * Override only when the adapter needs to perform custom application logic.
   */
  async apply(_plan: Plan): Promise<void> {
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      return await this.verifyConfiguration();
    } catch (error) {
      const formatted = formatThrowable(error);
      return {
        success: false,
        message: `Error verifying ${this.getDisplayName()} config: ${formatted.message}`,
        details: formatted.context
      };
    }
  }

  /**
   * Implement verification logic without the try/catch boilerplate.
   * Thrown errors are caught by `verify()` and wrapped into a failed result.
   */
  protected abstract verifyConfiguration(): Promise<VerificationResult>;

  abstract getDisplayName(): string;
  abstract getTier(): 'A' | 'B' | 'C';
}
