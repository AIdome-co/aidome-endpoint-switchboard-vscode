/**
 * AIdome API endpoints.
 */

export const AIDOME_ENDPOINTS = {
  CAPABILITIES: '/api/v1/capabilities',
  MODELS: '/api/v1/models',
  HEALTH: '/api/v1/health',
  VALIDATE_CONFIG: '/api/v1/validate-config'
} as const;

export type AIdomeEndpoint = typeof AIDOME_ENDPOINTS[keyof typeof AIDOME_ENDPOINTS];
