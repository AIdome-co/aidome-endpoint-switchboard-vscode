/**
 * Dialect detection from API responses and configuration.
 */

import { Dialect } from './dialectTypes';

/**
 * Detects the dialect from an API response structure.
 * @param response The API response object
 * @returns Detected dialect or undefined
 */
export function detectDialectFromResponse(response: unknown): Dialect | undefined {
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const obj = response as Record<string, unknown>;

  // OpenAI chat completions has 'choices' array
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const choice = obj.choices[0] as Record<string, unknown>;
    if ('message' in choice) {
      return 'openai.chat_completions';
    }
  }

  // Anthropic messages has 'content' array and 'role'
  if (Array.isArray(obj.content) && 'role' in obj) {
    return 'anthropic.messages';
  }

  return undefined;
}

/**
 * Detects dialect from endpoint URL patterns.
 * @param url The endpoint URL
 * @returns Detected dialect or undefined
 */
export function detectDialectFromUrl(url: string): Dialect | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname;

    if (path.includes('/v1/chat/completions')) {
      return 'openai.chat_completions';
    }
    if (path.includes('/v1/messages')) {
      return 'anthropic.messages';
    }
    if (path.includes('generateContent')) {
      return 'google.gemini.generate_content';
    }

    return undefined;
  } catch {
    return undefined;
  }
}
