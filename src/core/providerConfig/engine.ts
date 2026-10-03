/**
 * ProviderConfigEngine — descriptor compiler.
 *
 * Compiles a ProviderConfigDescriptor's declarative `plan` operations into
 * generic plan steps. The engine is provider-agnostic: it never branches on
 * provider keys. Provider-specific behavior is expressed either declaratively
 * in the descriptor (operations, stepData) or supplied by the calling adapter
 * as a narrow hook (resolved target paths, model discovery, target
 * availability, step data extras).
 *
 * Safety contracts enforced here:
 * - Plans carry NO resolved secret values (symbolic references only).
 * - File-backed edits rely on the PlanApplier's automatic backup +
 *   atomic write + rollback; the engine emits `backupRequired` metadata
 *   instead of duplicate explicit backup steps.
 * - Guided/unsupported targets emit guidance steps, never mutations.
 */

import { EndpointProfile } from '../profiles/profileTypes';
import { Plan, createPlan, addStep, PlanStep } from '../orchestration/planBuilder';
import {
  DescriptorOperation,
  DescriptorValueSource,
  ProviderConfigDescriptor,
  TargetPlan,
} from './types';
import { normalizeOpenAiBaseUrl } from './endpointUrl';

/** Runtime inputs the adapter resolves for the engine. */
export interface ProviderConfigEngineContext {
  profile: EndpointProfile;
  /** Resolved target file paths or setting keys, keyed by target id (adapter hook). */
  resolvedTargetPaths?: Record<string, string>;
  /** Model ids discovered from the gateway (never secrets). */
  discoveredModels?: string[];
  /** Adapter-declared availability per target id; false/undefined 'guided' → guided step (hook). */
  targetAvailability?: Record<string, boolean>;
  /** Overrides evaluated per operation value source when the adapter owns resolution (hook). */
  valueOverrides?: Partial<Record<DescriptorValueSource['type'], unknown>>;
}

/** Result of compiling one descriptor into a plan. */
export interface EnginePlanResult {
  plan: Plan;
  /** Targets that were compiled as automatic mutation steps. */
  automaticTargetIds: string[];
  /** Targets that produced guidance instead of mutation. */
  guidedTargetIds: string[];
}

/** Compiles a descriptor's declarative plan into a provider plan. */
export function buildProviderConfigPlan(
  descriptor: ProviderConfigDescriptor,
  context: ProviderConfigEngineContext
): EnginePlanResult {
  let plan = createPlan(context.profile.id, [descriptor.providerKey]);
  const automaticTargetIds: string[] = [];
  const guidedTargetIds: string[] = [];

  // Normalize the request base URL only when the descriptor's plan declares
  // an OpenAI base-URL normalization on any of its operations (e.g. file
  // providers bound to an OpenAI-compatible dialect). Proxy-contract targets
  // (no declared normalization) receive the profile URL verbatim.
  const wantsOpenAiNormalize = descriptorValueSources(descriptor).some(
    source => source.type === 'profile-base-url' && source.normalize === 'openai-base-url'
  );
  const baseUrl = wantsOpenAiNormalize
    ? normalizeOpenAiBaseUrl(context.profile.baseUrl)
    : context.profile.baseUrl;

  const targetPlans = descriptor.plan ?? [];
  const sorted = [...descriptor.targets].sort((left, right) => left.priority - right.priority);

  for (const target of sorted) {
    const targetPlan = targetPlans.find(candidate => candidate.targetId === target.id);
    const available = context.targetAvailability?.[target.id];
    const guided =
      descriptor.support !== 'automatic'
      || target.requiresGuidance === true
      || target.driver === 'guided-ui'
      || available === false;

    // When the adapter explicitly resolves target paths it declares the
    // selected targets; targets it omits are unselected alternatives and are
    // skipped silently (not guided).
    const explicitResolution = context.resolvedTargetPaths !== undefined;
    const selectedPath = context.resolvedTargetPaths?.[target.id];
    if (explicitResolution && selectedPath === undefined) {
      continue;
    }

    if (guided || !targetPlan) {
      guidedTargetIds.push(target.id);
      plan = addStep(plan, buildGuidedSteps(descriptor, target.id, baseUrl));
      continue;
    }

    const targetPath = selectedPath ?? target.path ?? target.settingKey;
    if (!targetPath) {
      guidedTargetIds.push(target.id);
      plan = addStep(plan, buildGuidedSteps(
        descriptor,
        target.id,
        baseUrl,
        `Switchboard could not resolve the configuration target for ${descriptor.displayName}; configure it manually.`
      ));
      continue;
    }

    automaticTargetIds.push(target.id);
    for (const step of compileTargetPlan(descriptor, targetPlan, targetPath, target.format, context, baseUrl)) {
      plan = addStep(plan, step);
    }
  }

  return { plan, automaticTargetIds, guidedTargetIds };
}

/** Compiles one target's operations into concrete plan steps. */
function compileTargetPlan(
  descriptor: ProviderConfigDescriptor,
  targetPlan: TargetPlan,
  targetPath: string,
  format: ProviderConfigDescriptor['targets'][number]['format'],
  context: ProviderConfigEngineContext,
  baseUrl: string
): Omit<PlanStep, 'id'>[] {
  const commonData: Record<string, unknown> = {
    descriptorKey: descriptor.providerKey,
    ...targetPlan.stepData,
  };

  const normalizedFormat = format === 'vscode-settings' ? 'vscode-setting' : format;
  switch (targetPlan.operations.length > 0 ? descriptorDriverFor(targetPlan.operations, normalizedFormat) : normalizedFormat) {
    case 'vscode-setting': {
      const op = requireSingleOperation(targetPlan.operations, 'vscode-setting set');
      if (op.type !== 'set') {
        throw new Error(`VS Code setting target ${targetPlan.targetId} requires a single 'set' operation`);
      }
      const value = resolveValue(op.value, context);
      if (value === undefined) {
        return [];
      }
      return [{
        action: 'set-vscode-setting',
        description: `Set ${descriptor.displayName} configuration`,
        assistantKey: descriptor.providerKey,
        targetPath,
        newValue: value,
        data: {
          ...commonData,
          settingKey: targetPath,
          value,
          driver: 'vscode-setting',
        },
        reversible: true
      }];
    }

    case 'json-object': {
      const patches: Array<Record<string, unknown>> = [];
      const removePaths: string[][] = [];
      for (const op of targetPlan.operations) {
        if (op.type === 'remove') {
          removePaths.push(op.path);
          continue;
        }
        if (op.type !== 'set') {
          throw new Error(`JSON object target ${targetPlan.targetId} only supports set/remove operations`);
        }
        const value = resolveValue(op.value, context);
        if (value === undefined && op.setWhenMissing !== true) {
          continue;
        }
        patches.push({
          path: op.path,
          ...(op.setWhenMissing ? { setWhenMissing: true } : {}),
          ...(op.mergeObject ? { mergeObject: true } : {}),
          ...(value === undefined
            ? { removeWhenMissing: true }
            : { value, source: op.value.type === 'profile-base-url' ? 'baseUrl' : undefined }),
        });
      }
      return [{
        action: 'edit-config-file',
        description: `Update ${descriptor.displayName} configuration`,
        assistantKey: descriptor.providerKey,
        targetPath,
        newValue: baseUrl,
        data: {
          ...commonData,
          backupRequired: true,
          driver: 'json-object',
          format: format === 'json' ? 'json' : 'jsonc',
          configPath: targetPath,
          profileId: context.profile.id,
          baseUrl,
          patches,
          ...(removePaths.length > 0 ? { removePaths } : {}),
        },
        reversible: true
      }];
    }

    case 'yaml-model-array': {
      const entryOp = requireArrayEntry(targetPlan.operations, targetPlan.targetId);
      const identityValue = entryOp.identityValue;
      const providerField = entryOp.fields.find(field => field.path[field.path.length - 1] === 'provider');
      const provider = providerField && providerField.value.type === 'literal'
        ? String(providerField.value.value)
        : 'openai';
      const responsesField = entryOp.fields.find(field => field.path[field.path.length - 1] === 'useResponsesApi');
      const useResponsesApi = responsesField && responsesField.value.type === 'literal'
        ? Boolean(responsesField.value.value)
        : undefined;
      return [{
        action: 'edit-config-file',
        description: `Update ${descriptor.displayName} model entry to ${baseUrl}`,
        assistantKey: descriptor.providerKey,
        targetPath,
        newValue: baseUrl,
        data: {
          ...commonData,
          backupRequired: true,
          driver: 'yaml-model-array',
          format: format === 'yaml' ? 'yaml' : 'jsonc',
          configPath: targetPath,
          profileId: context.profile.id,
          baseUrl,
          identity: identityValue,
          provider,
          ...(useResponsesApi === undefined ? {} : { useResponsesApi }),
        },
        reversible: true
      }];
    }

    case 'toml-table': {
      const entryOp = targetPlan.operations.find(op => op.type === 'upsert-map-entry');
      if (!entryOp || entryOp.type !== 'upsert-map-entry') {
        throw new Error(`TOML table target ${targetPlan.targetId} requires an upsert-map-entry operation`);
      }
      const wireField = entryOp.fields.find(field => field.path[field.path.length - 1] === 'wire_api');
      const wireApi = wireField && wireField.value.type === 'literal' ? wireField.value.value : 'responses';
      if (wireApi !== 'responses') {
        throw new Error(`TOML provider entry ${entryOp.entryKey} declares an unsupported wire API: ${String(wireApi)}`);
      }
      const envField = entryOp.fields.find(field => field.path[field.path.length - 1] === 'env_key');
      const envKey = envField && envField.value.type === 'literal' ? String(envField.value.value) : undefined;
      // Optional top-level model binding comes from a 'set' operation.
      const modelOp = targetPlan.operations.find(op => op.type === 'set' && op.path.length === 1 && op.path[0] === 'model');
      const model = modelOp && modelOp.type === 'set' && modelOp.value.type === 'discovered-model'
        ? context.discoveredModels?.[0]
        : undefined;
      return [{
        action: 'edit-config-file',
        description: `Set ${descriptor.displayName} provider to ${baseUrl}`,
        assistantKey: descriptor.providerKey,
        targetPath,
        newValue: baseUrl,
        data: {
          ...commonData,
          backupRequired: true,
          driver: 'toml-table',
          format: 'toml',
          configPath: targetPath,
          profileId: context.profile.id,
          baseUrl,
          providerName: entryOp.entryKey,
          wireApi: 'responses',
          ...(envKey ? { envKey } : {}),
          ...(model ? { model } : {}),
        },
        reversible: true
      }];
    }

    default:
      throw new Error(`Target ${targetPlan.targetId} uses an unsupported plan format: ${String(format)}`);
  }
}

/** Builds generic guided steps for a target that cannot be mutated safely. */
function buildGuidedSteps(
  descriptor: ProviderConfigDescriptor,
  targetId: string,
  baseUrl: string,
  messageOverride?: string
 ): Omit<PlanStep, 'id'> {
  return {
    action: 'show-guided-steps',
    description: `${descriptor.displayName} configuration guidance`,
    assistantKey: descriptor.providerKey,
    data: {
      message: messageOverride
        ?? `${descriptor.displayName} requires guided configuration (${descriptor.limitations[0] ?? 'provider-specific policy'}).`,
      steps: buildGuidedStepList(descriptor, baseUrl),
      baseUrl,
      tier: descriptor.tier,
      limitation: descriptor.limitations[0],
      configurationType: descriptor.driver,
      targetId,
      optional: false,
    },
    reversible: false,
  };
}

function buildGuidedStepList(descriptor: ProviderConfigDescriptor, baseUrl: string): string[] {
  const steps = descriptor.fields
    .filter(field => field.valueKind === 'ui-only' || field.valueKind === 'env-binding')
    .map(field => `Configure ${field.field} (${field.path}) — support: ${field.support ?? descriptor.support}.`);
  if (steps.length === 0) {
    return [`Configure ${descriptor.displayName} to use ${baseUrl}.`];
  }
  return [...steps, `Endpoint URL: ${baseUrl}`];
}

function descriptorDriverFor(
  operations: DescriptorOperation[],
  format: string
): string {
  const hasArrayEntry = operations.some(op => op.type === 'upsert-array-entry');
  const hasMapEntry = operations.some(op => op.type === 'upsert-map-entry');
  if (format === 'yaml' || format === 'jsonc' && hasArrayEntry) {
    return 'yaml-model-array';
  }
  if (hasMapEntry) {
    return 'toml-table';
  }
  return format;
}

function requireSingleOperation(operations: DescriptorOperation[], what: string): DescriptorOperation {
  if (operations.length !== 1) {
    throw new Error(`${what} requires exactly one operation, received ${operations.length}`);
  }
  return operations[0];
}

function requireArrayEntry(operations: DescriptorOperation[], targetId: string): Extract<DescriptorOperation, { type: 'upsert-array-entry' }> {
  const entry = operations.find(op => op.type === 'upsert-array-entry');
  if (!entry || entry.type !== 'upsert-array-entry') {
    throw new Error(`Model-array target ${targetId} requires an upsert-array-entry operation`);
  }
  return entry;
}

/** Collects every value source declared by the descriptor's plan. */
function descriptorValueSources(descriptor: ProviderConfigDescriptor): DescriptorValueSource[] {
  const sources: DescriptorValueSource[] = [];
  for (const targetPlan of descriptor.plan ?? []) {
    for (const op of targetPlan.operations) {
      if (op.type === 'set') {
        sources.push(op.value);
      } else if (op.type === 'upsert-map-entry') {
        for (const field of op.fields) {
          sources.push(field.value);
        }
      } else if (op.type === 'upsert-array-entry') {
        for (const field of op.fields) {
          sources.push(field.value);
        }
        if (op.match) {
          sources.push(op.match.equals);
        }
      }
    }
  }
  return sources;
}

/** Resolves a declared value source. Secrets are never resolvable here. */
function resolveValue(
  source: DescriptorValueSource,
  context: ProviderConfigEngineContext
): unknown {
  switch (source.type) {
    case 'literal':
      return source.value;
    case 'profile-base-url': {
      const override = context.valueOverrides?.['profile-base-url'];
      if (override !== undefined) {
        return override;
      }
      return source.normalize === 'openai-base-url'
        ? normalizeOpenAiBaseUrl(context.profile.baseUrl)
        : context.profile.baseUrl;
    }
    case 'discovered-model': {
      const override = context.valueOverrides?.['discovered-model'];
      if (override !== undefined) {
        return override;
      }
      return context.discoveredModels?.[0];
    }
    default:
      return undefined;
  }
}
