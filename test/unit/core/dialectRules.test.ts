/**
 * Unit tests for src/core/dialects/dialectRules.ts
 */

import { describe, it, expect } from 'vitest';
import {
  checkDialectCompatibility,
  getRecommendedGatewayDialect,
  getDialectRule,
  getAllDialectRules,
} from '../../../src/core/dialects/dialectRules';

describe('checkDialectCompatibility', () => {
  it('same dialect is always compatible without translation', () => {
    const result = checkDialectCompatibility('openai.chat_completions', 'openai.chat_completions');
    expect(result.compatible).toBe(true);
    expect(result.requiresTranslation).toBe(false);
  });

  it('openai dialects are compatible with each other (requires translation)', () => {
    const result = checkDialectCompatibility('openai.chat_completions', 'openai.responses');
    expect(result.compatible).toBe(true);
    expect(result.requiresTranslation).toBe(true);
    expect(result.notes).toContain('OpenAI');
  });

  it('different dialect families are not compatible', () => {
    const result = checkDialectCompatibility('openai.chat_completions', 'anthropic.messages');
    expect(result.compatible).toBe(false);
    expect(result.requiresTranslation).toBe(false);
  });

  it('anthropic to google is not compatible', () => {
    const result = checkDialectCompatibility('anthropic.messages', 'google.gemini.generate_content');
    expect(result.compatible).toBe(false);
  });

  it('preserves source and target in result', () => {
    const result = checkDialectCompatibility('anthropic.messages', 'openai.chat_completions');
    expect(result.sourceDialect).toBe('anthropic.messages');
    expect(result.targetDialect).toBe('openai.chat_completions');
  });
});

describe('getRecommendedGatewayDialect', () => {
  it('recommends openai.chat_completions for openai dialects', () => {
    expect(getRecommendedGatewayDialect('openai.chat_completions')).toBe('openai.chat_completions');
    expect(getRecommendedGatewayDialect('openai.responses')).toBe('openai.chat_completions');
  });

  it('returns the same dialect for non-openai dialects', () => {
    expect(getRecommendedGatewayDialect('anthropic.messages')).toBe('anthropic.messages');
    expect(getRecommendedGatewayDialect('google.gemini.generate_content')).toBe('google.gemini.generate_content');
  });
});

describe('getDialectRule', () => {
  it('returns correct rule for openai.chat_completions', () => {
    const rule = getDialectRule('openai.chat_completions');
    expect(rule.dialect).toBe('openai.chat_completions');
    expect(rule.requiredEndpoints).toContain('/v1/chat/completions');
    expect(rule.authScheme).toBe('bearer');
    expect(rule.supportsStreaming).toBe(true);
  });

  it('returns correct rule for openai.responses', () => {
    const rule = getDialectRule('openai.responses');
    expect(rule.dialect).toBe('openai.responses');
    expect(rule.requiredEndpoints).toContain('/v1/responses');
    expect(rule.authScheme).toBe('bearer');
    expect(rule.supportsStreaming).toBe(false);
  });

  it('returns correct rule for anthropic.messages', () => {
    const rule = getDialectRule('anthropic.messages');
    expect(rule.dialect).toBe('anthropic.messages');
    expect(rule.requiredEndpoints).toContain('/v1/messages');
    expect(rule.authScheme).toBe('api-key-header');
    expect(rule.supportsStreaming).toBe(true);
    expect(rule.requiredHeaders?.['anthropic-version']).toBe('2023-06-01');
  });

  it('returns correct rule for google.gemini.generate_content', () => {
    const rule = getDialectRule('google.gemini.generate_content');
    expect(rule.authScheme).toBe('query-param');
    expect(rule.supportsStreaming).toBe(true);
  });

  it('returns correct rule for github.copilot', () => {
    const rule = getDialectRule('github.copilot');
    expect(rule.authScheme).toBe('proprietary');
    expect(rule.supportsStreaming).toBe(true);
  });

  it('returns correct rule for tabnine.proprietary', () => {
    const rule = getDialectRule('tabnine.proprietary');
    expect(rule.authScheme).toBe('proprietary');
    expect(rule.supportsStreaming).toBe(false);
  });

  it('returns unknown rule for unrecognized dialect', () => {
    const rule = getDialectRule('unknown');
    expect(rule.dialect).toBe('unknown');
    expect(rule.requiredEndpoints).toEqual([]);
    expect(rule.authScheme).toBe('bearer');
  });
});

describe('getAllDialectRules', () => {
  it('returns all defined rules', () => {
    const rules = getAllDialectRules();
    expect(rules.length).toBeGreaterThanOrEqual(7);
    const dialects = rules.map(r => r.dialect);
    expect(dialects).toContain('openai.chat_completions');
    expect(dialects).toContain('openai.responses');
    expect(dialects).toContain('anthropic.messages');
    expect(dialects).toContain('google.gemini.generate_content');
    expect(dialects).toContain('github.copilot');
    expect(dialects).toContain('tabnine.proprietary');
    expect(dialects).toContain('unknown');
  });
});
