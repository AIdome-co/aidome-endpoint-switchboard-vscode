/**
 * Profile validation utilities.
 */

import { EndpointProfile } from './profileTypes';

/**
 * Validation result.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates an endpoint URL.
 * @param url The URL to validate
 * @returns True if valid, false otherwise
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Must be https or http://localhost for dev
    return (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && 
       (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    );
  } catch {
    return false;
  }
}

/**
 * Validates a profile name.
 * @param name The profile name
 * @returns True if valid, false otherwise
 */
export function validateProfileName(name: string): boolean {
  return name.length > 0 && name.length <= 100;
}

/**
 * Validates a complete profile.
 * @param profile The profile to validate
 * @returns Validation result
 */
export function validateProfile(profile: Partial<EndpointProfile>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!profile.name || !validateProfileName(profile.name)) {
    errors.push('Profile name is required and must be 1-100 characters');
  }

  if (!profile.baseUrl) {
    errors.push('Base URL is required');
  } else if (!validateUrl(profile.baseUrl)) {
    errors.push('Base URL must be https:// or http://localhost for development');
  }

  if (!profile.dialect) {
    errors.push('Dialect is required');
  }

  // Warnings
  if (profile.baseUrl && profile.baseUrl.startsWith('http://') && 
      !profile.baseUrl.includes('localhost') && !profile.baseUrl.includes('127.0.0.1')) {
    warnings.push('Using http:// (not https://) for non-localhost URL may be insecure');
  }

  if (profile.profileType === 'aidome' && !profile.tenant) {
    warnings.push('AIdome profiles typically have a tenant specified');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validates an API key format.
 * @param apiKey The API key to validate
 * @returns True if valid, false otherwise
 */
export function validateApiKey(apiKey: string): boolean {
  // Basic validation - non-empty and reasonable length
  return apiKey.length >= 8 && apiKey.length <= 512;
}

/**
 * Sanitizes a URL for display (removes sensitive query params).
 * @param url The URL to sanitize
 * @returns Sanitized URL string
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Remove common sensitive parameters
    parsed.searchParams.delete('api_key');
    parsed.searchParams.delete('apiKey');
    parsed.searchParams.delete('token');
    parsed.searchParams.delete('secret');
    return parsed.toString();
  } catch {
    return url;
  }
}
