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

  it('calls onRetry callback before each retry delay', async () => {
    const onRetry = vi.fn();
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const promise = withRetry(op, {
      maxAttempts: 3,
      baseDelayMs: 10,
      onRetry
    });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry).toHaveBeenCalledTimes(2);
    // First retry: attempt=1, maxAttempts=3
    expect(onRetry.mock.calls[0][0]).toBe(1);
    expect(onRetry.mock.calls[0][1]).toBe(3);
    // Second retry: attempt=2
    expect(onRetry.mock.calls[1][0]).toBe(2);
  });

  it('onRetry receives the thrown error', async () => {
    const onRetry = vi.fn();
    const err = new Error('transient');
    const op = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue('ok');

    const promise = withRetry(op, { maxAttempts: 2, baseDelayMs: 10, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    expect(onRetry.mock.calls[0][2]).toBe(err);
  });

  it('onRetry receives the computed delay', async () => {
    const onRetry = vi.fn();
    const op = vi.fn()
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue('ok');

    const promise = withRetry(op, { maxAttempts: 2, baseDelayMs: 250, onRetry });
    await vi.runAllTimersAsync();
    await promise;

    // First retry delay: 250 * 2^0 = 250ms
    expect(onRetry.mock.calls[0][3]).toBe(250);
  });

  it('does not call onRetry when operation succeeds immediately', async () => {
    const onRetry = vi.fn();
    await withRetry(async () => 'ok', { onRetry });
    expect(onRetry).not.toHaveBeenCalled();
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

  it('calls onStateChange when circuit opens', () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker(2, 30_000);
    cb.onStateChange = onChange;
    cb.recordFailure();
    expect(onChange).not.toHaveBeenCalled(); // threshold not reached yet
    cb.recordFailure(); // opens
    expect(onChange).toHaveBeenCalledOnce();
    const [from, to, failures] = onChange.mock.calls[0];
    expect(from).toBe('closed');
    expect(to).toBe('open');
    expect(failures).toBe(2);
  });

  it('calls onStateChange when circuit closes after success', () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker(1, 30_000);
    cb.onStateChange = onChange;
    cb.recordFailure(); // opens -> first onChange call
    onChange.mockClear();
    cb.recordSuccess(); // closes -> second onChange call
    expect(onChange).toHaveBeenCalledOnce();
    const [from, to] = onChange.mock.calls[0];
    expect(from).toBe('open');
    expect(to).toBe('closed');
  });

  it('calls onStateChange when circuit becomes half-open', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cb = new CircuitBreaker(1, 1_000);
    cb.onStateChange = onChange;
    cb.recordFailure(); // open
    onChange.mockClear();
    vi.advanceTimersByTime(1_001);
    cb.isOpen(); // triggers half-open transition
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][1]).toBe('half-open');
    vi.useRealTimers();
  });

  it('does not call onStateChange when already open and recordFailure called again', () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker(1, 30_000);
    cb.onStateChange = onChange;
    cb.recordFailure(); // opens -> calls onChange
    onChange.mockClear();
    cb.recordFailure(); // still open — no transition
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not call onStateChange on success from closed state', () => {
    const onChange = vi.fn();
    const cb = new CircuitBreaker(3, 30_000);
    cb.onStateChange = onChange;
    cb.recordFailure();
    cb.recordSuccess(); // closed → closed, no transition
    expect(onChange).not.toHaveBeenCalled();
  });
});
