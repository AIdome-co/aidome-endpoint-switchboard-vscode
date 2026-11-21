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
  /** Merge object values into an existing object instead of replacing it. */
  mergeObject?: boolean;
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
  /**
   * Model ids discovered from the gateway. When present and non-empty, the
   * driver writes ONE managed entry per id — each carrying the vendor-required
   * `model` field (Continue config schema: model is mandatory) — and removes
   * previously managed entries whose model is no longer in the list
   * (reconcile-on-apply, Kilo precedent). User-authored entries are never
   * touched.
   */
  gatewayModels?: string[];
  /**
   * Stable Switchboard-managed entry identity. Only the entry whose
   * name/title equals this value (or, failing that, whose apiBase equals the
   * gateway URL) is ever mutated — an unrelated user OpenAI model is never
   * rewritten just because it shares the provider name.
   */
  identity?: string;
}

/** Data accepted by the Codex TOML driver. */
export interface TomlTableDriverData {
  driver: 'toml-table';
  providerName: string;
  wireApi: 'responses';
  envKey?: string;
  model?: string;
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
      setNestedValue(output, patch.path, mergePatchValue(output, patch.path, value, patch.mergeObject));
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
    output = applyJsoncEdit(
      output,
      patch.path,
      mergePatchValue(parseJsonc<unknown>(output), patch.path, value, patch.mergeObject)
    );
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
    return renderYamlModelArray(request, modelPath, provider, data.useResponsesApi, data.identity, data.gatewayModels);
  }

  if (data.gatewayModels && data.gatewayModels.length > 0) {
    return renderJsoncModelArray(request, data, modelPath, provider);
  }

  if (request.existingContent !== undefined && isValidJsonc(request.existingContent)) {
    return renderJsoncModelArray(request, data, modelPath, provider);
  }

  const parsed = request.existingContent ? parseJsonObject(request.existingContent, 'jsonc') : {};
  const output = isRecord(parsed) ? parsed : {};
  const models = withoutStaleManagedEntries(
    Array.isArray(output.models) ? output.models.filter(isRecord) : [],
    data.identity ?? modelPath
  );

  if (data.gatewayModels && data.gatewayModels.length > 0) {
    const kept = models.filter(entry => !isManagedModelEntry(entry, data.identity ?? modelPath, request.baseUrl));
    const apiKey = request.secret?.trim() || undefined;
    output.models = [
      ...kept,
      ...buildManagedModelEntries(data.identity ?? modelPath, data.gatewayModels, provider, request.baseUrl, apiKey, data.useResponsesApi)
    ];
    return `${stringifyJsonc(output, 2)}\n`;
  }

  const match = findManagedModelMatch(models, request.baseUrl, data.identity, modelPath);
  // Credential semantics (target-persisted-at-apply): the managed entry gets
  // the profile's key when one is saved, and a credential-less profile switch
  // CLEARS the managed key — a previous profile's token must never survive
  // (Codex 154 clear-not-replay precedent). Credential edits apply ONLY to
  // identity-matched entries: a URL-fallback match may be the USER's own
  // model pointing at the same gateway, and its credential stays untouched.
  const apiKey = request.secret?.trim() || undefined;
  // Only an IDENTITY match is updated in place (credentials included). A
  // URL-fallback match is the USER's own entry: it is left completely
  // untouched and a distinct managed entry is appended instead — otherwise
  // the fallback edit would replace the user's key with the active profile
  // token or delete it (Codex 155 round 1).
  const matching = match.model && match.byIdentity ? match.model : undefined;

  if (matching) {
    matching.provider = provider;
    matching.apiBase = request.baseUrl;
    if (apiKey) {
      matching.apiKey = apiKey;
    } else {
      delete matching.apiKey;
    }
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
    if (apiKey) {
      nextModel.apiKey = apiKey;
    }
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
  const existingModels = withoutStaleManagedEntries(
    Array.isArray(root.models) ? root.models : [],
    data.identity ?? modelPath
  );
  let output = request.existingContent ?? '{}';

  if (data.gatewayModels && data.gatewayModels.length > 0) {
    // Multi-model reconcile (see renderYamlModelArray).
    const kept = existingModels.filter(entry => !isManagedModelEntry(entry, data.identity ?? modelPath, request.baseUrl));
    const apiKey = request.secret?.trim() || undefined;
    const managedEntries = buildManagedModelEntries(
      data.identity ?? modelPath,
      data.gatewayModels,
      provider,
      request.baseUrl,
      apiKey,
      data.useResponsesApi
    );
    output = applyJsoncEdit(output, ['models'], [...kept, ...managedEntries]);
    return ensureTrailingNewline(output);
  }

  const match = findManagedModelMatch(existingModels, request.baseUrl, data.identity, modelPath);

  // Credential semantics: set the key when a profile secret was resolved at
  // apply time; CLEAR it otherwise so a previous profile's token never
  // survives a switch. jsonc-parser's modify DELETES the property when the
  // value is undefined. Credential edits apply ONLY to identity-matched
  // entries — a URL-fallback match may be the USER's own model.
  const apiKey = request.secret?.trim() || undefined;
  // Only an IDENTITY match is updated in place; a URL-fallback match is the
  // USER's own entry and stays untouched — a distinct managed entry is
  // appended instead (Codex 155 round 1).
  const inPlace = match.model && match.byIdentity ? match.model : undefined;
  if (inPlace) {
    const matchingIndex = existingModels.indexOf(inPlace);
    output = applyJsoncEdit(output, ['models', matchingIndex, 'provider'], provider);
    output = applyJsoncEdit(output, ['models', matchingIndex, 'apiBase'], request.baseUrl);
    output = applyJsoncEdit(output, ['models', matchingIndex, 'apiKey'], apiKey);
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
    if (apiKey) {
      nextModel.apiKey = apiKey;
    }
    if (data.useResponsesApi !== undefined) {
      nextModel.useResponsesApi = data.useResponsesApi;
    }

    output = Array.isArray(root.models)
      ? applyJsoncEdit(output, ['models', existingModels.length], nextModel)
      : applyJsoncEdit(output, ['models'], [nextModel]);
  }

  return ensureTrailingNewline(output);
}

/**
 * Unambiguous ownership marker written on every managed model entry. A name
 * prefix alone is NOT ownership evidence — a user may legitimately name
 * their own entry "AIdome Gateway - <something>" (Codex 157 round 3) — so
 * reconciliation only touches prefixed entries that carry this marker (or
 * whose apiBase equals the gateway URL currently being written).
 */
const AIDOME_MANAGED_MARKER = 'aidomeManaged';

/**
 * Builds the Switchboard-managed model entries for a Continue-style model
 * array when gateway model ids are known: ONE entry per model, each carrying
 * the vendor-required `model` field and the ownership marker.
 */
function buildManagedModelEntries(
  identity: string,
  gatewayModels: string[],
  provider: string,
  baseUrl: string,
  apiKey: string | undefined,
  useResponsesApi: boolean | undefined
): Record<string, unknown>[] {
  return gatewayModels.map(modelId => {
    const entry: Record<string, unknown> = {
      name: `${identity} - ${modelId}`,
      title: modelId,
      model: modelId,
      provider,
      apiBase: baseUrl,
      [AIDOME_MANAGED_MARKER]: true
    };
    if (apiKey) {
      entry.apiKey = apiKey;
    }
    if (useResponsesApi !== undefined) {
      entry.useResponsesApi = useResponsesApi;
    }
    return entry;
  });
}

/**
 * True when an entry was authored by this extension's managed identity.
 * The exact identity name is the legacy single-entry shape (always ours);
 * a per-model prefix is ours only with the marker or when the entry points
 * at the gateway URL currently being written. Continue's config schema
 * strips unknown fields, so the marker never breaks the vendor parser.
 */
function isManagedModelEntry(
  entry: Record<string, unknown>,
  identity: string,
  baseUrl?: string
): boolean {
  const name = typeof entry.name === 'string' ? entry.name : undefined;
  const title = typeof entry.title === 'string' ? entry.title : undefined;
  if (name === identity || title === identity) {
    return true;
  }
  const withSeparator = `${identity} - `;
  const prefixMatch = (name !== undefined && name.startsWith(withSeparator))
    || (title !== undefined && title.startsWith(withSeparator));
  if (!prefixMatch) {
    return false;
  }
  return entry[AIDOME_MANAGED_MARKER] === true
    || (baseUrl !== undefined && entry.apiBase === baseUrl);
}

/**
 * Removes stale per-model managed entries ("identity - <model>") from the
 * single-entry legacy path: after one multi-model apply, a profile switch
 * WITHOUT discovery results would otherwise leave those entries — with the
 * previous profile's URL and credential — in place while appending the
 * model-less legacy entry that Continue drops (Codex 157 round 1). Per-model
 * prefixed entries are authored by this extension, so removing them is safe;
 * user-authored entries are never matched.
 */
function withoutStaleManagedEntries(
  models: Record<string, unknown>[],
  identity: string
): Record<string, unknown>[] {
  return models.filter(entry =>
    !(isManagedModelEntry(entry, identity)
      && entry.name !== identity
      && entry.title !== identity)
  );
}

function renderYamlModelArray(
  request: ConfigDriverRequest,
  modelPath: string,
  provider: string,
  useResponsesApi?: boolean,
  identity?: string,
  gatewayModels?: string[]
): string {
  const document = parseDocument(request.existingContent || '');

  // Fail closed: report parser/document errors before modifying anything.
  // The yaml library collects errors instead of throwing, so a malformed
  // document would otherwise be silently re-serialized from partial content.
  if (document.errors.length > 0) {
    const first = document.errors[0];
    throw new Error(
      `YAML model-array driver cannot modify a malformed existing configuration file: ${first.message} (line ${first.linePos?.[0]?.line ?? '?'}, column ${first.linePos?.[0]?.col ?? '?'}). ` +
      'Fix or remove the file manually, then retry — the original file was left untouched.'
    );
  }

  const parsed = document.toJSON();
  const output = isRecord(parsed) ? parsed : {};
  const models = withoutStaleManagedEntries(
    Array.isArray(output.models) ? output.models.filter(isRecord) : [],
    identity ?? modelPath
  );

  if (gatewayModels && gatewayModels.length > 0) {
    // Multi-model reconcile: drop exactly the entries this extension managed
    // (identity-named) and write one entry per discovered gateway model.
    const kept = models.filter(entry => !isManagedModelEntry(entry, identity ?? modelPath, request.baseUrl));
    const apiKey = request.secret?.trim() || undefined;
    output.models = [
      ...kept,
      ...buildManagedModelEntries(identity ?? modelPath, gatewayModels, provider, request.baseUrl, apiKey, useResponsesApi)
    ];
    document.set('models', output.models);
    return document.toString({ lineWidth: 0 });
  }

  const match = findManagedModelMatch(models, request.baseUrl, identity, modelPath);

  // Credential semantics: same clear-not-replay contract as the JSONC path,
  // and credential edits apply ONLY to identity-matched entries.
  const apiKey = request.secret?.trim() || undefined;
  // Only an IDENTITY match is updated in place; a URL-fallback match is the
  // USER's own entry and stays untouched — a distinct managed entry is
  // appended instead (Codex 155 round 1).
  const current = match.model && match.byIdentity ? match.model : undefined;
  const index = current ? models.indexOf(current) : -1;
  if (index >= 0) {
    current!.provider = provider;
    current!.apiBase = request.baseUrl;
    if (apiKey) {
      current!.apiKey = apiKey;
    } else {
      delete current!.apiKey;
    }
    if (useResponsesApi !== undefined) {
      current!.useResponsesApi = useResponsesApi;
    }
  } else {
    const nextModel: Record<string, unknown> = {
      name: modelPath,
      title: modelPath,
      provider,
      apiBase: request.baseUrl
    };
    if (apiKey) {
      nextModel.apiKey = apiKey;
    }
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

  // Fail closed: a malformed existing TOML file must never be silently
  // replaced. parseToml throws on invalid content; wrap it with actionable
  // guidance so the applier aborts and preserves the original file.
  let parsed: Record<string, unknown>;
  if (request.existingContent) {
    try {
      parsed = parseToml(request.existingContent);
    } catch (error) {
      throw new Error(
        `Codex TOML driver cannot modify a malformed existing configuration file: ${error instanceof Error ? error.message : String(error)}. ` +
        'Fix or remove the file manually, then retry — the original file was left untouched.'
      );
    }
  } else {
    parsed = {};
  }
  const output = parsed;
  const modelProviders = isRecord(output.model_providers) ? output.model_providers : {};
  const existingProvider = isRecord(modelProviders[providerName]) ? modelProviders[providerName] : {};

  modelProviders[providerName] = {
    ...existingProvider,
    name: typeof existingProvider.name === 'string' ? existingProvider.name : providerName,
    base_url: request.baseUrl,
    wire_api: data.wireApi,
    ...(data.envKey ? { env_key: data.envKey } : {})
  };
  if (typeof data.model === 'string' && data.model.trim().length > 0) {
    output.model = data.model.trim();
  }
  output.model_providers = modelProviders;
  output.model_provider = providerName;

  return stringifyToml(output);
}

/**
 * A managed-entry match plus HOW it matched. Credential edits (apiKey
 * set/clear) may only be applied to IDENTITY matches: an entry matched by
 * URL fallback can be a USER's own model that merely points at the same
 * gateway URL, and rewriting or clearing ITS credential would destroy the
 * user's key (Codex 155 round 1).
 */
interface ManagedModelMatch {
  model: Record<string, unknown> | undefined;
  byIdentity: boolean;
}

/**
 * Finds the Switchboard-managed model entry: identity-field match first
 * (name/title), then the entry whose apiBase equals the gateway URL (an
 * entry previously written by Switchboard). NEVER matches by provider name —
 * an unrelated user OpenAI model must not be rewritten.
 */
function findManagedModelMatch(
  models: unknown[],
  baseUrl: string,
  identity: string | undefined,
  modelPath: string
): ManagedModelMatch {
  const identityValue = identity ?? modelPath;
  if (identityValue.length > 0) {
    const byIdentity = models.findIndex(model =>
      isRecord(model) && (model.name === identityValue || model.title === identityValue)
    );
    if (byIdentity >= 0 && isRecord(models[byIdentity])) {
      return { model: models[byIdentity] as Record<string, unknown>, byIdentity: true };
    }
  }
  const byUrl = models.findIndex(model => isRecord(model) && model.apiBase === baseUrl);
  return byUrl >= 0 && isRecord(models[byUrl])
    ? { model: models[byUrl] as Record<string, unknown>, byIdentity: false }
    : { model: undefined, byIdentity: false };
}

function findManagedModel(
  models: Record<string, unknown>[],
  baseUrl: string,
  identity: string | undefined,
  modelPath: string
): Record<string, unknown> | undefined {
  return findManagedModelMatch(models as unknown[], baseUrl, identity, modelPath).model;
}

function findManagedModelIndex(
  models: unknown[],
  baseUrl: string,
  identity: string | undefined,
  modelPath: string
): number {
  // Kept for non-credential callers (provider/apiBase upserts).
  const identityValue = identity ?? modelPath;
  if (identityValue.length > 0) {
    const byIdentity = models.findIndex(model =>
      isRecord(model) && (model.name === identityValue || model.title === identityValue)
    );
    if (byIdentity >= 0) {
      return byIdentity;
    }
  }
  return models.findIndex(model => isRecord(model) && model.apiBase === baseUrl);
}

function parseJsonObject(
  content: string | undefined,
  format: 'json' | 'jsonc' = 'jsonc',
  driverName = 'JSON object driver'
): Record<string, unknown> {
  // A missing or empty file is a creation case and stays allowed.
  if (content === undefined || content.trim().length === 0) {
    return {};
  }

  // Fail closed: a malformed existing user configuration must never be
  // silently replaced with a regenerated partial file. Abort the mutation;
  // the caller leaves the original file untouched and reports guidance.
  try {
    const parsed = format === 'jsonc' ? parseJsonc<unknown>(content) : JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      throw new Error(`document root is ${Array.isArray(parsed) ? 'an array' : typeof parsed}, expected an object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `${driverName} cannot modify a malformed existing configuration file: ${error instanceof Error ? error.message : String(error)}. ` +
      'Fix or remove the file manually, then retry — the original file was left untouched.'
    );
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

function mergePatchValue(
  root: unknown,
  path: string[],
  value: unknown,
  mergeObject: boolean | undefined
): unknown {
  if (!mergeObject || !isRecord(value)) {
    return value;
  }

  const existing = getValueAtPath(root, path);
  return isRecord(existing) ? { ...existing, ...value } : value;
}

function getValueAtPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
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
