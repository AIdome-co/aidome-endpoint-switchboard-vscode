/**
 * Type definitions for endpoint profiles.
 * Profiles manage different endpoint configurations (AIdome vs custom).
 */

import { Dialect } from '../dialects/dialectTypes';
import { AIdomeCapabilities } from '../aidome/types';

/**
 * Profile type: AIdome gateway or custom endpoint.
 */
export type ProfileType = 'aidome' | 'custom';

/**
 * Mapping of an assistant to an endpoint profile.
 */
export interface AssistantMapping {
  assistantKey: string;
  profileName: string;
  appliedMode: 'settings' | 'configFile' | 'env' | 'guided';
  appliedAt: string;
}

/**
 * Endpoint profile configuration.
 */
export interface EndpointProfile {
  id: string;
  name: string;
  profileType: ProfileType;
  baseUrl: string;
  dialect: Dialect;
  authRef?: string; // SecretStorage key reference
  tenant?: string;
  lastVerified?: string;
  capabilitiesCache?: AIdomeCapabilities;
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
