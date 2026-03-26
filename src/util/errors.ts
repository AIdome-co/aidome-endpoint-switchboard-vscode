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
