import { EndpointProfile } from '../profiles/profileTypes';
import { joinApiPath } from '../../util/apiUrl';
import { httpRequest } from '../../util/http';

/** Minimal model metadata safe to place in a provider's model catalog. */
export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxInputTokens?: number;
  capabilities?: string[];
}

/**
 * Discovers models through the OpenAI-compatible API.
 * The token is used only for this in-memory request and is never returned or
 * included in a configuration plan.
 */
export async function discoverOpenAiModels(
  baseUrl: string,
  apiKey?: string
): Promise<DiscoveredModel[]> {
  try {
    const response = await httpRequest<{ data?: unknown[] }>(
      joinApiPath(baseUrl, '/v1/models'),
      {
        method: 'GET',
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        timeout: 10_000,
        retries: 0
      }
    );

    if (!Array.isArray(response.body?.data)) {
      return [];
    }

    return response.body.data
      .map(toDiscoveredModel)
      .filter((model): model is DiscoveredModel => model !== undefined);
  } catch {
    return [];
  }
}

/** Uses cached verification data when a network lookup is not needed. */
export function getCachedOpenAiModels(profile: EndpointProfile): DiscoveredModel[] {
  return (profile.capabilitiesCache?.supportedModels ?? [])
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map(id => ({ id, name: id }));
}

function toDiscoveredModel(value: unknown): DiscoveredModel | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  if (!id) {
    return undefined;
  }

  const model: DiscoveredModel = {
    id,
    name: typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : id
  };

  const contextWindow = readPositiveNumber(record.context_window ?? record.contextWindow);
  const maxInputTokens = readPositiveNumber(record.max_input_tokens ?? record.maxInputTokens);
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.filter((item): item is string => typeof item === 'string')
    : undefined;

  if (contextWindow !== undefined) {
    model.contextWindow = contextWindow;
  }
  if (maxInputTokens !== undefined) {
    model.maxInputTokens = maxInputTokens;
  }
  if (capabilities && capabilities.length > 0) {
    model.capabilities = capabilities;
  }

  return model;
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}
