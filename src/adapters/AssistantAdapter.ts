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
}
