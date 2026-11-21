/**
 * Registry for assistant-specific storage writers used by the generic
 * `write-assistant-storage` plan action.
 *
 * Core must not import provider adapter modules (dependency-direction rule):
 * an adapter registers its storage writer here at module load, and the
 * PlanApplier dispatches generically by assistant key.
 */

import type { PlanStep } from './planBuilder';

/** Files the writer touched that rollback must restore (binary-safe). */
export interface AssistantStorageRollbackTarget {
  /** Absolute path of the additional mutated target. */
  target: string;
  /** Backup of that target before the write (absent when newly created). */
  backupPath?: string;
  /** True when the target did not exist before the write (rollback deletes it). */
  createdFile?: boolean;
}

export interface AssistantStorageWriteResult {
  /** Absolute path of the backup created by the writer (if any). */
  backupPath?: string;
  /** Absolute path of the primary mutated target, for rollback. */
  target?: string;
  /** True when the primary target did not exist before the write (rollback deletes it). */
  createdFile?: boolean;
  /** Additional mutated targets (e.g. settings.json) restored after the primary on rollback. */
  extraRollbacks?: AssistantStorageRollbackTarget[];
  /**
   * True when the writer confirmed it had nothing to write (e.g. a
   * credential-less profile whose managed credential entry is already
   * absent) — the step is a no-op, NOT a mutation, and the outcome must be
   * classified with the missing-secret rules (GAP 9).
   */
  noOp?: boolean;
  /**
   * True when the assistant cannot function without a credential, so a
   * missing secret must classify the outcome as guided-required (GAP 9).
   * Writers whose vendor contract makes an unauthenticated configuration
   * valid (CodeGPT's key-less local connection) leave this unset — a
   * missing secret is then NOT an authentication gap.
   */
  authRequired?: boolean;
}

export type AssistantStorageWriter = (
  step: PlanStep,
  /** API key resolved by the applier from SecretStorage via the profile authRef. */
  apiKey?: string
) => Promise<AssistantStorageWriteResult>;

const writers = new Map<string, AssistantStorageWriter>();

/** Register the storage writer for an assistant key. Adapter layer only. */
export function registerAssistantStorageWriter(
  assistantKey: string,
  writer: AssistantStorageWriter
): void {
  writers.set(assistantKey, writer);
}

/** Look up the registered storage writer for an assistant key. */
export function getAssistantStorageWriter(
  assistantKey: string
): AssistantStorageWriter | undefined {
  return writers.get(assistantKey);
}
