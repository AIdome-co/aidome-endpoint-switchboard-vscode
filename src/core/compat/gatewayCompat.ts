/**
 * Gateway compatibility checking for assistants.
 */

import { Dialect } from '../dialects/dialectTypes';
import { AIdomeCapabilities } from '../aidome/types';
import { AssistantEntry } from '../registry/registryTypes';

/**
 * Compatibility status.
 */
export type CompatibilityStatus = 'compatible' | 'mismatch' | 'unknown';

/**
 * Compatibility result with detailed information.
 */
export interface CompatibilityResult {
  status: CompatibilityStatus;
  reason: string;
  suggestions: string[];
}

/**
 * Gateway compatibility result.
 */
export interface GatewayCompatibility {
  assistantKey: string;
  gatewayDialects: Dialect[];
  compatible: boolean;
  recommendedDialect?: Dialect;
  issues?: string[];
}

/**
 * Checks compatibility between AIdome capabilities and assistant requirements.
 * @param capabilities AIdome capabilities
 * @param assistant Assistant entry from registry
 * @returns Compatibility result
 */
export function checkCompatibility(
  capabilities: AIdomeCapabilities,
  assistant: AssistantEntry
): CompatibilityResult {
  const aidomeDialects = capabilities.supportedDialects;
  const expectedPrimary = assistant.dialect.primary;
  const expectedAlsoPossible = assistant.dialect.alsoPossible;
  
  // Check if primary dialect is supported
  if (aidomeDialects.includes(expectedPrimary)) {
    return {
      status: 'compatible',
      reason: `AIdome supports the primary dialect '${expectedPrimary}' expected by ${assistant.displayName}`,
      suggestions: []
    };
  }
  
  // Check if any alsoPossible dialect is supported
  const matchingDialect = expectedAlsoPossible.find(d => aidomeDialects.includes(d));
  if (matchingDialect) {
    return {
      status: 'compatible',
      reason: `AIdome supports dialect '${matchingDialect}' which is compatible with ${assistant.displayName}`,
      suggestions: [`Primary dialect '${expectedPrimary}' is not available, using '${matchingDialect}' instead`]
    };
  }
  
  // No compatible dialect found - provide suggestions
  const suggestions: string[] = [];
  
  if (expectedPrimary === 'anthropic.messages' && aidomeDialects.includes('openai.chat_completions')) {
    suggestions.push('Create an OpenAI profile instead, as AIdome only supports OpenAI dialects');
    suggestions.push('Configure AIdome to support Anthropic API dialect');
  } else if (expectedPrimary === 'openai.chat_completions' && aidomeDialects.includes('anthropic.messages')) {
    suggestions.push('Create an Anthropic profile instead, as AIdome only supports Anthropic dialects');
    suggestions.push('Configure AIdome to support OpenAI API dialect');
  } else {
    suggestions.push(`Configure AIdome to support one of: ${expectedPrimary}${expectedAlsoPossible.length > 0 ? ', ' + expectedAlsoPossible.join(', ') : ''}`);
    suggestions.push(`Or use a different assistant that supports: ${aidomeDialects.join(', ')}`);
  }
  
  return {
    status: 'mismatch',
    reason: `${assistant.displayName} expects dialects [${expectedPrimary}, ${expectedAlsoPossible.join(', ')}] but AIdome only supports [${aidomeDialects.join(', ')}]`,
    suggestions
  };
}

/**
 * Checks if an assistant is compatible with a gateway.
 * @param assistantKey The assistant key
 * @param gatewayDialects Dialects supported by the gateway
 * @returns Compatibility result
 */
export function checkGatewayCompatibility(
  assistantKey: string,
  gatewayDialects: Dialect[]
): GatewayCompatibility {
  // Skeleton implementation
  return {
    assistantKey,
    gatewayDialects,
    compatible: false,
    issues: ['Not implemented']
  };
}

/**
 * Validates gateway configuration for an assistant.
 * @param assistantKey The assistant key
 * @param config Gateway configuration
 * @returns True if valid
 */
export function validateGatewayConfig(assistantKey: string, config: unknown): boolean {
  // Skeleton implementation
  return false;
}
