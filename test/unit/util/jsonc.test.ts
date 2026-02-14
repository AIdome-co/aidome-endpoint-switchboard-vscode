/**
 * Unit tests for JSONC parser utilities
 */

import { describe, it, expect } from 'vitest';
import { parseJsonc, stringifyJsonc, safeParseJsonc } from '../../../src/util/jsonc';

describe('JSONC Parser Utilities', () => {
  describe('parseJsonc', () => {
    it('should handle URLs with // in string values', () => {
      const input = '{ "url": "https://api.example.com/v1" }';
      const result = parseJsonc<{ url: string }>(input);
      expect(result.url).toBe('https://api.example.com/v1');
    });

    it('should strip single-line comments correctly', () => {
      const input = '{\n  // This is a comment\n  "key": "value"\n}';
      const result = parseJsonc<{ key: string }>(input);
      expect(result.key).toBe('value');
    });

    it('should strip multi-line comments correctly', () => {
      const input = '{\n  /* comment */\n  "key": "value"\n}';
      const result = parseJsonc<{ key: string }>(input);
      expect(result.key).toBe('value');
    });

    it('should handle trailing commas', () => {
      const input = '{ "a": 1, "b": 2, }';
      const result = parseJsonc<{ a: number; b: number }>(input);
      expect(result.a).toBe(1);
      expect(result.b).toBe(2);
    });

    it('should handle complex config with URLs and comments', () => {
      const input = `{
  // This is a Continue config
  "models": [
    {
      "title": "GPT-4",
      "provider": "openai",
      // This is the base URL
      "baseUrl": "https://api.example.com/v1/openai"
    }
  ],
  /* Multi-line comment
     with more content */
  "tabAutocompleteModel": {
    "title": "Claude",
    "apiBase": "https://gateway.example.com/v1/anthropic"
  }
}`;
      const result = parseJsonc<{
        models: Array<{ title: string; provider: string; baseUrl: string }>;
        tabAutocompleteModel: { title: string; apiBase: string };
      }>(input);
      
      expect(result.models[0].baseUrl).toBe('https://api.example.com/v1/openai');
      expect(result.tabAutocompleteModel.apiBase).toBe('https://gateway.example.com/v1/anthropic');
    });

    it('should throw on invalid JSON', () => {
      const input = '{ "key": invalid }';
      expect(() => parseJsonc(input)).toThrow(SyntaxError);
    });

    it('should throw with meaningful error message', () => {
      const input = '{ "key": }';
      expect(() => parseJsonc(input)).toThrow(/JSONC parse error/);
    });
  });

  describe('stringifyJsonc', () => {
    it('should stringify objects with default indentation', () => {
      const obj = { key: 'value', num: 42 };
      const result = stringifyJsonc(obj);
      expect(result).toContain('"key": "value"');
      expect(result).toContain('"num": 42');
    });

    it('should stringify with custom indentation', () => {
      const obj = { key: 'value' };
      const result = stringifyJsonc(obj, 4);
      expect(result).toContain('    "key"');
    });
  });

  describe('safeParseJsonc', () => {
    it('should return parsed object on success', () => {
      const input = '{ "key": "value" }';
      const result = safeParseJsonc<{ key: string }>(input);
      expect(result).toEqual({ key: 'value' });
    });

    it('should return undefined on parse error', () => {
      const input = '{ invalid json }';
      const result = safeParseJsonc(input);
      expect(result).toBeUndefined();
    });

    it('should handle URLs without throwing', () => {
      const input = '{ "url": "https://api.example.com/v1" }';
      const result = safeParseJsonc<{ url: string }>(input);
      expect(result?.url).toBe('https://api.example.com/v1');
    });
  });
});
