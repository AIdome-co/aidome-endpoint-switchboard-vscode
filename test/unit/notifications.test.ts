/**
 * Unit tests for handleBoundaryOutcome in src/ui/notifications.ts.
 * Covers: all four BoundaryOutcome kinds, correct log method, correct notification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------- hoisted mocks ----------
const {
  mockShowError,
  mockShowInfoMessage,
  mockShowWarnMessage,
  mockLogInfo,
  mockLogWarning,
  mockLogError,
} = vi.hoisted(() => ({
  mockShowError: vi.fn().mockResolvedValue(undefined),
  mockShowInfoMessage: vi.fn().mockResolvedValue(undefined),
  mockShowWarnMessage: vi.fn().mockResolvedValue(undefined),
  mockLogInfo: vi.fn(),
  mockLogWarning: vi.fn(),
  mockLogError: vi.fn(),
}));

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: mockShowError,
    showInformationMessage: mockShowInfoMessage,
    showWarningMessage: mockShowWarnMessage,
  },
  ProgressLocation: { Notification: 15 },
}));

import {
  handleBoundaryOutcome,
} from '../../src/ui/notifications';
import {
  UserCancellationError,
  ConfigurationError,
  DetectionError,
  ValidationError,
  OperationError,
} from '../../src/util/errors';

function makeLogger() {
  return {
    info: mockLogInfo,
    warning: mockLogWarning,
    error: mockLogError,
    debug: vi.fn(),
    scoped: vi.fn(),
    withOperationId: vi.fn(),
    getBuffer: vi.fn().mockReturnValue([]),
    dumpBuffer: vi.fn(),
    show: vi.fn(),
    setLogLevel: vi.fn(),
  } as any;
}

describe('handleBoundaryOutcome — success', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true and does not show a notification', async () => {
    const logger = makeLogger();
    const result = await handleBoundaryOutcome(
      { kind: 'success', value: 42 },
      logger,
      'Test'
    );
    expect(result).toBe(true);
    expect(mockShowError).not.toHaveBeenCalled();
    expect(mockShowInfoMessage).not.toHaveBeenCalled();
  });

  it('does not call any logger method on success', async () => {
    const logger = makeLogger();
    await handleBoundaryOutcome({ kind: 'success', value: 'x' }, logger, 'Test');
    expect(mockLogInfo).not.toHaveBeenCalled();
    expect(mockLogWarning).not.toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe('handleBoundaryOutcome — cancelled', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false', async () => {
    const result = await handleBoundaryOutcome(
      { kind: 'cancelled', step: 'profile-selection' },
      makeLogger(),
      'Setup'
    );
    expect(result).toBe(false);
  });

  it('logs at info level with step name', async () => {
    const logger = makeLogger();
    await handleBoundaryOutcome(
      { kind: 'cancelled', step: 'url-input' },
      logger,
      'Setup'
    );
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.stringContaining('url-input')
    );
  });

  it('does NOT show an error notification', async () => {
    await handleBoundaryOutcome(
      { kind: 'cancelled', step: 'any-step' },
      makeLogger(),
      'Setup'
    );
    expect(mockShowError).not.toHaveBeenCalled();
  });
});

describe('handleBoundaryOutcome — domain (ConfigurationError)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false', async () => {
    const err = new ConfigurationError('internal msg', 'User-friendly message', 'kilocode');
    const result = await handleBoundaryOutcome(
      { kind: 'domain', error: err },
      makeLogger(),
      'Setup'
    );
    expect(result).toBe(false);
  });

  it('shows the userMessage (not the technical message)', async () => {
    const err = new ConfigurationError('technical detail', 'Please reconfigure your endpoint');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, makeLogger(), 'Setup');
    expect(mockShowError).toHaveBeenCalledWith('Please reconfigure your endpoint');
  });

  it('logs at warning level (not error)', async () => {
    const logger = makeLogger();
    const err = new ConfigurationError('internal', 'user msg');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, logger, 'Setup');
    expect(mockLogWarning).toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });

  it('includes errorName in log context', async () => {
    const logger = makeLogger();
    const err = new ConfigurationError('internal', 'user msg');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, logger, 'Setup');
    expect(mockLogWarning).toHaveBeenCalledWith(
      expect.any(String),
      undefined,
      expect.objectContaining({ errorName: 'ConfigurationError' })
    );
  });
});

describe('handleBoundaryOutcome — domain (ValidationError)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows error.message when no userMessage is present', async () => {
    const err = new ValidationError('Base URL is invalid');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, makeLogger(), 'Setup');
    // ValidationError has no userMessage — falls back to .message
    expect(mockShowError).toHaveBeenCalledWith('Base URL is invalid');
  });
});

describe('handleBoundaryOutcome — domain (OperationError)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the userMessage of OperationError', async () => {
    const err = new OperationError('plan apply failed', 'Could not apply configuration', 'applyPlan');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, makeLogger(), 'Apply');
    expect(mockShowError).toHaveBeenCalledWith('Could not apply configuration');
  });

  it('logs at warning level for OperationError', async () => {
    const logger = makeLogger();
    const err = new OperationError('internal', 'user msg', 'applyPlan');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, logger, 'Apply');
    expect(mockLogWarning).toHaveBeenCalled();
    expect(mockLogError).not.toHaveBeenCalled();
  });
});

describe('handleBoundaryOutcome — domain (DetectionError)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows error.message when no userMessage', async () => {
    const err = new DetectionError('registry file missing');
    await handleBoundaryOutcome({ kind: 'domain', error: err }, makeLogger(), 'Detection');
    expect(mockShowError).toHaveBeenCalledWith('registry file missing');
  });
});

describe('handleBoundaryOutcome — unexpected', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns false', async () => {
    const result = await handleBoundaryOutcome(
      { kind: 'unexpected', error: new Error('boom') },
      makeLogger(),
      'Setup'
    );
    expect(result).toBe(false);
  });

  it('logs at error level with the full error object', async () => {
    const logger = makeLogger();
    const err = new Error('boom');
    await handleBoundaryOutcome({ kind: 'unexpected', error: err }, logger, 'Setup');
    expect(mockLogError).toHaveBeenCalledWith(
      expect.stringContaining('Setup'),
      err
    );
  });

  it('shows a generic "check the output channel" message', async () => {
    await handleBoundaryOutcome(
      { kind: 'unexpected', error: new Error('internal') },
      makeLogger(),
      'Setup'
    );
    expect(mockShowError).toHaveBeenCalledWith(
      expect.stringContaining('Output channel')
    );
  });

  it('does NOT show the raw error message to the user', async () => {
    await handleBoundaryOutcome(
      { kind: 'unexpected', error: new Error('secret stack trace') },
      makeLogger(),
      'Setup'
    );
    expect(mockShowError).not.toHaveBeenCalledWith(
      expect.stringContaining('secret stack trace')
    );
  });
});
