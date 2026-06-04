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
      this.logger.error(`Error detecting ${this.getDisplayName()}`, error as Error);
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
      return {
        success: false,
        message: `Error verifying ${this.getDisplayName()} config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
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
