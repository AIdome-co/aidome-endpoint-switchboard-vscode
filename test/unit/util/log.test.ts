/**
 * Unit tests for the enhanced Logger in src/util/log.ts
 * Covers: scoped logger, ring buffer, log level filtering, dumpBuffer, context.
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

describe('Logger — structured context on error()', () => {
  it('stores context in the buffer entry', () => {
    const { logger } = makeLogger();
    logger.error('apply failed', new Error('boom'), { step: 'apply', assistantKey: 'kilocode' });
    const [entry] = logger.getBuffer();
    expect(entry.context).toBeDefined();
    expect(entry.context?.step).toBe('apply');
    expect(entry.context?.assistantKey).toBe('kilocode');
  });

  it('context is absent when not provided', () => {
    const { logger } = makeLogger();
    logger.info('hello');
    const [entry] = logger.getBuffer();
    expect(entry.context).toBeUndefined();
  });

  it('includes context JSON in the output line', () => {
    const { logger, appendLine } = makeLogger();
    logger.error('failed', undefined, { reason: 'timeout' });
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('"reason"')
    );
  });
});

describe('Logger — dumpBuffer()', () => {
  it('returns "(no log entries)" when buffer is empty', () => {
    const { logger } = makeLogger();
    expect(logger.dumpBuffer()).toBe('(no log entries)');
  });

  it('returns all entries when no maxEntries argument', () => {
    const { logger } = makeLogger();
    logger.info('first');
    logger.info('second');
    logger.info('third');
    const dump = logger.dumpBuffer();
    expect(dump.split('\n')).toHaveLength(3);
    expect(dump).toContain('first');
    expect(dump).toContain('third');
  });

  it('limits output to the last N entries', () => {
    const { logger } = makeLogger();
    for (let i = 1; i <= 5; i++) {
      logger.info(`msg ${i}`);
    }
    const dump = logger.dumpBuffer(3);
    const lines = dump.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('msg 3');
    expect(lines[2]).toContain('msg 5');
  });

  it('includes level and message in each line', () => {
    const { logger } = makeLogger();
    logger.warning('check this');
    const dump = logger.dumpBuffer();
    expect(dump).toContain('[WARNING]');
    expect(dump).toContain('check this');
  });

  it('includes context JSON when present', () => {
    const { logger } = makeLogger();
    logger.error('oops', undefined, { code: 42 });
    const dump = logger.dumpBuffer();
    expect(dump).toContain('"code"');
    expect(dump).toContain('42');
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

  it('scoped error forwards context to parent logger', () => {
    const { logger } = makeLogger();
    const scoped = logger.scoped('Applier');
    scoped.error('step failed', undefined, { step: 'configure', elapsed: 120 });
    const [entry] = logger.getBuffer();
    expect(entry.context?.step).toBe('configure');
    expect(entry.context?.elapsed).toBe(120);
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

describe('Logger — withOperationId()', () => {
  it('returns a ScopedLogger with the given operationId', () => {
    const { logger } = makeLogger();
    const scoped = logger.withOperationId('Setup', 'op-123');
    expect(scoped.operationId).toBe('op-123');
  });

  it('prefixes messages with the scope', () => {
    const { logger, appendLine } = makeLogger();
    const scoped = logger.withOperationId('Setup', 'op-xyz');
    scoped.info('step started');
    expect(appendLine).toHaveBeenCalledWith(
      expect.stringContaining('[Setup] step started')
    );
  });

  it('injects operationId into the ring buffer entry', () => {
    const { logger } = makeLogger();
    const scoped = logger.withOperationId('Setup', 'op-abc');
    scoped.info('wizard step 1');
    const [entry] = logger.getBuffer();
    expect(entry.operationId).toBe('op-abc');
  });

  it('operationId appears in context for error() calls', () => {
    const { logger } = makeLogger();
    const scoped = logger.withOperationId('Verifier', 'op-def');
    scoped.error('endpoint down', new Error('ECONNREFUSED'), { step: 'reachability' });
    const [entry] = logger.getBuffer();
    expect(entry.operationId).toBe('op-def');
    expect(entry.context?.step).toBe('reachability');
  });

  it('scoped logger without operationId does NOT set operationId on buffer entries', () => {
    const { logger } = makeLogger();
    const scoped = logger.scoped('Detection');
    scoped.info('found 3 extensions');
    const [entry] = logger.getBuffer();
    expect(entry.operationId).toBeUndefined();
  });

  it('operationId appears in dumpBuffer output with [op:...] prefix', () => {
    const { logger } = makeLogger();
    const scoped = logger.withOperationId('Apply', 'op-999');
    scoped.info('plan applied');
    const dump = logger.dumpBuffer();
    expect(dump).toContain('[op:op-999]');
  });

  it('two concurrent operations can be distinguished by operationId', () => {
    const { logger } = makeLogger();
    const op1 = logger.withOperationId('Setup', 'setup-1');
    const op2 = logger.withOperationId('Setup', 'setup-2');
    op1.info('step from op1');
    op2.info('step from op2');
    const buf = logger.getBuffer();
    expect(buf[0].operationId).toBe('setup-1');
    expect(buf[1].operationId).toBe('setup-2');
  });
});
