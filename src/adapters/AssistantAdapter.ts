/**
 * AssistantAdapter interface for assistant-specific configuration.
 */

import { Plan } from '../core/orchestration/planBuilder';
import { EndpointProfile } from '../core/profiles/profileTypes';

/**
 * Optional context available while building assistant plans.
 */
export interface AssistantBuildContext {
  authSecret?: string;
}

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
    * @param context Optional build context such as resolved secrets
   * @returns Promise resolving to the plan
   */
    buildPlan(profile: EndpointProfile, context?: AssistantBuildContext): Promise<Plan>;

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
