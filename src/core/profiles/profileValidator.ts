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
 * Validates a user-entered endpoint URL for create/edit prompts.
 * Allows any parseable http/https URL while rejecting unsafe or irrelevant schemes.
 * @param url The URL to validate
 * @returns True if valid for user input, false otherwise
 */
export function validateInputUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.toLowerCase();

    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Validates an endpoint URL.
 * Rejects dangerous schemes like javascript:, data:, file:.
 * @param url The URL to validate
 * @returns True if valid, false otherwise
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Reject dangerous schemes
    const dangerousSchemes = ['javascript:', 'data:', 'file:', 'ftp:'];
    if (dangerousSchemes.includes(parsed.protocol.toLowerCase())) {
      return false;
    }
    
    // Only allow https or http://localhost for dev
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
 * Only alphanumeric, hyphens, underscores. Max 64 chars.
 * @param name The profile name
 * @returns True if valid, false otherwise
 */
export function validateProfileName(name: string): boolean {
  if (!name || name.length === 0 || name.length > 64) {
    return false;
  }
  
  // Only allow alphanumeric, hyphens, underscores
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(name);
}

/**
 * Validates a file path to prevent path traversal attacks.
 * @param filePath The file path to validate
 * @returns True if valid, false otherwise
 */
export function validatePath(filePath: string): boolean {
  // Reject paths with .. traversal
  if (filePath.includes('..')) {
    return false;
  }
  
  // Reject paths with null bytes
  if (filePath.includes('\0')) {
    return false;
  }
  
  return true;
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
    errors.push('Profile name is required and must be alphanumeric with hyphens/underscores only (max 64 chars)');
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
