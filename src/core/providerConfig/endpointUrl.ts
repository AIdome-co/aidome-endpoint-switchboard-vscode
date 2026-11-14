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

/**
 * Normalizes a profile URL for clients that build the full Anthropic API
 * route themselves. Claude Code appends `/v1/messages` to ANTHROPIC_BASE_URL,
 * so a `/v1`-suffixed profile URL would produce `/v1/v1/messages` and fail
 * with 404. Profiles accept either the gateway root or a versioned URL; the
 * version suffix is stripped here.
 */
export function normalizeAnthropicBaseUrl(baseUrl: string): string {
  if (!validateUrl(baseUrl)) {
    throw new Error('Invalid Anthropic-compatible endpoint URL');
  }

  const url = new URL(baseUrl);
  url.hash = '';
  const normalizedPath = url.pathname.replace(/\/+$/, '');
  const stripped = normalizedPath.replace(/\/v\d+[a-z0-9]*$/i, '');

  url.pathname = stripped || '/';

  return url.toString().replace(/\/$/, '');
}
