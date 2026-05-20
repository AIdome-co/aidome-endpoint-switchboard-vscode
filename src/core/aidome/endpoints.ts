/**
 * AIdome API endpoints.
 */

import { httpGet } from '../../util/http';
import { Logger } from '../../util/log';
import { joinApiPath } from '../../util/apiUrl';
import { AIdomeCapabilities, AIdomeProvider, AIdomeModel, AIdomeWhoAmI, AIdomeError } from './types';

/**
 * API endpoint path constants.
 */
export const AIDOME_ENDPOINTS = {
  CAPABILITIES: '/v1/capabilities',
  PROVIDERS: '/v1/providers',
  MODELS: '/v1/models',
  WHOAMI: '/v1/whoami'
} as const;

export type AIdomeEndpoint = typeof AIDOME_ENDPOINTS[keyof typeof AIDOME_ENDPOINTS];

/**
 * Fetches capabilities from AIdome.
 * @param baseUrl Base URL of AIdome instance
 * @param authToken Authentication token
 * @returns Promise resolving to capabilities
 */
export async function getCapabilities(
  baseUrl: string,
  authToken?: string
): Promise<AIdomeCapabilities> {
  const logger = Logger.getInstance();
  const url = joinApiPath(baseUrl, AIDOME_ENDPOINTS.CAPABILITIES);
  
  try {
    logger.debug(`Fetching capabilities from ${baseUrl}`);
    
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const result = await httpGet<AIdomeCapabilities>(url, headers);
    logger.debug('Capabilities fetched successfully');
    return result;
  } catch (error) {
    logger.error('Failed to fetch capabilities', error instanceof Error ? error : undefined);
    throw wrapError(error, 'Failed to fetch capabilities');
  }
}

/**
 * Fetches providers from AIdome.
 * @param baseUrl Base URL of AIdome instance
 * @param authToken Authentication token
 * @returns Promise resolving to provider list
 */
export async function getProviders(
  baseUrl: string,
  authToken?: string
): Promise<AIdomeProvider[]> {
  const logger = Logger.getInstance();
  const url = joinApiPath(baseUrl, AIDOME_ENDPOINTS.PROVIDERS);
  
  try {
    logger.debug(`Fetching providers from ${baseUrl}`);
    
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const result = await httpGet<AIdomeProvider[]>(url, headers);
    logger.debug(`Fetched ${result.length} providers`);
    return result;
  } catch (error) {
    logger.error('Failed to fetch providers', error instanceof Error ? error : undefined);
    throw wrapError(error, 'Failed to fetch providers');
  }
}

/**
 * Fetches models from AIdome.
 * @param baseUrl Base URL of AIdome instance
 * @param authToken Authentication token
 * @returns Promise resolving to model list
 */
export async function getModels(
  baseUrl: string,
  authToken?: string
): Promise<AIdomeModel[]> {
  const logger = Logger.getInstance();
  const url = joinApiPath(baseUrl, AIDOME_ENDPOINTS.MODELS);
  
  try {
    logger.debug(`Fetching models from ${baseUrl}`);
    
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const result = await httpGet<AIdomeModel[]>(url, headers);
    logger.debug(`Fetched ${result.length} models`);
    return result;
  } catch (error) {
    logger.error('Failed to fetch models', error instanceof Error ? error : undefined);
    throw wrapError(error, 'Failed to fetch models');
  }
}

/**
 * Fetches WhoAmI information from AIdome.
 * @param baseUrl Base URL of AIdome instance
 * @param authToken Authentication token
 * @returns Promise resolving to WhoAmI info
 */
export async function getWhoAmI(
  baseUrl: string,
  authToken?: string
): Promise<AIdomeWhoAmI> {
  const logger = Logger.getInstance();
  const url = joinApiPath(baseUrl, AIDOME_ENDPOINTS.WHOAMI);
  
  try {
    logger.debug(`Fetching WhoAmI from ${baseUrl}`);
    
    const headers: Record<string, string> = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }
    
    const result = await httpGet<AIdomeWhoAmI>(url, headers);
    logger.debug(`WhoAmI: tenant=${result.tenant}, user=${result.user}`);
    return result;
  } catch (error) {
    logger.error('Failed to fetch WhoAmI', error instanceof Error ? error : undefined);
    throw wrapError(error, 'Failed to fetch WhoAmI');
  }
}

/**
 * Wraps an error in an AIdomeError format.
 * @param error Original error
 * @param message Error message
 * @returns AIdomeError
 */
function wrapError(error: unknown, message: string): AIdomeError {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    return error as AIdomeError;
  }
  
  return {
    code: 'AIDOME_API_ERROR',
    message: message,
    details: {
      originalError: error instanceof Error ? error.message : String(error)
    }
  };
}
