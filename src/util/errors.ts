/**
 * Typed error classes for domain-specific error handling.
 * Allows callers to distinguish user cancellations from real failures
 * and show appropriate notifications for each.
 */

/**
 * Thrown when the user explicitly cancels a wizard step.
 * Should NOT produce an error notification — it is a normal flow path.
 */
export class UserCancellationError extends Error {
  constructor(
    /** Name of the wizard step at which the user cancelled. */
    public readonly step: string
  ) {
    super(`User cancelled at step: ${step}`);
    this.name = 'UserCancellationError';
  }
}

/**
 * Thrown when an assistant configuration operation fails.
 * Carries both a technical message and a user-friendly message for display.
 */
export class ConfigurationError extends Error {
  constructor(
    message: string,
    /** User-friendly message suitable for display in a VS Code notification. */
    public readonly userMessage: string,
    /** The assistant key that caused the failure, if applicable. */
    public readonly assistantKey?: string
  ) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Thrown when assistant detection fails unexpectedly.
 */
export class DetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectionError';
  }
}

/**
 * Thrown when profile or user-supplied input fails validation.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    /** The field that failed validation, if applicable. */
    public readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Returns true when the error is a user-initiated cancellation.
 * Use this to suppress error notifications for deliberate cancellations.
 */
export function isUserCancellation(error: unknown): error is UserCancellationError {
  return error instanceof UserCancellationError;
}

/**
 * Outcome produced by {@link withErrorBoundary}.
 */
export type BoundaryOutcome<T> =
  | { kind: 'success'; value: T }
  | { kind: 'cancelled'; step: string }
  | { kind: 'domain'; error: ConfigurationError | ValidationError | DetectionError }
  | { kind: 'unexpected'; error: Error };

/**
 * Wraps an async wizard or command flow with a typed error boundary.
 *
 * Classifies thrown errors into four outcome categories so callers can respond
 * without nested try/catch logic:
 * - **success**    — operation completed normally; `value` holds the result.
 * - **cancelled**  — user dismissed a wizard step; no error popup should appear.
 * - **domain**     — a typed domain error ({@link ConfigurationError},
 *   {@link ValidationError}, or {@link DetectionError}); caller may surface
 *   `error.userMessage` to the user.
 * - **unexpected** — any other thrown value; caller should log the full stack
 *   and show a generic error notification.
 *
 * @param operation  Async function to execute inside the boundary.
 * @returns          A {@link BoundaryOutcome} — never throws.
 *
 * @example
 * ```typescript
 * const outcome = await withErrorBoundary(() => runSetupWizard(context));
 * if (outcome.kind === 'cancelled') return;
 * if (outcome.kind === 'domain') {
 *   showError(outcome.error.userMessage);
 *   return;
 * }
 * if (outcome.kind === 'unexpected') {
 *   logger.error('Unexpected error', outcome.error);
 *   showError('An unexpected error occurred. Check the output channel.');
 *   return;
 * }
 * // outcome.kind === 'success'
 * ```
 */
export async function withErrorBoundary<T>(
  operation: () => Promise<T>
): Promise<BoundaryOutcome<T>> {
  try {
    const value = await operation();
    return { kind: 'success', value };
  } catch (error) {
    if (error instanceof UserCancellationError) {
      return { kind: 'cancelled', step: error.step };
    }
    if (
      error instanceof ConfigurationError ||
      error instanceof ValidationError ||
      error instanceof DetectionError
    ) {
      return { kind: 'domain', error };
    }
    return {
      kind: 'unexpected',
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
}
