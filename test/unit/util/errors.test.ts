/**
 * Unit tests for typed error classes in src/util/errors.ts
 */

import { describe, it, expect } from 'vitest';
import {
  UserCancellationError,
  ConfigurationError,
  DetectionError,
  ValidationError,
  isUserCancellation,
  withErrorBoundary
} from '../../../src/util/errors';

describe('UserCancellationError', () => {
  it('has name "UserCancellationError"', () => {
    const err = new UserCancellationError('assistant-selection');
    expect(err.name).toBe('UserCancellationError');
  });

  it('stores the step name', () => {
    const err = new UserCancellationError('profile-selection');
    expect(err.step).toBe('profile-selection');
  });

  it('includes the step in the message', () => {
    const err = new UserCancellationError('url-input');
    expect(err.message).toContain('url-input');
  });

  it('is an instance of Error', () => {
    expect(new UserCancellationError('x')).toBeInstanceOf(Error);
  });
});

describe('ConfigurationError', () => {
  it('has name "ConfigurationError"', () => {
    const err = new ConfigurationError('internal', 'user message');
    expect(err.name).toBe('ConfigurationError');
  });

  it('stores the user message', () => {
    const err = new ConfigurationError('internal msg', 'user-friendly msg');
    expect(err.userMessage).toBe('user-friendly msg');
  });

  it('stores optional assistantKey', () => {
    const err = new ConfigurationError('msg', 'user msg', 'kilocode');
    expect(err.assistantKey).toBe('kilocode');
  });

  it('assistantKey is undefined when not provided', () => {
    const err = new ConfigurationError('msg', 'user msg');
    expect(err.assistantKey).toBeUndefined();
  });
});

describe('DetectionError', () => {
  it('has name "DetectionError"', () => {
    const err = new DetectionError('detection failed');
    expect(err.name).toBe('DetectionError');
  });

  it('preserves the message', () => {
    const err = new DetectionError('registry parse error');
    expect(err.message).toBe('registry parse error');
  });
});

describe('ValidationError', () => {
  it('has name "ValidationError"', () => {
    const err = new ValidationError('invalid URL');
    expect(err.name).toBe('ValidationError');
  });

  it('stores optional field name', () => {
    const err = new ValidationError('required', 'baseUrl');
    expect(err.field).toBe('baseUrl');
  });

  it('field is undefined when not provided', () => {
    const err = new ValidationError('required');
    expect(err.field).toBeUndefined();
  });
});

describe('isUserCancellation', () => {
  it('returns true for UserCancellationError', () => {
    expect(isUserCancellation(new UserCancellationError('step'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isUserCancellation(new Error('oops'))).toBe(false);
  });

  it('returns false for ConfigurationError', () => {
    expect(isUserCancellation(new ConfigurationError('m', 'u'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isUserCancellation('cancelled')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUserCancellation(undefined)).toBe(false);
  });
});

describe('withErrorBoundary', () => {
  it('returns success outcome when operation resolves', async () => {
    const outcome = await withErrorBoundary(async () => 42);
    expect(outcome.kind).toBe('success');
    if (outcome.kind === 'success') {
      expect(outcome.value).toBe(42);
    }
  });

  it('returns cancelled outcome for UserCancellationError', async () => {
    const outcome = await withErrorBoundary(async () => {
      throw new UserCancellationError('my-step');
    });
    expect(outcome.kind).toBe('cancelled');
    if (outcome.kind === 'cancelled') {
      expect(outcome.step).toBe('my-step');
    }
  });

  it('returns domain outcome for ConfigurationError', async () => {
    const err = new ConfigurationError('internal', 'user msg', 'kilocode');
    const outcome = await withErrorBoundary(async () => { throw err; });
    expect(outcome.kind).toBe('domain');
    if (outcome.kind === 'domain') {
      expect(outcome.error).toBe(err);
    }
  });

  it('returns domain outcome for ValidationError', async () => {
    const err = new ValidationError('bad url', 'baseUrl');
    const outcome = await withErrorBoundary(async () => { throw err; });
    expect(outcome.kind).toBe('domain');
    if (outcome.kind === 'domain') {
      expect(outcome.error).toBe(err);
    }
  });

  it('returns domain outcome for DetectionError', async () => {
    const err = new DetectionError('registry missing');
    const outcome = await withErrorBoundary(async () => { throw err; });
    expect(outcome.kind).toBe('domain');
    if (outcome.kind === 'domain') {
      expect(outcome.error).toBe(err);
    }
  });

  it('returns unexpected outcome for plain Error', async () => {
    const outcome = await withErrorBoundary(async () => {
      throw new Error('boom');
    });
    expect(outcome.kind).toBe('unexpected');
    if (outcome.kind === 'unexpected') {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe('boom');
    }
  });

  it('wraps non-Error throws in an Error for unexpected outcome', async () => {
    const outcome = await withErrorBoundary(async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string error';
    });
    expect(outcome.kind).toBe('unexpected');
    if (outcome.kind === 'unexpected') {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe('string error');
    }
  });

  it('never throws itself', async () => {
    await expect(
      withErrorBoundary(async () => { throw new Error('anything'); })
    ).resolves.not.toThrow();
  });
});


describe('UserCancellationError', () => {
  it('has name "UserCancellationError"', () => {
    const err = new UserCancellationError('assistant-selection');
    expect(err.name).toBe('UserCancellationError');
  });

  it('stores the step name', () => {
    const err = new UserCancellationError('profile-selection');
    expect(err.step).toBe('profile-selection');
  });

  it('includes the step in the message', () => {
    const err = new UserCancellationError('url-input');
    expect(err.message).toContain('url-input');
  });

  it('is an instance of Error', () => {
    expect(new UserCancellationError('x')).toBeInstanceOf(Error);
  });
});

describe('ConfigurationError', () => {
  it('has name "ConfigurationError"', () => {
    const err = new ConfigurationError('internal', 'user message');
    expect(err.name).toBe('ConfigurationError');
  });

  it('stores the user message', () => {
    const err = new ConfigurationError('internal msg', 'user-friendly msg');
    expect(err.userMessage).toBe('user-friendly msg');
  });

  it('stores optional assistantKey', () => {
    const err = new ConfigurationError('msg', 'user msg', 'kilocode');
    expect(err.assistantKey).toBe('kilocode');
  });

  it('assistantKey is undefined when not provided', () => {
    const err = new ConfigurationError('msg', 'user msg');
    expect(err.assistantKey).toBeUndefined();
  });
});

describe('DetectionError', () => {
  it('has name "DetectionError"', () => {
    const err = new DetectionError('detection failed');
    expect(err.name).toBe('DetectionError');
  });

  it('preserves the message', () => {
    const err = new DetectionError('registry parse error');
    expect(err.message).toBe('registry parse error');
  });
});

describe('ValidationError', () => {
  it('has name "ValidationError"', () => {
    const err = new ValidationError('invalid URL');
    expect(err.name).toBe('ValidationError');
  });

  it('stores optional field name', () => {
    const err = new ValidationError('required', 'baseUrl');
    expect(err.field).toBe('baseUrl');
  });

  it('field is undefined when not provided', () => {
    const err = new ValidationError('required');
    expect(err.field).toBeUndefined();
  });
});

describe('isUserCancellation', () => {
  it('returns true for UserCancellationError', () => {
    expect(isUserCancellation(new UserCancellationError('step'))).toBe(true);
  });

  it('returns false for plain Error', () => {
    expect(isUserCancellation(new Error('oops'))).toBe(false);
  });

  it('returns false for ConfigurationError', () => {
    expect(isUserCancellation(new ConfigurationError('m', 'u'))).toBe(false);
  });

  it('returns false for string', () => {
    expect(isUserCancellation('cancelled')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isUserCancellation(undefined)).toBe(false);
  });
});
