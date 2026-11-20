/**
 * AssistantAdapter interface for assistant-specific configuration.
 */

import { Plan } from '../core/orchestration/planBuilder';
import { EndpointProfile } from '../core/profiles/profileTypes';

/**
 * Verification result from an assistant adapter.
 */
export interface VerificationResult {
  success: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Assistant adapter interface.
 * Each assistant implementation provides detection, planning, and configuration logic.
 */
export interface AssistantAdapter {
  /**
   * Detects if the assistant is installed and available.
   * @returns Promise resolving to true if detected
   */
  detect(): Promise<boolean>;

  /**
   * Builds a configuration plan for this assistant.
   * @param profile The endpoint profile to configure
   * @returns Promise resolving to the plan
   */
  buildPlan(profile: EndpointProfile): Promise<Plan>;

  /**
   * Applies configuration changes for this assistant.
   * @param plan The plan to apply
   * @returns Promise resolving when complete
   */
  apply(plan: Plan): Promise<void>;

  /**
   * Verifies the assistant configuration.
   * @returns Promise resolving to verification result
   */
  verify(): Promise<VerificationResult>;

  /**
   * Gets the display name of the assistant.
   * @returns Display name
   */
  getDisplayName(): string;

  /**
   * Gets the support tier (A/B/C).
   * @returns Support tier
   */
  getTier(): 'A' | 'B' | 'C';

  /**
   * Optionally declares VS Code extension IDs whose running instance can
   * clobber file-backed configuration written at apply time (the extension
   * snapshots its config files in memory and persists them back wholesale).
   * The orchestrator offers a window reload after a successful apply so the
   * assistant re-reads the applied state from disk. Adapters whose
   * configuration is not cached in memory by a live extension omit this.
   * @returns Extension IDs needing a reload after apply
   */
  getReloadExtensionIds?(): string[];
}
