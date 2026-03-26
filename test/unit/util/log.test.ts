/**
 * Unit tests for the enhanced Logger in src/util/log.ts
 * Covers: scoped logger, ring buffer, log level filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger, LogLevel } from '../../../src/util/log';

// Reset the singleton between tests by reinitialising it.
function makeLogger() {
  const appendLine = vi.fn();
  const channel = {
    appendLine,
    show: vi.fn(),
    dispose: vi.fn(),
  } as any;
  Logger.initialize(channel);
  return { logger: Logger.getInstance(), appendLine };
}

describe('Logger — ring buffer', () => {
  beforeEach(() => {
    makeLogger();
  });

  it('buffer is empty before any log calls', () => {
    const { logger } = makeLogger();
    expect(logger.getBuffer()).toHaveLength(0);
  });

  it('appends entries to the buffer on each log call', () => {
    const { logger } = makeLogger();
    logger.info('message one');
    logger.info('message two');
    expect(logger.getBuffer()).toHaveLength(2);
  });

  it('getBuffer() returns a copy, not the internal array', () => {
    const { logger } = makeLogger();
    logger.info('hello');
    const buf = logger.getBuffer();
    (buf as any[]).push({ timestamp: 'x', level: 'INFO', message: 'injected' });
    expect(logger.getBuffer()).toHaveLength(1); // internal buffer unchanged
  });

  it('buffer entries have timestamp, level, and message fields', () => {
    const { logger } = makeLogger();
    logger.warning('watch out');
    const [entry] = logger.getBuffer();
    expect(entry.level).toBe('WARNING');
    expect(entry.message).toBe('watch out');
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('evicts oldest entry when buffer exceeds 200 entries', () => {
    const { logger } = makeLogger();
    for (let i = 0; i < 201; i++) {
      logger.info(`msg ${i}`);
    }
    const buf = logger.getBuffer();
    expect(buf).toHaveLength(200);
    // msg 0 should have been evicted; msg 1 is now oldest
    expect(buf[0].message).toBe('msg 1');
    expect(buf[199].message).toBe('msg 200');
  });
});

describe('Logger — scoped logger', () => {
  it('scoped() returns a ScopedLogger that prepends [scope]', () => {
    const { logger, appendLine } = makeLogger();
    const scoped = logger.scoped('Detection');
    scoped.info('found 2 extensions');
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[Detection] found 2 extensions')
    );
  });

  it('scoped warning forwards to parent logger', () => {
    const { logger, appendLine } = makeLogger();
    const scoped = logger.scoped('Verifier');
    scoped.warning('timeout');
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[WARNING]')
    );
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[Verifier] timeout')
    );
  });

  it('scoped error forwards to parent logger with error arg', () => {
    const { logger, appendLine } = makeLogger();
    const scoped = logger.scoped('Applier');
    scoped.error('apply failed', new Error('boom'));
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[ERROR]')
    );
  });

  it('scoped debug message is suppressed at Info level', () => {
    const { logger, appendLine } = makeLogger();
    logger.setLogLevel(LogLevel.Info);
    const scoped = logger.scoped('Parser');
    scoped.debug('verbose detail');
    expect(appendLine).not.toHaveBeenCalled();
  });

  it('scoped messages appear in the ring buffer', () => {
    const { logger } = makeLogger();
    const scoped = logger.scoped('Setup');
    scoped.info('step 1');
    const buf = logger.getBuffer();
    expect(buf[0].message).toContain('[Setup] step 1');
  });
});

describe('Logger — log level filtering', () => {
  it('does not emit debug messages at Info level', () => {
    const { logger, appendLine } = makeLogger();
    logger.setLogLevel(LogLevel.Info);
    logger.debug('debug msg');
    expect(appendLine).not.toHaveBeenCalled();
  });

  it('emits debug messages at Debug level', () => {
    const { logger, appendLine } = makeLogger();
    logger.setLogLevel(LogLevel.Debug);
    logger.debug('verbose');
    expect(appendLine).toHaveBeenCalled();
  });
});
