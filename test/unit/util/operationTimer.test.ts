/**
 * Unit tests for the operation timer in src/util/operationTimer.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTimer } from '../../../src/util/operationTimer';

describe('startTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns elapsed() close to zero immediately after creation', () => {
    const timer = startTimer();
    expect(timer.elapsed()).toBeGreaterThanOrEqual(0);
    expect(timer.elapsed()).toBeLessThan(50);
  });

  it('elapsed() reflects time passed', () => {
    const timer = startTimer();
    vi.advanceTimersByTime(100);
    expect(timer.elapsed()).toBe(100);
  });

  it('stop() returns the elapsed time and freezes it', () => {
    const timer = startTimer();
    vi.advanceTimersByTime(200);
    const ms = timer.stop();
    expect(ms).toBe(200);

    // Further time passage should not change the stopped value
    vi.advanceTimersByTime(500);
    expect(timer.stop()).toBe(200);
  });

  it('elapsed() after stop() returns the frozen value', () => {
    const timer = startTimer();
    vi.advanceTimersByTime(150);
    timer.stop();
    vi.advanceTimersByTime(300);
    expect(timer.elapsed()).toBe(150);
  });

  it('two sequential timers have independent values', () => {
    const t1 = startTimer();
    vi.advanceTimersByTime(50);
    const t2 = startTimer();
    vi.advanceTimersByTime(100);

    expect(t1.stop()).toBe(150);
    expect(t2.stop()).toBe(100);
  });
});
