/**
 * HTTP client for AIdome API.
 */

import { AIDOME_ENDPOINTS } from './endpoints';
import { AIdomeCapabilities, HealthResponse, ModelInfo } from './types';

/**
 * AIdome API client for communicating with the endpoint gateway.
 */
export class AIdomeClient {
  constructor(private baseUrl: string, private apiKey?: string) {}

  /**
   * Fetches capabilities from the AIdome gateway.
   * @returns Promise resolving to capabilities
   */
  async getCapabilities(): Promise<AIdomeCapabilities> {
    // Skeleton implementation
    throw new Error('Not implemented');
  }

  /**
   * Fetches available models from the AIdome gateway.
   * @returns Promise resolving to array of models
   */
  async getModels(): Promise<ModelInfo[]> {
    // Skeleton implementation
    throw new Error('Not implemented');
  }

  /**
   * Performs a health check on the AIdome gateway.
   * @returns Promise resolving to health status
   */
  async checkHealth(): Promise<HealthResponse> {
    // Skeleton implementation
    throw new Error('Not implemented');
  }

  /**
   * Validates a configuration against the AIdome gateway.
   * @param config Configuration to validate
   * @returns Promise resolving to validation result
   */
  async validateConfig(config: unknown): Promise<boolean> {
    // Skeleton implementation
    throw new Error('Not implemented');
  }

  /**
   * Makes an HTTP request to the AIdome gateway.
   * @param path API path
   * @param options Request options
   * @returns Promise resolving to response data
   */
  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string>)
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(url.toString(), {
      ...options,
      headers
    });

    if (!response.ok) {
      throw new Error(`AIdome API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as T;
  }
}
