/**
 * Unit tests for path utilities.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';

// Import after any needed mocks
import { getConfigDir, expandTilde } from '../../src/util/paths';

describe('expandTilde', () => {
  it('expands ~ to home directory', () => {
    const result = expandTilde('~');
    expect(result).toBe(os.homedir());
  });

  it('expands ~/path to home directory + path', () => {
    const result = expandTilde('~/test/file.txt');
    expect(result).toBe(path.join(os.homedir(), 'test/file.txt'));
  });

  it('returns path unchanged if no tilde', () => {
    const result = expandTilde('/absolute/path');
    expect(result).toBe('/absolute/path');
  });
});

describe('getConfigDir', () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  it('uses XDG_CONFIG_HOME on Linux when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env['XDG_CONFIG_HOME'] = '/custom/config';

    const result = getConfigDir('MyApp');
    expect(result).toBe(path.join('/custom/config', 'myapp'));
  });

  it('falls back to ~/.appname on Linux when XDG_CONFIG_HOME is not set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    delete process.env['XDG_CONFIG_HOME'];

    const result = getConfigDir('MyApp');
    expect(result).toBe(path.join(os.homedir(), '.myapp'));
  });

  it('uses APPDATA on Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';

    const result = getConfigDir('MyApp');
    expect(result).toBe(path.join('C:\\Users\\test\\AppData\\Roaming', 'MyApp'));
  });

  it('uses Library/Application Support on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });

    const result = getConfigDir('MyApp');
    expect(result).toBe(path.join(os.homedir(), 'Library', 'Application Support', 'MyApp'));
  });
});
