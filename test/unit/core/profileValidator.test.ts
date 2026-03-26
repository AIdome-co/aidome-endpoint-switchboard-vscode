/**
 * Unit tests for profile validator.
 */

import { describe, it, expect } from 'vitest';
import {
  validateUrl,
  validateProfileName,
  validatePath,
  validateCaCertPath,
  validateProfile,
  validateApiKey,
  sanitizeUrl
} from '../../../src/core/profiles/profileValidator';

describe('ProfileValidator', () => {
  describe('validateUrl', () => {
    it('should accept valid https URLs', () => {
      expect(validateUrl('https://api.aidome.cloud')).toBe(true);
      expect(validateUrl('https://example.com/v1/api')).toBe(true);
      expect(validateUrl('https://subdomain.example.com:8080/path')).toBe(true);
    });

    it('should accept http://localhost URLs', () => {
      expect(validateUrl('http://localhost')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
      expect(validateUrl('http://localhost:8080/api')).toBe(true);
    });

    it('should accept http://127.0.0.1 URLs', () => {
      expect(validateUrl('http://127.0.0.1')).toBe(true);
      expect(validateUrl('http://127.0.0.1:3000')).toBe(true);
      expect(validateUrl('http://127.0.0.1:8080/api')).toBe(true);
    });

    it('should reject javascript: URLs', () => {
      expect(validateUrl('javascript:alert(1)')).toBe(false);
      expect(validateUrl('JavaScript:void(0)')).toBe(false);
    });

    it('should reject data: URLs', () => {
      expect(validateUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
      expect(validateUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    });

    it('should reject file: URLs', () => {
      expect(validateUrl('file:///etc/passwd')).toBe(false);
      expect(validateUrl('file:///C:/Windows/System32')).toBe(false);
    });

    it('should reject ftp: URLs', () => {
      expect(validateUrl('ftp://example.com')).toBe(false);
    });

    it('should reject http:// for non-localhost', () => {
      expect(validateUrl('http://example.com')).toBe(false);
      expect(validateUrl('http://api.aidome.cloud')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('not-a-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
      expect(validateUrl('//example.com')).toBe(false);
    });
  });

  describe('validateProfileName', () => {
    it('should accept valid profile names', () => {
      expect(validateProfileName('aidome-prod')).toBe(true);
      expect(validateProfileName('aidome_dev')).toBe(true);
      expect(validateProfileName('profile123')).toBe(true);
      expect(validateProfileName('my-profile_v2')).toBe(true);
    });

    it('should reject empty names', () => {
      expect(validateProfileName('')).toBe(false);
    });

    it('should reject names with spaces', () => {
      expect(validateProfileName('my profile')).toBe(false);
    });

    it('should reject names with special characters', () => {
      expect(validateProfileName('profile@123')).toBe(false);
      expect(validateProfileName('profile.name')).toBe(false);
      expect(validateProfileName('profile/name')).toBe(false);
      expect(validateProfileName('profile\\name')).toBe(false);
    });

    it('should reject names longer than 64 characters', () => {
      const longName = 'a'.repeat(65);
      expect(validateProfileName(longName)).toBe(false);
    });

    it('should accept names exactly 64 characters', () => {
      const maxName = 'a'.repeat(64);
      expect(validateProfileName(maxName)).toBe(true);
    });
  });

  describe('validatePath', () => {
    it('should accept valid paths', () => {
      expect(validatePath('/home/user/config.json')).toBe(true);
      expect(validatePath('C:\\Users\\user\\config.json')).toBe(true);
      expect(validatePath('./config/settings.json')).toBe(true);
    });

    it('should reject paths with .. traversal', () => {
      expect(validatePath('../../../etc/passwd')).toBe(false);
      expect(validatePath('/home/user/../../../etc/passwd')).toBe(false);
      expect(validatePath('..\\..\\Windows\\System32')).toBe(false);
    });

    it('should reject paths with null bytes', () => {
      expect(validatePath('/path/to/file\0.txt')).toBe(false);
      expect(validatePath('config\0.json')).toBe(false);
    });
  });

  describe('validateCaCertPath', () => {
    it('should accept valid .pem paths', () => {
      expect(validateCaCertPath('/etc/ssl/certs/ca.pem')).toBe(true);
      expect(validateCaCertPath('C:\\certs\\enterprise-ca.pem')).toBe(true);
    });

    it('should accept valid .crt paths', () => {
      expect(validateCaCertPath('/usr/local/share/ca-certificates/my-ca.crt')).toBe(true);
    });

    it('should accept valid .cer paths', () => {
      expect(validateCaCertPath('/home/user/certs/root.cer')).toBe(true);
    });

    it('should accept valid .ca-bundle paths', () => {
      expect(validateCaCertPath('/etc/pki/tls/certs/ca-bundle.ca-bundle')).toBe(true);
    });

    it('should reject empty string', () => {
      expect(validateCaCertPath('')).toBe(false);
    });

    it('should reject paths with unrecognized extensions', () => {
      expect(validateCaCertPath('/etc/ssl/certs/ca.txt')).toBe(false);
      expect(validateCaCertPath('/etc/ssl/certs/ca.json')).toBe(false);
      expect(validateCaCertPath('/etc/ssl/certs/ca')).toBe(false);
    });

    it('should reject paths with .. traversal', () => {
      expect(validateCaCertPath('../../../etc/ssl/ca.pem')).toBe(false);
    });

    it('should reject paths with null bytes', () => {
      expect(validateCaCertPath('/certs/ca\0.pem')).toBe(false);
    });
  });

  describe('validateProfile', () => {
    it('should validate a complete valid profile', () => {
      const profile = {
        name: 'aidome-prod',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        profileType: 'aidome' as const,
        tenant: 'my-org'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should require profile name', () => {
      const profile = {
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Profile name is required'))).toBe(true);
    });

    it('should require valid profile name format', () => {
      const profile = {
        name: 'invalid profile!',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('alphanumeric'))).toBe(true);
    });

    it('should require base URL', () => {
      const profile = {
        name: 'my-profile',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Base URL is required'))).toBe(true);
    });

    it('should require valid base URL', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'javascript:alert(1)',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('https://'))).toBe(true);
    });

    it('should require dialect', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Dialect is required'))).toBe(true);
    });

    it('should warn about non-https non-localhost URLs', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'http://example.com',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      // This would fail URL validation, so it's an error not a warning
      expect(result.valid).toBe(false);
    });

    it('should warn about AIdome profiles without tenant', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        profileType: 'aidome' as const
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('tenant'))).toBe(true);
    });

    it('should accept localhost URLs', () => {
      const profile = {
        name: 'local-dev',
        baseUrl: 'http://localhost:3000',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(true);
    });

    it('should accept a profile with a valid caCertPath', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        caCertPath: '/etc/ssl/certs/my-ca.pem'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should accept a profile with no caCertPath', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(true);
    });

    it('should reject a profile with an invalid caCertPath', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        caCertPath: '../../../etc/passwd'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('CA certificate path'))).toBe(true);
    });

    it('should reject a profile with a caCertPath having an unrecognized extension', () => {
      const profile = {
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        caCertPath: '/etc/ssl/certs/ca.txt'
      };

      const result = validateProfile(profile);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('CA certificate path'))).toBe(true);
    });
  });

  describe('validateApiKey', () => {
    it('should accept valid API keys', () => {
      expect(validateApiKey('sk-1234567890abcdef')).toBe(true);
      expect(validateApiKey('Bearer abc123xyz')).toBe(true);
      expect(validateApiKey('a'.repeat(32))).toBe(true);
    });

    it('should reject short API keys', () => {
      expect(validateApiKey('short')).toBe(false);
      expect(validateApiKey('1234567')).toBe(false);
    });

    it('should reject extremely long API keys', () => {
      expect(validateApiKey('a'.repeat(513))).toBe(false);
    });

    it('should accept exactly 8 characters', () => {
      expect(validateApiKey('12345678')).toBe(true);
    });

    it('should accept exactly 512 characters', () => {
      expect(validateApiKey('a'.repeat(512))).toBe(true);
    });
  });

  describe('sanitizeUrl', () => {
    it('should remove api_key parameter', () => {
      const url = 'https://api.example.com/v1?api_key=secret123&other=value';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).not.toContain('secret123');
      expect(sanitized).toContain('other=value');
    });

    it('should remove apiKey parameter', () => {
      const url = 'https://api.example.com/v1?apiKey=secret123';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).not.toContain('secret123');
    });

    it('should remove token parameter', () => {
      const url = 'https://api.example.com/v1?token=bearer_xyz';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).not.toContain('bearer_xyz');
    });

    it('should remove secret parameter', () => {
      const url = 'https://api.example.com/v1?secret=mysecret';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).not.toContain('mysecret');
    });

    it('should handle multiple sensitive parameters', () => {
      const url = 'https://api.example.com/v1?api_key=key1&token=tok1&other=safe';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).not.toContain('key1');
      expect(sanitized).not.toContain('tok1');
      expect(sanitized).toContain('other=safe');
    });

    it('should handle URLs without query parameters', () => {
      const url = 'https://api.example.com/v1';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).toBe(url);
    });

    it('should handle invalid URLs gracefully', () => {
      const url = 'not-a-url';
      const sanitized = sanitizeUrl(url);
      expect(sanitized).toBe(url);
    });
  });
});
