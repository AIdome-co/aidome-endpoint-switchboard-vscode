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
export interface AssistantStorageWriteResult {
  /** Absolute path of the backup created by the writer (if any). */
  backupPath?: string;
  /** Absolute path of the primary mutated target, for rollback. */
  target?: string;
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
