import { validateUrl } from '../profiles/profileValidator';

/**
 * Normalizes a profile URL for clients that append OpenAI API route names.
 * OpenAI-compatible clients expect their configured base to end at the API
 * version (`/v1`), while profiles accept either the gateway root or a
 * versioned URL.
 */
export function normalizeOpenAiBaseUrl(baseUrl: string): string {
  if (!validateUrl(baseUrl)) {
    throw new Error('Invalid OpenAI-compatible endpoint URL');
  }

  const url = new URL(baseUrl);
  url.hash = '';
  const normalizedPath = url.pathname.replace(/\/+$/, '');

  if (!/(^|\/)v\d+[a-z0-9]*$/i.test(normalizedPath)) {
    url.pathname = normalizedPath ? `${normalizedPath}/v1` : '/v1';
  } else {
    url.pathname = normalizedPath || '/';
  }

  return url.toString().replace(/\/$/, '');
}
