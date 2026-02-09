/**
 * Wizard flow controller for setup process.
 */

import { detectRemote, RemoteContext } from '../../core/detection/detectRemote';
import { showRemoteBanner } from '../remoteBanner';

/**
 * Wizard state management.
 */
export interface WizardState {
  currentStep: number;
  totalSteps: number;
  data: Record<string, unknown>;
  completed: boolean;
  remoteContext?: RemoteContext;
}

/**
 * Runs the setup wizard flow.
 * @returns Promise resolving when wizard completes
 */
export async function runSetupWizard(): Promise<void> {
  // Detect remote context and show banner
  const remoteContext = detectRemote();
  showRemoteBanner(remoteContext);
  
  // Skeleton implementation
  throw new Error('Not implemented');
}

/**
 * Advances to the next wizard step.
 * @param state Current wizard state
 * @returns Updated wizard state
 */
export function nextStep(state: WizardState): WizardState {
  return {
    ...state,
    currentStep: Math.min(state.currentStep + 1, state.totalSteps)
  };
}

/**
 * Goes back to previous wizard step.
 * @param state Current wizard state
 * @returns Updated wizard state
 */
export function previousStep(state: WizardState): WizardState {
  return {
    ...state,
    currentStep: Math.max(state.currentStep - 1, 0)
  };
}
