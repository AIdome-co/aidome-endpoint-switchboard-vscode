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
  | 'verify-endpoint'
  | 'show-guided-steps';

/**
 * Typed data shape for `show-guided-steps` plan steps.
 *
 * Adapters that emit this action SHOULD include a `steps` array so that
 * `applyGuidedSteps` can render a numbered list for the user.  When `steps`
 * is absent the applier falls back to displaying `message`.
 */
export interface GuidedStepsData {
  /** Short summary shown as a header, and as the fallback when `steps` is absent. */
  message: string;
  /** Ordered list of actionable instructions shown to the user. Provide this whenever possible. */
  steps?: string[];
  /** Optional configuration file path relevant to the guided step. */
  configPath?: string;
  /** The endpoint URL the user should paste into the setting. */
  baseUrl?: string;
  /** Adapter support tier (e.g. 'B', 'C'). */
  tier?: string;
  /** Auxiliary action hint for the applier (e.g. 'copy-to-clipboard'). */
  action?: string;
  /** Human-readable reason why full automation is not possible (e.g. 'no-base-url-override'). */
  limitation?: string;
  /** Environment variable name referenced in the guidance steps. */
  envVarName?: string;
  /** When true, this step is advisory only and may be skipped. */
  optional?: boolean;
  /** Describes how the assistant is configured (e.g. 'desktop-app-ui'). */
  configurationType?: string;
  /** Allow adapter-specific extension fields while remaining assignable to Record<string, unknown>. */
  [key: string]: unknown;
}

/**
 * Individual step in a configuration plan.
 */
export interface PlanStep {
  id: string;
  action: PlanStepAction;
  description: string;
  assistantKey: string;
  targetPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  requiresConfirmation?: boolean;
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

/**
 * Creates a new plan ID.
 */
export function generatePlanId(): string {
  return `plan-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Creates a new plan step ID.
 */
export function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

/**
 * Creates a new empty plan.
 */
export function createPlan(profileId: string, assistantKeys: string[]): Plan {
  return {
    id: generatePlanId(),
    profileId,
    assistantKeys,
    steps: [],
    createdAt: new Date().toISOString(),
    status: 'pending'
  };
}

/**
 * Adds a step to a plan.
 */
export function addStep(plan: Plan, step: Omit<PlanStep, 'id'>): Plan {
  return {
    ...plan,
    steps: [...plan.steps, { ...step, id: generateStepId() }]
  };
}
