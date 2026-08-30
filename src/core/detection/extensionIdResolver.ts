/**
 * Extension ID resolution abstraction layer.
 *
 * Resolves the canonical VS Code extension ID(s) to use for detecting a given
 * assistant. The registry declares candidate IDs; this layer verifies them
 * against the marketplace and, when a declared ID is stale or wrong, resolves
 * the real ID from the market by display name. This prevents the class of bug
 * where a hardcoded extension ID (e.g. `CodeGPT.codegpt`) silently fails to
 * match an installed-and-enabled extension.
 */

import { AssistantEntry } from '../registry/registryTypes';
import { MarketplaceClient, MarketplaceExtension, MarketplaceUnavailableError } from './marketplace';

/** How an assistant's detection IDs were resolved. */
export type ResolutionStatus =
  | 'declared-valid'
  | 'resolved-from-market'
  | 'offline-fallback'
  | 'unresolvable';

/** Result of resolving detection IDs for a single assistant. */
export interface ExtensionIdResolution {
  assistantKey: string;
  displayName: string;
  /** IDs declared in the registry. */
  declaredIds: string[];
  /** Canonical IDs to use for detection. */
  resolvedIds: string[];
  status: ResolutionStatus;
  /** Human-readable detail about how resolution concluded. */
  detail?: string;
}

/** Aggregate result of validating every assistant in the registry. */
export interface RegistryValidationResult {
  resolutions: ExtensionIdResolution[];
  /** Non-fatal warnings (e.g. stale declared ID that resolved from market). */
  warnings: string[];
  /** Fatal problems (e.g. an assistant that cannot be resolved at all). */
  errors: string[];
  isValid: boolean;
}

/** Options controlling the strictness of registry validation. */
export interface RegistryValidationOptions {
  /**
   * Treat marketplace unavailability as a validation error instead of allowing
   * the runtime offline fallback.
   */
  requireMarketplace?: boolean;
}

/**
 * Resolves canonical marketplace extension IDs for assistant detection.
 */
export class ExtensionIdResolver {
  private readonly resolutionCache = new Map<string, Promise<ExtensionIdResolution>>();

  constructor(private readonly client: MarketplaceClient = new MarketplaceClient()) {}

  /**
   * Resolves the detection IDs for a single assistant.
   *
   * Strategy:
   *  1. If any declared ID exists on the marketplace, it is valid — use it.
   *  2. Otherwise search the market by display name and use the top strong
   *     match (marketplace relevance ranking).
   *  3. If the market is unreachable, fall back to the declared IDs so
   *     detection can still attempt them offline.
   *
   * @param entry The assistant registry entry.
   */
  async resolveForAssistant(entry: AssistantEntry): Promise<ExtensionIdResolution> {
    const declaredIds = [...(entry.detection.vscodeExtensionIds ?? [])];
    const cacheKey = JSON.stringify([entry.key, entry.displayName, declaredIds]);
    const cached = this.resolutionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const pending = this.resolveForAssistantUncached(entry, declaredIds);
    this.resolutionCache.set(cacheKey, pending);
    void pending.catch(() => {
      if (this.resolutionCache.get(cacheKey) === pending) {
        this.resolutionCache.delete(cacheKey);
      }
    });
    return pending;
  }

  private async resolveForAssistantUncached(
    entry: AssistantEntry,
    declaredIds: string[]
  ): Promise<ExtensionIdResolution> {
    const base = {
      assistantKey: entry.key,
      displayName: entry.displayName,
      declaredIds
    };

    // 1. Trust a declared ID if it resolves on the market.
    for (const id of declaredIds) {
      const found = await this.lookupSafe(id);
      if (found === 'offline') {
        return this.offlineFallback(base);
      }
      if (found) {
        return { ...base, resolvedIds: [id], status: 'declared-valid' };
      }
    }

    // 2. No declared ID is valid — resolve the real name from the market.
    try {
      const matches = await this.client.searchByDisplayName(entry.displayName);
      const match = matches.find((candidate) => this.isStrongMatch(candidate, entry.displayName));
      if (match) {
        return {
          ...base,
          resolvedIds: [match.id],
          status: 'resolved-from-market',
          detail: `declared ${declaredIds.length ? declaredIds.join(', ') : '(none)'} not found; resolved ${match.id} from display name '${entry.displayName}'`
        };
      }
    } catch (error) {
      if (error instanceof MarketplaceUnavailableError) {
        return this.offlineFallback(base);
      }
    }

    // 3. No declared ID valid and no market match — unresolvable.
    return {
      ...base,
      resolvedIds: declaredIds,
      status: 'unresolvable',
      detail: `could not resolve an extension ID for '${entry.displayName}' on the marketplace`
    };
  }

  /**
   * Validates every assistant in the registry that relies on VS Code extension
   * detection, returning a report suitable for a CI/build gate.
   */
  async validateRegistry(
    assistants: AssistantEntry[],
    options: RegistryValidationOptions = {}
  ): Promise<RegistryValidationResult> {
    const resolutions: ExtensionIdResolution[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const entry of assistants) {
      const hasExtensionIds = (entry.detection.vscodeExtensionIds ?? []).length > 0;
      if (!hasExtensionIds) {
        continue;
      }

      const resolution = await this.resolveForAssistant(entry);
      resolutions.push(resolution);

      switch (resolution.status) {
        case 'declared-valid':
          break;
        case 'resolved-from-market':
          warnings.push(
            `Assistant '${entry.key}': declared ID(s) not found on the market ` +
            `(${resolution.declaredIds.join(', ') || 'none'}) — resolved ${resolution.resolvedIds.join(', ')} by display name. ` +
            `Consider updating the registry to the canonical ID.`
          );
          break;
        case 'offline-fallback':
          warnings.push(
            `Assistant '${entry.key}': marketplace unreachable; could not validate IDs. Declared ID(s) used as-is.`
          );
          if (options.requireMarketplace) {
            errors.push(
              `Assistant '${entry.key}': marketplace was unavailable, so declared extension ID(s) ` +
              `(${resolution.declaredIds.join(', ') || 'none'}) could not be validated.`
            );
          }
          break;
        case 'unresolvable':
          errors.push(
            `Assistant '${entry.key}': none of the declared ID(s) ` +
            `(${resolution.declaredIds.join(', ') || 'none'}) exist on the marketplace and no display-name match ` +
            `was found for '${entry.displayName}'.`
          );
          break;
      }
    }

    return { resolutions, warnings, errors, isValid: errors.length === 0 };
  }

  /**
   * Looks up a declared ID, distinguishing a clean miss from an offline market.
   * Returns the extension, the string 'offline', or undefined.
   */
  private async lookupSafe(id: string): Promise<MarketplaceExtension | 'offline' | undefined> {
    try {
      return await this.client.getExtensionById(id);
    } catch (error) {
      if (error instanceof MarketplaceUnavailableError) {
        return 'offline';
      }
      return undefined;
    }
  }

  private offlineFallback(base: {
    assistantKey: string;
    displayName: string;
    declaredIds: string[];
  }): ExtensionIdResolution {
    return {
      ...base,
      resolvedIds: base.declaredIds,
      status: base.declaredIds.length ? 'offline-fallback' : 'unresolvable',
      detail: 'marketplace unreachable; fell back to declared extension ID(s)'
    };
  }

  /**
   * Normalizes a name for case/format-insensitive comparison.
   */
  private normalize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Returns true when a marketplace candidate is a strong match for a search term,
   * based on display name or extension name prefix. Relies on the marketplace's
   * relevance ordering to surface the canonical/flagship extension first.
   */
  private isStrongMatch(ext: MarketplaceExtension, term: string): boolean {
    const normalizedTerm = this.normalize(term);
    if (!normalizedTerm) {
      return false;
    }
    return (
      this.normalize(ext.displayName).startsWith(normalizedTerm) ||
      this.normalize(ext.extensionName).startsWith(normalizedTerm) ||
      this.normalize(ext.extensionName) === normalizedTerm
    );
  }
}
