/**
 * Assistant to dialect mapping.
 */

import { Dialect } from '../dialects/dialectTypes';

/**
 * Maps an assistant to its supported dialects.
 */
export interface AssistantDialectMapping {
  assistantKey: string;
  primaryDialect: Dialect;
  supportedDialects: Dialect[];
}

/**
 * Gets the dialect mapping for an assistant.
 * @param assistantKey The assistant key
 * @returns Dialect mapping or undefined
 */
export function getAssistantDialects(assistantKey: string): AssistantDialectMapping | undefined {
  // Skeleton implementation
  return undefined;
}

/**
 * Checks if an assistant supports a dialect.
 * @param assistantKey The assistant key
 * @param dialect The dialect to check
 * @returns True if supported
 */
export function assistantSupportsDialect(assistantKey: string, dialect: Dialect): boolean {
  // Skeleton implementation
  return false;
}

/**
 * Gets the recommended dialect for an assistant-gateway pair.
 * @param assistantKey The assistant key
 * @param gatewayDialects Available gateway dialects
 * @returns Recommended dialect or undefined
 */
export function getRecommendedDialect(assistantKey: string, gatewayDialects: Dialect[]): Dialect | undefined {
  // Skeleton implementation
  return undefined;
}
