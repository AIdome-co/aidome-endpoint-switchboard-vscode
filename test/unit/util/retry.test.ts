/**
 * Unit tests for withRetry and CircuitBreaker in src/util/retry.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, CircuitBreaker } from '../../../src/util/retry';

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------
describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result on the first successful attempt', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(op);
    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure and succeeds on the second attempt', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('ok');

    const promise = withRetry(op, { maxAttempts: 3, baseDelayMs: 10 });
    // Flush the delay timer
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all attempts', async () => {
    const error = new Error('always fails');
    const op = vi.fn().mockRejectedValue(error);

    let caught: unknown;
    const promise = withRetry(op, { maxAttempts: 3, baseDelayMs: 10 }).catch(e => {
      caught = e;
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(caught).toBe(error);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('does not retry when isRetryable returns false', async () => {
    const error = new Error('fatal');
    const op = vi.fn().mockRejectedValue(error);

    await expect(
      withRetry(op, { maxAttempts: 3, isRetryable: () => false })
    ).rejects.toThrow('fatal');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('respects maxDelayMs cap', async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const promise = withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 150
    });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------
describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe('closed');
    expect(cb.isOpen()).toBe(false);
  });

  it('opens after reaching the failure threshold', () => {
    const cb = new CircuitBreaker(3, 30_000);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.isOpen()).toBe(true);
  });

  it('tracks failure count correctly', () => {
    const cb = new CircuitBreaker(5);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getFailureCount()).toBe(2);
  });

  it('resets to closed after a success', () => {
    const cb = new CircuitBreaker(2);
    cb.recordFailure();
    cb.recordFailure(); // open
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.isOpen()).toBe(false);
  });

  it('transitions to half-open after reset timeout', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker(1, 1_000);
    cb.recordFailure(); // open
    expect(cb.isOpen()).toBe(true);

    vi.advanceTimersByTime(1_001);
    expect(cb.isOpen()).toBe(false); // half-open, not blocking
    expect(cb.getState()).toBe('half-open');
    vi.useRealTimers();
  });

  it('returns to closed from half-open on success', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker(1, 500);
    cb.recordFailure();
    vi.advanceTimersByTime(600); // trigger half-open
    cb.isOpen(); // force state check
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    vi.useRealTimers();
  });

  it('re-opens from half-open on another failure', () => {
    vi.useFakeTimers();
    const cb = new CircuitBreaker(1, 500);
    cb.recordFailure();
    vi.advanceTimersByTime(600);
    cb.isOpen(); // half-open
    cb.recordFailure(); // open again
    expect(cb.getState()).toBe('open');
    vi.useRealTimers();
  });
});
