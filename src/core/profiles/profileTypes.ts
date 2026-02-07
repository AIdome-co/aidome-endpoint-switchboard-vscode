/**
 * Type definitions for endpoint profiles.
 * Profiles manage different endpoint configurations (dev, staging, prod).
 */

/**
 * Profile type enumeration.
 */
export enum ProfileType {
  Development = 'development',
  Staging = 'staging',
  Production = 'production',
  Custom = 'custom'
}

/**
 * Mapping of an assistant to an endpoint.
 */
export interface AssistantMapping {
  assistantKey: string;
  endpointUrl: string;
  modelName?: string;
  apiKeySecret?: string;
}

/**
 * Endpoint profile configuration.
 */
export interface EndpointProfile {
  id: string;
  name: string;
  type: ProfileType;
  description?: string;
  baseUrl: string;
  mappings: AssistantMapping[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Profile storage metadata.
 */
export interface ProfileMetadata {
  version: string;
  lastSync: string;
  activeProfileId?: string;
}
