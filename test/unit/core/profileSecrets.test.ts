/**
 * Unit tests for src/core/profiles/profileSecrets.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
    })),
  },
}));

vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { ProfileSecrets } from '../../../src/core/profiles/profileSecrets';

describe('ProfileSecrets', () => {
  let profileSecrets: ProfileSecrets;
  let mockSecrets: Map<string, string>;

  beforeEach(() => {
    mockSecrets = new Map();
    const mockContext = {
      secrets: {
        store: vi.fn(async (key: string, value: string) => {
          mockSecrets.set(key, value);
        }),
        get: vi.fn(async (key: string) => {
          return mockSecrets.get(key);
        }),
        delete: vi.fn(async (key: string) => {
          mockSecrets.delete(key);
        }),
      },
    };
    profileSecrets = new ProfileSecrets(mockContext as any);
  });

  describe('storeSecret', () => {
    it('stores a secret under the profile key', async () => {
      await profileSecrets.storeSecret('production', 'secret-api-key');
      expect(mockSecrets.get('aidome.switchboard.auth.production')).toBe('secret-api-key');
    });

    it('overwrites existing secret for the same profile', async () => {
      await profileSecrets.storeSecret('dev', 'old-key');
      await profileSecrets.storeSecret('dev', 'new-key');
      expect(mockSecrets.get('aidome.switchboard.auth.dev')).toBe('new-key');
    });
  });

  describe('getSecret', () => {
    it('returns stored secret', async () => {
      await profileSecrets.storeSecret('staging', 'my-secret');
      const result = await profileSecrets.getSecret('staging');
      expect(result).toBe('my-secret');
    });

    it('returns undefined for non-existent profile', async () => {
      const result = await profileSecrets.getSecret('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteSecret', () => {
    it('removes the secret for a profile', async () => {
      await profileSecrets.storeSecret('temp', 'to-delete');
      await profileSecrets.deleteSecret('temp');
      const result = await profileSecrets.getSecret('temp');
      expect(result).toBeUndefined();
    });

    it('does not throw when deleting non-existent secret', async () => {
      await expect(profileSecrets.deleteSecret('ghost')).resolves.toBeUndefined();
    });
  });

  describe('storeApiKey (legacy)', () => {
    it('stores API key under profile+assistant composite key', async () => {
      await profileSecrets.storeApiKey('profile-1', 'cline', 'sk-abc');
      expect(mockSecrets.get('aidome.switchboard.profile-1.cline')).toBe('sk-abc');
    });
  });

  describe('getApiKey (legacy)', () => {
    it('retrieves API key for profile+assistant', async () => {
      await profileSecrets.storeApiKey('profile-2', 'continue', 'sk-xyz');
      const result = await profileSecrets.getApiKey('profile-2', 'continue');
      expect(result).toBe('sk-xyz');
    });

    it('returns undefined for missing key', async () => {
      const result = await profileSecrets.getApiKey('none', 'none');
      expect(result).toBeUndefined();
    });
  });
});
