/**
 * Unit tests for redaction utilities
 */

import { describe, it, expect } from 'vitest';
import { redactString, redactApiKey, redactUrl, redactEnvVars } from '../../src/util/redact';

describe('Redaction Utilities', () => {
  describe('redactString', () => {
    it('should redact Bearer tokens', () => {
      const input = 'Authorization: Bearer sk-1234567890abcdef';
      const redacted = redactString(input);
      
      expect(redacted).toContain('Bearer ***');
      expect(redacted).not.toContain('sk-1234567890abcdef');
    });

    it('should redact OpenAI API keys (sk-...)', () => {
      const input = 'My key is sk-1234567890abcdefghijklmnopqrstuv';
      const redacted = redactString(input);
      
      expect(redacted).toContain('sk-1234***');
      expect(redacted).not.toContain('1234567890abcdefghijklmnopqrstuv');
    });

    it('should redact Anthropic API keys (sk-ant-...)', () => {
      const input = 'Key: sk-ant-api03-1234567890abcdefghijklmnopqrstuv';
      const redacted = redactString(input);
      
      expect(redacted).not.toContain('1234567890abcdefghijklmnopqrstuv');
    });

    it('should redact API key headers', () => {
      const input = 'x-api-key: abc123def456ghi789';
      const redacted = redactString(input);
      
      expect(redacted).toContain('x-api-key: ***');
      expect(redacted).not.toContain('abc123def456ghi789');
    });

    it('should redact password fields', () => {
      const input = 'password: mySecretPassword123';
      const redacted = redactString(input);
      
      expect(redacted).toContain('password: ***');
      expect(redacted).not.toContain('mySecretPassword123');
    });

    it('should redact token fields', () => {
      const input = 'token: 1234567890abcdefghijklmnop';
      const redacted = redactString(input);
      
      expect(redacted).toContain('token: ***');
    });

    it('should not redact short strings', () => {
      const input = 'Short text ABC123';
      const redacted = redactString(input);
      
      // Short alphanumeric strings should not be redacted
      expect(redacted).toBe(input);
    });

    it('should handle multiple secrets in one string', () => {
      const input = 'Bearer sk-123456 and api-key: abc123def456 and password: secret';
      const redacted = redactString(input);
      
      expect(redacted).toContain('Bearer ***');
      expect(redacted).toContain('api-key: ***');
      expect(redacted).toContain('password: ***');
      expect(redacted).not.toContain('sk-123456');
      expect(redacted).not.toContain('abc123def456');
      expect(redacted).not.toContain('secret');
    });

    it('should not have false negatives on real API keys', () => {
      const realKeys = [
        'sk-proj-abcdefghijklmnopqrstuvwxyz123456',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        'api_key=1234567890abcdefghijklmnopqrstuvwxyz'
      ];
      
      for (const key of realKeys) {
        const redacted = redactString(key);
        expect(redacted).not.toBe(key);
        expect(redacted).toContain('***');
      }
    });

    it('should NOT redact git commit SHAs', () => {
      const input = 'commit 41726bdff010cfdeac2cd7e21a30cd325daf124f';
      const result = redactString(input);
      expect(result).toContain('41726bdff010cfdeac2cd7e21a30cd325daf124f');
      expect(result).toBe(input);
    });

    it('should NOT redact UUIDs', () => {
      const input = 'id: 550e8400e29b41d4a716446655440000';
      const result = redactString(input);
      expect(result).toContain('550e8400e29b41d4a716446655440000');
      expect(result).toBe(input);
    });

    it('should still redact OpenAI keys', () => {
      const input = 'key: sk-abcdefghijklmnopqrstuvwxyz123456789';
      const result = redactString(input);
      expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456789');
      expect(result).toContain('***');
    });

    it('should still redact Bearer tokens', () => {
      const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test';
      const result = redactString(input);
      expect(result).toContain('Bearer ***');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9.test');
    });
  });

  describe('redactApiKey', () => {
    it('should redact API key showing only first 4 chars', () => {
      const key = 'sk-1234567890abcdef';
      const redacted = redactApiKey(key);
      
      expect(redacted).toMatch(/^sk-1\*+$/);
      expect(redacted.length).toBeGreaterThan(5);
    });

    it('should redact very short keys completely', () => {
      const key = 'abc';
      const redacted = redactApiKey(key);
      
      expect(redacted).toBe('***');
    });

    it('should allow custom visible character count', () => {
      const key = 'sk-1234567890';
      const redacted = redactApiKey(key, 7);
      
      expect(redacted).toMatch(/^sk-1234\*+$/);
    });
  });

  describe('redactUrl', () => {
    it('should strip all query parameters', () => {
      const url = 'https://api.example.com/v1/chat?api_key=secret123&model=gpt-4';
      const redacted = redactUrl(url);
      
      expect(redacted).toBe('https://api.example.com/v1/chat [query params redacted]');
      expect(redacted).not.toContain('api_key');
      expect(redacted).not.toContain('secret123');
    });

    it('should handle URLs without query params', () => {
      const url = 'https://api.example.com/v1/chat';
      const redacted = redactUrl(url);
      
      expect(redacted).toBe(url);
    });

    it('should strip embedded credentials from URLs', () => {
      const url = `https://${'user'}:${'token'}@api.example.com/v1/chat`;
      const redacted = redactUrl(url);

      expect(redacted).toBe('https://api.example.com/v1/chat [credentials redacted]');
      expect(redacted).not.toContain('user');
      expect(redacted).not.toContain('token');
    });

    it('should handle invalid URLs gracefully', () => {
      const url = 'not a valid url';
      const redacted = redactUrl(url);
      
      expect(redacted).toBe(url);
    });
  });

  describe('redactEnvVars', () => {
    it('should redact environment variable values', () => {
      const input = 'API_KEY=secret123 TOKEN=abc456';
      const redacted = redactEnvVars(input);
      
      expect(redacted).toContain('API_KEY=***');
      expect(redacted).toContain('TOKEN=***');
      expect(redacted).not.toContain('secret123');
      expect(redacted).not.toContain('abc456');
    });

    it('should handle custom env var names', () => {
      const input = 'CUSTOM_VAR=value123';
      const redacted = redactEnvVars(input, ['CUSTOM_VAR']);
      
      expect(redacted).toContain('CUSTOM_VAR=***');
      expect(redacted).not.toContain('value123');
    });

    it('should be case insensitive', () => {
      const input = 'api_key=secret';
      const redacted = redactEnvVars(input, ['API_KEY']);
      
      expect(redacted).toContain('***');
    });
  });
});
