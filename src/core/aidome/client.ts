/**
 * HTTP client for AIdome API.
 */

import { EndpointProfile } from '../profiles/profileTypes';
import { Logger } from '../../util/log';
import { AIdomeCapabilities, AIdomeProvider, AIdomeModel, AIdomeWhoAmI } from './types';
import * as endpoints from './endpoints';
import { Cache } from './cache';
import { getRuntimeSettings } from '../../config/runtimeSettings';

/**
 * AIdome API client for communicating with the endpoint gateway.
 */
export class AIdomeClient {
  private baseUrl: string;
  private authToken?: string;
  private profileName: string;
  private cache: Cache;
  private logger: Logger;

  constructor(profile: EndpointProfile, authToken?: string) {
    this.baseUrl = profile.baseUrl;
    this.authToken = authToken;
    this.profileName = profile.name;
    this.cache = new Cache(getRuntimeSettings().aidomeClientCacheTtlMs);
    this.logger = Logger.getInstance();
  }

  /**
   * Fetches capabilities from the AIdome gateway.
   * @returns Promise resolving to capabilities
   */
  async getCapabilities(): Promise<AIdomeCapabilities> {
    const cacheKey = `${this.profileName}:${endpoints.AIDOME_ENDPOINTS.CAPABILITIES}`;
    
    // Check cache first
    const cached = this.cache.get<AIdomeCapabilities>(cacheKey);
    if (cached) {
      this.logger.debug(`Using cached capabilities for ${this.profileName}`);
      return cached;
    }
    
    // Fetch from API
    this.logger.debug(`Fetching capabilities for ${this.profileName}`);
    const result = await endpoints.getCapabilities(this.baseUrl, this.authToken);
    
    // Cache the result
    this.cache.set(cacheKey, result);
    
    return result;
  }

  /**
   * Fetches available providers from the AIdome gateway.
   * @returns Promise resolving to array of providers
   */
  async getProviders(): Promise<AIdomeProvider[]> {
    this.logger.debug(`Fetching providers for ${this.profileName}`);
    return endpoints.getProviders(this.baseUrl, this.authToken);
  }

  /**
   * Fetches available models from the AIdome gateway.
   * @returns Promise resolving to array of models
   */
  async getModels(): Promise<AIdomeModel[]> {
    this.logger.debug(`Fetching models for ${this.profileName}`);
    return endpoints.getModels(this.baseUrl, this.authToken);
  }

  /**
   * Fetches WhoAmI information from the AIdome gateway.
   * @returns Promise resolving to WhoAmI info
   */
  async whoAmI(): Promise<AIdomeWhoAmI> {
    this.logger.debug(`Fetching WhoAmI for ${this.profileName}`);
    return endpoints.getWhoAmI(this.baseUrl, this.authToken);
  }

  /**
   * Clears the cache for this client.
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug(`Cache cleared for ${this.profileName}`);
  }

  /**
   * Invalidates a specific cache entry.
   * @param endpointPath The endpoint path to invalidate
   */
  invalidateCache(endpointPath: string): void {
    const cacheKey = `${this.profileName}:${endpointPath}`;
    this.cache.invalidate(cacheKey);
    this.logger.debug(`Cache invalidated for ${cacheKey}`);
  }
}
