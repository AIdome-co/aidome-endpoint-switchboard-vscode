/**
 * Operation timer for tracking elapsed time in async flows.
 * Used to add timing information to log messages.
 */

/**
 * Handle returned by {@link startTimer}.
 */
export interface TimedOperation {
  /** Returns the elapsed time in milliseconds without stopping the timer. */
  elapsed(): number;
  /**
   * Stops the timer and returns the final elapsed time in milliseconds.
   * Subsequent calls return the same frozen value.
   */
  stop(): number;
}

/**
 * Starts a new wall-clock timer.
 *
 * @returns A {@link TimedOperation} that can report or freeze elapsed time.
 *
 * @example
 * ```typescript
 * const timer = startTimer();
 * await doWork();
 * logger.info(`Work completed in ${timer.stop()}ms`);
 * ```
 */
export function startTimer(): TimedOperation {
  const startMs = Date.now();
  let stoppedAt: number | undefined;

  return {
    elapsed(): number {
      return (stoppedAt ?? Date.now()) - startMs;
    },
    stop(): number {
      if (stoppedAt === undefined) {
        stoppedAt = Date.now();
      }
      return stoppedAt - startMs;
    }
  };
}
