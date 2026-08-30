/**
 * VS Code Marketplace client.
 *
 * Queries the marketplace gallery API to resolve and validate VS Code
 * extension IDs. Used by the detection abstraction layer (ExtensionIdResolver)
 * so that assistant extension IDs are sourced from the market rather than
 * trusted blindly from a hardcoded list.
 */

import { httpRequest } from '../../util/http';

/** Base URL of the VS Code marketplace gallery query API. */
const GALLERY_API_URL =
  'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

/**
 * Thrown when the marketplace is unreachable (network error / HTTP failure),
 * so callers can distinguish "offline / cannot verify" from a clean
 * "extension not found".
 */
export class MarketplaceUnavailableError extends Error {
  constructor(message?: string) {
    super(message ?? 'VS Code marketplace is unreachable');
    this.name = 'MarketplaceUnavailableError';
  }
}

/** Canonical, normalized representation of a marketplace extension. */
export interface MarketplaceExtension {
  /** Fully qualified ID in `publisher.extensionName` form. */
  id: string;
  displayName: string;
  extensionName: string;
  version?: string;
}

/** Raw shape returned by the marketplace gallery API (subset we need). */
interface GalleryResponse {
  results?: Array<{ extensions?: GalleryExtension[] }>;
}

interface GalleryExtension {
  publisher?: { publisherName?: string };
  extensionName?: string;
  displayName?: string;
  versions?: Array<{ version?: string }>;
}

/** HTTP options used for marketplace calls — short timeout so detection stays snappy. */
const UNRECOVERABLE_STATUS_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json;api-version=3.0-preview.1',
  'User-Agent': 'AIdome-Switchboard-VSCode/1.0'
} as const;

/** Runtime options for the marketplace client. */
export interface MarketplaceClientOptions {
  /** Request timeout in milliseconds. */
  timeoutMs?: number;
  /** Number of retries after the initial request. */
  retries?: number;
}

/**
 * Client for the VS Code marketplace gallery query API.
 */
export class MarketplaceClient {
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: MarketplaceClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.retries = options.retries ?? 0;
  }

  /**
   * Looks up an extension by its fully qualified marketplace ID.
   * @param id Extension ID in `publisher.extensionName` form.
   * @returns The extension, or undefined if it does not exist on the marketplace.
   * @throws {MarketplaceUnavailableError} if the marketplace cannot be reached.
   */
  async getExtensionById(id: string): Promise<MarketplaceExtension | undefined> {
    const extensions = await this.query(
      [{ filterType: 7, value: id }],
      1
    );
    return extensions[0];
  }

  /**
   * Searches the marketplace by display name / free text.
   * @param name Search term (typically an assistant display name).
   * @returns Matching extensions in marketplace relevance order.
   * @throws {MarketplaceUnavailableError} if the marketplace cannot be reached.
   */
  async searchByDisplayName(name: string): Promise<MarketplaceExtension[]> {
    return this.query([{ filterType: 10, value: name }], 20);
  }

  /**
   * Runs a gallery extensionquery call.
   */
  private async query(
    criteria: Array<{ filterType: number; value: string }>,
    pageSize: number
  ): Promise<MarketplaceExtension[]> {
    let response: { body: GalleryResponse };
    try {
      response = await httpRequest<GalleryResponse>(GALLERY_API_URL, {
        method: 'POST',
        headers: { ...UNRECOVERABLE_STATUS_HEADERS },
        body: {
          filters: [{ criteria, pageNumber: 1, pageSize }],
          flags: 914
        },
        timeout: this.timeoutMs,
        retries: this.retries
      });
    } catch (error) {
      throw new MarketplaceUnavailableError(
        error instanceof Error ? error.message : String(error)
      );
    }

    const extensions = response.body?.results?.[0]?.extensions ?? [];
    return extensions.map((ext) => this.toExtension(ext)).filter(
      (ext): ext is MarketplaceExtension => ext !== undefined
    );
  }

  private toExtension(raw: GalleryExtension): MarketplaceExtension | undefined {
    const publisher = raw.publisher?.publisherName;
    const extensionName = raw.extensionName;
    if (!publisher || !extensionName) {
      return undefined;
    }
    return {
      id: `${publisher}.${extensionName}`,
      displayName: raw.displayName ?? extensionName,
      extensionName,
      version: raw.versions?.[0]?.version
    };
  }
}
