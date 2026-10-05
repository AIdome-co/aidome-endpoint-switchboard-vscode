/**
 * Per-assistant configuration outcome model.
 *
 * Separates "the plan executed" from "the assistant is configured":
 * a plan whose only meaningful step is guidance display executes
 * successfully, but the assistant is NOT configured until a real automatic
 * configuration mutation completed (and required guidance is absent).
 */

import type { PlanStepAction } from './planBuilder';

/** Truthful final configuration status for one assistant after an apply. */
export type AssistantApplyStatus =
  | 'configured'
  | 'guided-required'
  | 'unsupported'
  | 'deferred'
  | 'failed';

/** Per-assistant outcome. `success` is a compatibility field: true ONLY when status is 'configured'. */
export interface AssistantApplyResult {
  status: AssistantApplyStatus;
  success: boolean;
  reason?: string;
}

/** Actions that actually mutate assistant configuration automatically. */
export const CONFIGURATION_MUTATION_ACTIONS: ReadonlySet<PlanStepAction> = new Set<PlanStepAction>([
  'set-vscode-setting',
  'edit-config-file',
  'write-env-file'
]);

/** Purely informational/verification actions — never configuration by themselves. */
export const NON_MUTATION_ACTIONS: ReadonlySet<PlanStepAction> = new Set<PlanStepAction>([
  'show-guided-steps',
  'verify-endpoint',
  'backup-file',
  // set-env-var only displays a manual export instruction (parent-process
  // environments cannot be mutated from the extension), so it does NOT
  // configure anything by running.
  'set-env-var'
]);

/** True when the step performs a real automatic configuration mutation. */
export function isConfigurationMutationAction(action: PlanStepAction): boolean {
  return CONFIGURATION_MUTATION_ACTIONS.has(action);
}

/** Builds the compatibility result shape from a status. */
export function assistantResult(status: AssistantApplyStatus, reason?: string): AssistantApplyResult {
  return {
    status,
    success: status === 'configured',
    ...(reason !== undefined ? { reason } : {})
  };
}

/** Configured-assistant count over an outcome map. */
export function countConfiguredAssistants(
  results: Map<string, AssistantApplyResult>
): number {
  return [...results.values()].filter(r => r.status === 'configured').length;
}
