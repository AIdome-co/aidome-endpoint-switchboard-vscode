/**
 * Heuristics for guessing configuration patterns.
 */

/**
 * Common URL setting patterns.
 */
export const URL_PATTERNS = [
  '*baseUrl*',
  '*base-url*',
  '*endpoint*',
  '*api-url*',
  '*apiUrl*',
  '*server*'
];

/**
 * Common API key setting patterns.
 */
export const API_KEY_PATTERNS = [
  '*apiKey*',
  '*api-key*',
  '*api_key*',
  '*token*',
  '*secret*'
];

/**
 * Common model setting patterns.
 */
export const MODEL_PATTERNS = [
  '*model*',
  '*modelId*',
  '*model-id*',
  '*model_id*'
];

/**
 * Guesses the base URL setting key for an extension.
 * @param extensionId The extension ID
 * @returns Likely setting key or undefined
 */
export function guessBaseUrlKey(extensionId: string): string | undefined {
  const prefix = extensionId.split('.').pop() || extensionId;
  
  // Common patterns
  const candidates = [
    `${prefix}.baseUrl`,
    `${prefix}.base-url`,
    `${prefix}.apiUrl`,
    `${prefix}.endpoint`,
    `${prefix}.openai.baseUrl`,
    `${prefix}.openAiBaseUrl`
  ];
  
  // In a real implementation, we'd scan and verify
  return candidates[0];
}

/**
 * Guesses the API key setting key for an extension.
 * @param extensionId The extension ID
 * @returns Likely setting key or undefined
 */
export function guessApiKeyKey(extensionId: string): string | undefined {
  const prefix = extensionId.split('.').pop() || extensionId;
  
  const candidates = [
    `${prefix}.apiKey`,
    `${prefix}.api-key`,
    `${prefix}.openai.apiKey`,
    `${prefix}.openAiApiKey`
  ];
  
  return candidates[0];
}
