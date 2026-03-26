/**
 * Retry utility with exponential back-off and a simple circuit breaker.
 * Use {@link withRetry} for transient failures; use {@link CircuitBreaker}
 * to avoid hammering an endpoint that has already failed repeatedly.
 */

/**
 * Options for {@link withRetry}.
 */
export interface RetryOptions {
  /** Maximum number of attempts, including the first try. Default: 3. */
  maxAttempts?: number;
  /** Base delay between attempts in milliseconds. Default: 500. */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 5 000. */
  maxDelayMs?: number;
  /**
   * Predicate that returns true for errors that should trigger a retry.
   * Return false to immediately re-throw without further attempts.
   * Default: always retry.
   */
  isRetryable?: (error: unknown) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
  isRetryable: () => true
};

/**
 * Runs an async operation with exponential back-off retry logic.
 *
 * @param operation - The async operation to run.
 * @param options   - Retry behaviour overrides.
 * @returns The operation result on success.
 * @throws The last error if all attempts fail, or immediately if
 *         {@link RetryOptions.isRetryable} returns false.
 *
 * @example
 * ```typescript
 * const result = await withRetry(() => httpRequest(url), {
 *   maxAttempts: 3,
 *   isRetryable: (e) => e instanceof NetworkError,
 * });
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === opts.maxAttempts;
      if (isLastAttempt || !opts.isRetryable(error)) {
        throw error;
      }
      const delayMs = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );
      await new Promise<void>(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/** States a {@link CircuitBreaker} can be in. */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Simple circuit breaker that prevents repeated calls to a failing resource.
 *
 * States:
 * - **closed** — normal operation, calls pass through.
 * - **open**   — too many failures; calls should be skipped until the reset
 *                timeout elapses.
 * - **half-open** — the timeout elapsed; the next call is allowed through as
 *                   a probe. A success closes the circuit; a failure reopens it.
 *
 * @example
 * ```typescript
 * const breaker = new CircuitBreaker(3, 30_000);
 * if (breaker.isOpen()) {
 *   return { status: 'skipped', reason: 'circuit-open' };
 * }
 * try {
 *   const result = await verifyEndpoint(profile);
 *   breaker.recordSuccess();
 *   return result;
 * } catch (error) {
 *   breaker.recordFailure();
 *   throw error;
 * }
 * ```
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime: number | undefined;
  private state: CircuitState = 'closed';

  /**
   * @param failureThreshold - Number of consecutive failures before the circuit
   *                           opens. Default: 3.
   * @param resetTimeoutMs   - Milliseconds to wait before entering half-open
   *                           state after opening. Default: 30 000.
   */
  constructor(
    private readonly failureThreshold: number = 3,
    private readonly resetTimeoutMs: number = 30_000
  ) {}

  /**
   * Returns true when the circuit is open and the operation should be skipped.
   * Automatically transitions to half-open once the reset timeout elapses.
   */
  isOpen(): boolean {
    if (this.state === 'open') {
      const elapsed = Date.now() - (this.lastFailureTime ?? 0);
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half-open';
        return false;
      }
      return true;
    }
    return false;
  }

  /** Records a successful operation and resets the circuit to closed. */
  recordSuccess(): void {
    this.failures = 0;
    this.lastFailureTime = undefined;
    this.state = 'closed';
  }

  /**
   * Records a failed operation.
   * Opens the circuit once the failure count reaches the threshold.
   */
  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (this.failures >= this.failureThreshold) {
      this.state = 'open';
    }
  }

  /** Returns the current circuit state. */
  getState(): CircuitState {
    return this.state;
  }

  /** Returns the number of consecutive failures recorded so far. */
  getFailureCount(): number {
    return this.failures;
  }
}
