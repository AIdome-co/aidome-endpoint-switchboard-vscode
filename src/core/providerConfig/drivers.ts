/**
 * Reusable configuration drivers.
 *
 * Drivers operate on provider-neutral plan data. Provider adapters choose the
 * target and field paths; orchestration only selects the declared driver.
 */

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { applyEdits, modify } from 'jsonc-parser';
import { parseDocument } from 'yaml';
import { parseJsonc, stringifyJsonc } from '../../util/jsonc';
import { validateUrl } from '../profiles/profileValidator';
import { ConfigDriverRequest } from './types';

/** A JSON path assignment used by the JSON object driver. */
export interface JsonFieldPatch {
  path: string[];
  value?: unknown;
  source?: 'baseUrl' | 'secret' | 'timestamp';
  removeWhenMissing?: boolean;
  /** Set only when the target field is absent, preserving an existing value. */
  setWhenMissing?: boolean;
}

/** Data accepted by the JSON object driver. */
export interface JsonObjectDriverData {
  driver: 'json-object';
  format?: 'json' | 'jsonc';
  patches: JsonFieldPatch[];
  removePaths?: string[][];
}

/** Data accepted by the JSONC provider-map driver. */
export interface JsoncProviderMapDriverData {
  driver: 'jsonc-provider-map';
  mapPath: string[];
  providerId: string;
  defaults: Record<string, unknown>;
  baseUrlPath: string[];
  models?: Record<string, unknown>;
}

/** Data accepted by the Continue model-array driver. */
export interface ModelArrayDriverData {
  driver: 'yaml-model-array';
  format: 'yaml' | 'jsonc';
  modelPath?: string;
  provider?: string;
  useResponsesApi?: boolean;
}

/** Data accepted by the Codex TOML driver. */
export interface TomlTableDriverData {
  driver: 'toml-table';
  providerName: string;
  wireApi: 'responses';
  envKey?: string;
}

/** Union of file-driver plan data. */
export type ConfigFileDriverData =
  | JsonObjectDriverData
  | JsoncProviderMapDriverData
  | ModelArrayDriverData
  | TomlTableDriverData;

/**
 * Renders a file-backed plan step using its declared driver.
 *
 * @param request Driver input including validated base URL and optional secret
 * @returns Updated configuration file content
 * @throws Error when the driver declaration is invalid or unsupported
 */
export function renderConfigFileContent(request: ConfigDriverRequest): string {
  if (!validateUrl(request.baseUrl)) {
    throw new Error('Configuration driver received an invalid endpoint URL');
  }

  const data = request.options as ConfigFileDriverData | undefined;
  if (!data || typeof data.driver !== 'string') {
    throw new Error('Configuration file step is missing a typed driver declaration');
  }

  switch (data.driver) {
    case 'json-object':
      return renderJsonObject(request, data);
    case 'jsonc-provider-map':
      return renderJsoncProviderMap(request, data);
    case 'yaml-model-array':
      return renderModelArray(request, data);
    case 'toml-table':
      return renderTomlTable(request, data);
    default:
      throw new Error(`Driver ${String((data as { driver?: unknown }).driver)} cannot render a file`);
  }
}

function renderJsonObject(request: ConfigDriverRequest, data: JsonObjectDriverData): string {
  if (data.format === 'jsonc' && request.existingContent !== undefined && isValidJsonc(request.existingContent)) {
    return renderJsoncObject(request, data);
  }

  const parsed = request.existingContent ? parseJsonObject(request.existingContent, data.format) : {};
  const output = isRecord(parsed) ? parsed : {};

  for (const patch of data.patches) {
    if (!Array.isArray(patch.path) || patch.path.length === 0 || patch.path.some(isUnsafePathSegment)) {
      throw new Error('JSON object driver received an invalid field path');
    }

    if (patch.setWhenMissing && hasNestedValue(output, patch.path)) {
      continue;
    }

    const value = resolvePatchValue(request, patch);

    if (value === undefined && patch.removeWhenMissing) {
      deleteNestedValue(output, patch.path);
    } else if (value !== undefined) {
      setNestedValue(output, patch.path, value);
    }
  }

  for (const path of data.removePaths ?? []) {
    validatePath(path, 'JSON object driver');
    deleteNestedValue(output, path);
  }

  return `${stringifyJsonc(output, 2)}\n`;
}

function renderJsoncObject(request: ConfigDriverRequest, data: JsonObjectDriverData): string {
  let output = request.existingContent ?? '{}';

  for (const patch of data.patches) {
    validatePath(patch.path, 'JSON object driver');
    if (patch.setWhenMissing && hasNestedValue(parseJsonc<unknown>(output), patch.path)) {
      continue;
    }
    const value = resolvePatchValue(request, patch);
    if (value === undefined && !patch.removeWhenMissing) {
      continue;
    }
    output = applyJsoncEdit(output, patch.path, value);
  }

  for (const path of data.removePaths ?? []) {
    validatePath(path, 'JSON object driver');
    output = applyJsoncEdit(output, path, undefined);
  }

  return ensureTrailingNewline(output);
}

function renderJsoncProviderMap(request: ConfigDriverRequest, data: JsoncProviderMapDriverData): string {
  if (
    data.providerId.trim().length === 0
    || isUnsafePathSegment(data.providerId)
    || data.mapPath.length === 0
    || data.baseUrlPath.length === 0
  ) {
    throw new Error('JSONC provider-map driver requires a provider ID and map path');
  }

  validatePath(data.mapPath, 'JSONC provider-map driver');
  validatePath(data.baseUrlPath, 'JSONC provider-map driver');

  if (request.existingContent !== undefined && isValidJsonc(request.existingContent)) {
    let output = request.existingContent;
    const parsed = parseJsonc<unknown>(output);
    const root = isRecord(parsed) ? parsed : {};
    const providerMap = getRecordAtPath(root, data.mapPath);
    const existingProvider: Record<string, unknown> = providerMap && isRecord(providerMap[data.providerId])
      ? providerMap[data.providerId] as Record<string, unknown>
      : {};

    for (const [key, value] of Object.entries(data.defaults)) {
      if (!(key in existingProvider)) {
        output = applyJsoncEdit(output, [...data.mapPath, data.providerId, key], value);
      }
    }
    output = applyJsoncEdit(output, [...data.mapPath, data.providerId, ...data.baseUrlPath], request.baseUrl);
    if (data.models && Object.keys(data.models).length > 0) {
      output = applyJsoncEdit(output, [...data.mapPath, data.providerId, 'models'], data.models);
    }
    return ensureTrailingNewline(output);
  }

  const parsed = request.existingContent ? parseJsonObject(request.existingContent, 'jsonc') : {};
  const output = isRecord(parsed) ? parsed : {};
  const providerMap = getOrCreateRecord(output, data.mapPath);
  const existingProvider: Record<string, unknown> = isRecord(providerMap[data.providerId])
    ? providerMap[data.providerId] as Record<string, unknown>
    : {};
  const provider = {
    ...data.defaults,
    ...existingProvider
  };

  setNestedValue(provider, data.baseUrlPath, request.baseUrl);
  if (data.models && Object.keys(data.models).length > 0) {
    provider.models = data.models;
  }
  providerMap[data.providerId] = provider;

  return `${stringifyJsonc(output, 2)}\n`;
}

function renderModelArray(request: ConfigDriverRequest, data: ModelArrayDriverData): string {
  const modelPath = data.modelPath?.trim() || 'AIdome Gateway';
  const provider = data.provider?.trim() || 'openai';

  if (data.format === 'yaml') {
    return renderYamlModelArray(request, modelPath, provider, data.useResponsesApi);
  }

  if (request.existingContent !== undefined && isValidJsonc(request.existingContent)) {
    return renderJsoncModelArray(request, data, modelPath, provider);
  }

  const parsed = request.existingContent ? parseJsonObject(request.existingContent, 'jsonc') : {};
  const output = isRecord(parsed) ? parsed : {};
  const models = Array.isArray(output.models) ? output.models.filter(isRecord) : [];
  const matching = models.find(model => model.apiBase === request.baseUrl)
    ?? models.find(model => model.provider === provider);

  if (matching) {
    matching.provider = provider;
    matching.apiBase = request.baseUrl;
    if (data.useResponsesApi !== undefined) {
      matching.useResponsesApi = data.useResponsesApi;
    }
  } else {
    const nextModel: Record<string, unknown> = {
      name: modelPath,
      title: modelPath,
      provider,
      apiBase: request.baseUrl
    };
    if (data.useResponsesApi !== undefined) {
      nextModel.useResponsesApi = data.useResponsesApi;
    }
    models.push(nextModel);
  }

  output.models = models;
  return `${stringifyJsonc(output, 2)}\n`;
}

function renderJsoncModelArray(
  request: ConfigDriverRequest,
  data: ModelArrayDriverData,
  modelPath: string,
  provider: string
): string {
  const parsed = parseJsonc<unknown>(request.existingContent ?? '{}');
  const root = isRecord(parsed) ? parsed : {};
  const existingModels = Array.isArray(root.models) ? root.models : [];
  const matchingIndex = existingModels.findIndex(model =>
    isRecord(model) && (model.apiBase === request.baseUrl || model.provider === provider)
  );
  let output = request.existingContent ?? '{}';

  if (matchingIndex >= 0) {
    output = applyJsoncEdit(output, ['models', matchingIndex, 'provider'], provider);
    output = applyJsoncEdit(output, ['models', matchingIndex, 'apiBase'], request.baseUrl);
    if (data.useResponsesApi !== undefined) {
      output = applyJsoncEdit(output, ['models', matchingIndex, 'useResponsesApi'], data.useResponsesApi);
    }
  } else {
    const nextModel: Record<string, unknown> = {
      name: modelPath,
      title: modelPath,
      provider,
      apiBase: request.baseUrl
    };
    if (data.useResponsesApi !== undefined) {
      nextModel.useResponsesApi = data.useResponsesApi;
    }

    output = Array.isArray(root.models)
      ? applyJsoncEdit(output, ['models', existingModels.length], nextModel)
      : applyJsoncEdit(output, ['models'], [nextModel]);
  }

  return ensureTrailingNewline(output);
}

function renderYamlModelArray(
  request: ConfigDriverRequest,
  modelPath: string,
  provider: string,
  useResponsesApi?: boolean
): string {
  const document = parseDocument(request.existingContent || '');
  const parsed = document.toJSON();
  const output = isRecord(parsed) ? parsed : {};
  const models = Array.isArray(output.models) ? output.models.filter(isRecord) : [];
  const index = models.findIndex(model => model.apiBase === request.baseUrl || model.provider === provider);

  if (index >= 0) {
    const current = models[index];
    current.provider = provider;
    current.apiBase = request.baseUrl;
    if (useResponsesApi !== undefined) {
      current.useResponsesApi = useResponsesApi;
    }
  } else {
    const nextModel: Record<string, unknown> = {
      name: modelPath,
      title: modelPath,
      provider,
      apiBase: request.baseUrl
    };
    if (useResponsesApi !== undefined) {
      nextModel.useResponsesApi = useResponsesApi;
    }
    models.push(nextModel);
  }

  document.set('models', models);
  return document.toString({ lineWidth: 0 });
}

function renderTomlTable(request: ConfigDriverRequest, data: TomlTableDriverData): string {
  const providerName = data.providerName.trim();
  if (providerName.length === 0 || data.wireApi !== 'responses') {
    throw new Error('Codex TOML driver requires a named provider and Responses wire API');
  }

  const parsed = request.existingContent ? parseToml(request.existingContent) : {};
  const output = isRecord(parsed) ? parsed : {};
  const modelProviders = isRecord(output.model_providers) ? output.model_providers : {};
  const existingProvider = isRecord(modelProviders[providerName]) ? modelProviders[providerName] : {};

  modelProviders[providerName] = {
    ...existingProvider,
    name: typeof existingProvider.name === 'string' ? existingProvider.name : providerName,
    base_url: request.baseUrl,
    wire_api: data.wireApi,
    ...(data.envKey ? { env_key: data.envKey } : {})
  };
  output.model_providers = modelProviders;
  output.model_provider = providerName;

  return stringifyToml(output);
}

function parseJsonObject(content: string, format: 'json' | 'jsonc' = 'jsonc'): Record<string, unknown> {
  try {
    const parsed = format === 'jsonc' ? parseJsonc<unknown>(content) : JSON.parse(content) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function resolvePatchValue(request: ConfigDriverRequest, patch: JsonFieldPatch): unknown {
  return patch.source === 'baseUrl'
    ? request.baseUrl
    : patch.source === 'secret'
      ? request.secret
      : patch.source === 'timestamp'
        ? new Date().toISOString()
        : patch.value;
}

function applyJsoncEdit(content: string, path: (string | number)[], value: unknown): string {
  return applyEdits(content, modify(content, path, value, {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' }
  }));
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function isValidJsonc(content: string): boolean {
  try {
    parseJsonc<unknown>(content);
    return true;
  } catch {
    return false;
  }
}

function validatePath(path: string[], driverName: string): void {
  if (!Array.isArray(path) || path.length === 0 || path.some(isUnsafePathSegment)) {
    throw new Error(`${driverName} received an invalid field path`);
  }
}

function getRecordAtPath(root: Record<string, unknown>, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return isRecord(current) ? current : undefined;
}

function hasNestedValue(root: unknown, path: string[]): boolean {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !(segment in current)) {
      return false;
    }
    current = current[segment];
  }
  return true;
}

function getOrCreateRecord(root: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let current = root;
  for (const segment of path) {
    if (isUnsafePathSegment(segment)) {
      throw new Error('JSONC provider-map driver received an invalid map path');
    }
    const next: unknown = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  return current;
}

function setNestedValue(root: Record<string, unknown>, path: string[], value: unknown): void {
  let current = root;
  for (const segment of path.slice(0, -1)) {
    const next: unknown = current[segment];
    if (!isRecord(next)) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

function deleteNestedValue(root: Record<string, unknown>, path: string[]): void {
  if (path.length === 0) {
    return;
  }
  let current: Record<string, unknown> = root;
  for (const segment of path.slice(0, -1)) {
    const next = current[segment];
    if (!isRecord(next)) {
      return;
    }
    current = next;
  }
  delete current[path[path.length - 1]];
}

function isUnsafePathSegment(segment: string): boolean {
  return typeof segment !== 'string' || segment.length === 0 || segment === '__proto__' || segment === 'constructor' || segment === 'prototype';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
