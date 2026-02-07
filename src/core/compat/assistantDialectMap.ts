/**
 * Assistant to dialect mapping.
 */

import { Dialect } from '../dialects/dialectTypes';
import { AssistantRegistry } from '../registry/registryTypes';

/**
 * Maps an assistant to its supported dialects.
 */
export interface AssistantDialectMapping {
  assistantKey: string;
  primaryDialect: Dialect;
  supportedDialects: Dialect[];
}

/**
 * Expected dialects for an assistant.
 */
export interface ExpectedDialects {
  primary: string;
  alsoPossible: string[];
}

/**
 * Gets the expected dialects for an assistant from the registry.
 * @param registry The assistant registry
 * @param assistantKey The assistant key
 * @returns Expected dialects or undefined if not found
 */
export function getExpectedDialects(
  registry: AssistantRegistry,
  assistantKey: string
): ExpectedDialects | undefined {
  const assistant = registry.assistants.find(a => a.key === assistantKey);
  if (!assistant) {
    return undefined;
  }
  
  return {
    primary: assistant.dialect.primary,
    alsoPossible: assistant.dialect.alsoPossible
  };
}

/**
 * Checks if a dialect is compatible with an assistant.
 * @param registry The assistant registry
 * @param assistantKey The assistant key
 * @param dialect The dialect to check
 * @returns True if dialect is in expected list (primary or alsoPossible)
 */
export function isDialectCompatible(
  registry: AssistantRegistry,
  assistantKey: string,
  dialect: Dialect
): boolean {
  const expected = getExpectedDialects(registry, assistantKey);
  if (!expected) {
    return false;
  }
  
  return expected.primary === dialect || expected.alsoPossible.includes(dialect);
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
