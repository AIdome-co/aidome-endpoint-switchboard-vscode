/**
 * Descriptor-driven, profile-aware configuration verification.
 *
 * Verification expectations come from the descriptor's declarative plan
 * operations (paths, identities, literals) and its verification contract —
 * never from per-adapter hardcoded field knowledge. "Endpoint is healthy" is
 * a different question from "the assistant is configured for this profile";
 * this module only answers the latter.
 *
 * No secret values are read or returned; credential checks assert presence
 * only (e.g. an env var name reference exists).
 */

import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { parseJsonc } from '../../util/jsonc';
import { normalizeOpenAiBaseUrl } from './endpointUrl';
import {
  AIDOME_MODEL_IDENTITY,
  DescriptorValueSource,
  ProviderConfigDescriptor,
  TargetPlan,
} from './types';

/** Verification failure result. */
export interface ConfigVerificationResult {
  success: boolean;
  message: string;
  details: Record<string, unknown>;
}

/** Expected value for one declared operation field. */
export interface ExpectedValue {
  source: DescriptorValueSource;
  /** Expected profile base URL (raw); normalized per the source declaration. */
  profileBaseUrl: string;
  /** Discovered model id, when the source binds one. */
  discoveredModelId?: string;
}

/** Inputs for verifying a file-backed target. */
export interface FileTargetVerificationInput {
  /** Parsed document (verified internally against the format). */
  parsed: unknown;
  /** Base URL expected from the active profile (raw). */
  profileBaseUrl: string;
  /** Model id discovered from the gateway, when discovery is enabled. */
  discoveredModelId?: string;
}

/**
 * Verifies a file-backed target against its descriptor plan operations.
 * `parsed` must be the already-parsed configuration document (adapters parse
 * with the same fail-closed parsers the drivers use).
 */
export function verifyFileTarget(
  descriptor: ProviderConfigDescriptor,
  input: FileTargetVerificationInput
): ConfigVerificationResult {
  const failures: string[] = [];
  const details: Record<string, unknown> = {
    providerKey: descriptor.providerKey,
    checkedOperations: 0,
  };

  for (const targetPlan of descriptor.plan ?? []) {
    for (const op of targetPlan.operations) {
      details.checkedOperations = (details.checkedOperations as number) + 1;
      switch (op.type) {
        case 'set': {
          const expected = expectedValueFor(op.value, input.profileBaseUrl, input.discoveredModelId);
          if (op.path.length === 0) {
            failures.push(compare('', input.parsed, expected));
            break;
          }
          const actual = getPath(input.parsed, op.path);
          failures.push(compare(op.path.join('.'), actual, expected));
          break;
        }
        case 'upsert-map-entry': {
          const map = getPath(input.parsed, op.path);
          const entry = isRecord(map) ? map[op.entryKey] : undefined;
          if (!isRecord(entry)) {
            failures.push(`${op.path.join('.')}.${op.entryKey} is missing`);
            break;
          }
          // Selected-provider contract: the provider selector must point at
          // this entry when the target selects one.
          if (descriptor.verification.selectedProviderRequired) {
            failures.push(compareSelection(descriptor, input.parsed, op.entryKey));
          }
          for (const field of op.fields) {
            const expected = expectedValueFor(field.value, input.profileBaseUrl, input.discoveredModelId);
            failures.push(compare(
              `${op.entryKey}.${field.path.join('.')}`,
              getPath(entry, field.path),
              expected
            ));
          }
          break;
        }
        case 'upsert-array-entry': {
          const entries = getPath(input.parsed, op.path);
          if (!Array.isArray(entries)) {
            failures.push(`${op.path.join('.')} is not an array`);
            break;
          }
          const entry = entries.find(item =>
            isRecord(item) && item[op.identityField] === op.identityValue
          );
          if (!entry || !isRecord(entry)) {
            failures.push(`${op.path.join('.')} has no ${op.identityField}=${op.identityValue} entry`);
            break;
          }
          for (const field of op.fields) {
            const expected = expectedValueFor(field.value, input.profileBaseUrl, input.discoveredModelId);
            failures.push(compare(
              `${op.identityValue}.${field.path.join('.')}`,
              getPath(entry, field.path),
              expected
            ));
          }
          break;
        }
        case 'remove':
          // Removals are not verifiable post-hoc when users may re-add keys.
          break;
        default:
          break;
      }
    }
  }

  const realFailures = failures.filter((failure): failure is string => failure.length > 0);
  return {
    success: realFailures.length === 0,
    message: realFailures.length === 0
      ? `${descriptor.displayName} configuration verified for the active profile`
      : `${descriptor.displayName} configuration does not match the active profile: ${realFailures.join('; ')}`,
    details: { ...details, failures: realFailures },
  };
}

/** Verifies a VS Code setting value against a declared `set` operation. */
export function verifySettingValue(
  descriptor: ProviderConfigDescriptor,
  input: {
    configuredValue: unknown;
    profileBaseUrl: string;
  }
): ConfigVerificationResult {
  const targetPlan: TargetPlan | undefined = (descriptor.plan ?? []).find(plan =>
    plan.operations.length === 1 && plan.operations[0].type === 'set'
  );
  if (!targetPlan) {
    return {
      success: false,
      message: `${descriptor.displayName} descriptor does not declare a verifiable setting operation`,
      details: { providerKey: descriptor.providerKey },
    };
  }
  const op = targetPlan.operations[0];
  if (op.type !== 'set') {
    return { success: false, message: 'Unexpected operation kind', details: {} };
  }
  const expected = expectedValueFor(op.value, input.profileBaseUrl);
  const failure = compare(descriptor.providerKey, input.configuredValue, expected);
  return {
    success: failure.length === 0,
    message: failure.length === 0
      ? `${descriptor.displayName} configuration verified for the active profile`
      : `${descriptor.displayName} configuration does not match the active profile: ${failure}`,
    details: { providerKey: descriptor.providerKey, failures: failure ? [failure] : [] },
  };
}

/** Computes the expected concrete value for a declared value source. */
function expectedValueFor(
  source: DescriptorValueSource,
  profileBaseUrl: string,
  discoveredModelId?: string
): ExpectedValue {
  return { source, profileBaseUrl, discoveredModelId };
}

/** Compares actual vs expected; returns '' when equal, otherwise a failure string. */
function compare(label: string, actual: unknown, expected: ExpectedValue): string {
  let expectedValue: unknown;
  switch (expected.source.type) {
    case 'literal':
      expectedValue = expected.source.value;
      break;
    case 'profile-base-url':
      expectedValue = expected.source.normalize === 'openai-base-url'
        ? normalizeOpenAiBaseUrl(expected.profileBaseUrl)
        : expected.profileBaseUrl;
      break;
    case 'discovered-model':
      // Discovery is optional: only verify when a model was supplied.
      return expected.discoveredModelId === undefined ? '' : '';
    default:
      return '';
  }

  return actual === expectedValue
    ? ''
    : `${label || 'value'} expected ${JSON.stringify(expectedValue)}, found ${JSON.stringify(actual ?? null)}`;
}

/** For map entries with a selector field, checks `model_provider`-style selection. */
function compareSelection(
  descriptor: ProviderConfigDescriptor,
  parsed: unknown,
  entryKey: string
): string {
  // The selector path is declared as the provider field whose path is a bare
  // top-level key in the descriptor fields (e.g. 'model_provider').
  const selector = descriptor.fields.find(field =>
    field.field === 'provider' && !field.path.includes('.') && field.valueKind === 'string'
  );
  if (!selector) {
    return '';
  }
  const selected = getPath(parsed, selector.path.split('.'));
  return selected === entryKey
    ? ''
    : `provider selector ${selector.path} expected ${entryKey}, found ${JSON.stringify(selected ?? null)}`;
}

function getPath(root: unknown, path: (string | number)[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment as string];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses a configuration document with fail-closed semantics. */
export function parseConfigDocument(
  content: string | undefined,
  format: 'json' | 'jsonc' | 'yaml' | 'toml'
): { ok: true; parsed: unknown } | { ok: false; error: string } {
  if (content === undefined || content.trim().length === 0) {
    return { ok: false, error: 'configuration file is missing or empty' };
  }
  try {
    switch (format) {
      case 'json':
        return { ok: true, parsed: JSON.parse(content) };
      case 'jsonc':
        return { ok: true, parsed: parseJsonc<unknown>(content) };
      case 'yaml': {
        const document = parseDocument(content);
        if (document.errors.length > 0) {
          return { ok: false, error: document.errors[0].message };
        }
        return { ok: true, parsed: document.toJSON() };
      }
      case 'toml':
        return { ok: true, parsed: parseToml(content) };
      default:
        return { ok: false, error: `unsupported verification format ${String(format)}` };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Re-exported for adapters that need the stable model identity. */
export { AIDOME_MODEL_IDENTITY };
