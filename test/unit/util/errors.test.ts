/**
 * Unit tests for typed error classes in src/util/errors.ts
 */

import { describe, it, expect } from 'vitest';
import {
  UserCancellationError,
  ConfigurationError,
  DetectionError,
  ValidationError,
  isUserCancellation
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
