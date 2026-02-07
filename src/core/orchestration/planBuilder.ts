/**
 * Type definitions for configuration plans and plan steps.
 */

/**
 * Plan step action type.
 */
export type PlanStepAction = 
  | 'set-vscode-setting'
  | 'edit-config-file'
  | 'set-env-var'
  | 'backup-file'
  | 'verify-endpoint';

/**
 * Individual step in a configuration plan.
 */
export interface PlanStep {
  id: string;
  action: PlanStepAction;
  description: string;
  assistantKey: string;
  data: Record<string, unknown>;
  reversible: boolean;
  completed?: boolean;
  error?: string;
}

/**
 * Complete configuration plan for applying endpoint changes.
 */
export interface Plan {
  id: string;
  profileId: string;
  assistantKeys: string[];
  steps: PlanStep[];
  createdAt: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed' | 'rolled-back';
}
