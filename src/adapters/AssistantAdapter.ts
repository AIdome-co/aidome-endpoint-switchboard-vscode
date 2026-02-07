/**
 * AssistantAdapter interface for assistant-specific configuration.
 */

import { Plan } from '../core/orchestration/planBuilder';

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
   * @param endpointUrl The endpoint URL to configure
   * @param apiKey Optional API key
   * @returns Promise resolving to the plan
   */
  buildPlan(endpointUrl: string, apiKey?: string): Promise<Plan>;

  /**
   * Applies configuration changes for this assistant.
   * @param plan The plan to apply
   * @returns Promise resolving when complete
   */
  apply(plan: Plan): Promise<void>;

  /**
   * Verifies the assistant configuration.
   * @returns Promise resolving to true if verified
   */
  verify(): Promise<boolean>;

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
