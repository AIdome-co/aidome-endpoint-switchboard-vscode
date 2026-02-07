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
 * AIdome provider information.
 */
export interface AIdomeProvider {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'inactive';
  supportedModels: string[];
}

/**
 * Model information from AIdome (renamed from ModelInfo).
 */
export interface AIdomeModel {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  capabilities: string[];
}

/**
 * WhoAmI response from AIdome.
 */
export interface AIdomeWhoAmI {
  tenant: string;
  user: string;
  permissions: string[];
  quotas?: Record<string, number>;
}

/**
 * AIdome API error response.
 */
export interface AIdomeError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
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
