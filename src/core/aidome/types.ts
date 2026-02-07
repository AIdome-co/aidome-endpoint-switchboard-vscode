/**
 * Type definitions for AIdome API responses.
 */

/**
 * AIdome capabilities response.
 */
export interface AIdomeCapabilities {
  version: string;
  supportedDialects: string[];
  supportedModels: string[];
  features: string[];
  endpoints: Record<string, string>;
}

/**
 * Model information from AIdome.
 */
export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
}

/**
 * Health check response.
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
}

/**
 * Configuration validation response.
 */
export interface ValidationResponse {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}
