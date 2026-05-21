/**
 * Unit tests for ProfileStore.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfileStore } from '../../../src/core/profiles/profileStore';
import { EndpointProfile, AssistantMapping } from '../../../src/core/profiles/profileTypes';

// Mock vscode module
vi.mock('vscode', () => ({
  window: {
    showWarningMessage: vi.fn().mockResolvedValue('OK')
  }
}));

// Mock logger
vi.mock('../../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })
  }
}));

// Mock VS Code extension context
class MockExtensionContext {
  private storage = new Map<string, unknown>();
  private warningShown = false;

  globalState = {
    get: <T>(key: string, defaultValue?: T): T => {
      return (this.storage.get(key) as T) ?? (defaultValue as T);
    },
    update: async (key: string, value: unknown): Promise<void> => {
      this.storage.set(key, value);
    },
    setKeysForSync: () => {}
  };

  workspaceState = this.globalState;
  subscriptions: unknown[] = [];
  extensionPath = '';
  storagePath = '';
  globalStoragePath = '';
  logPath = '';
  extensionUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  environmentVariableCollection = {} as any;
  extensionMode = 1;
  storageUri = undefined;
  globalStorageUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  logUri = { toString: () => '', scheme: '', authority: '', path: '', query: '', fragment: '', fsPath: '', with: () => ({} as any), toJSON: () => ({}) };
  secrets = {} as any;
  extension = {} as any;
  languageModelAccessInformation = {} as any;

  // Track if warning was shown
  public wasWarningShown(): boolean {
    return this.warningShown;
  }

  public resetWarning(): void {
    this.warningShown = false;
  }

  keys: readonly string[] = [];
  setKeysForSync = (keys: readonly string[]) => {};
}

describe('ProfileStore', () => {
  let profileStore: ProfileStore;
  let context: MockExtensionContext;

  beforeEach(() => {
    context = new MockExtensionContext();
    profileStore = new ProfileStore(context as any);
  });

  describe('getProfiles', () => {
    it('should return empty array initially', async () => {
      const profiles = await profileStore.getProfiles();
      expect(profiles).toEqual([]);
    });

    it('should return stored profiles', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-1',
        name: 'test-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        profileType: 'aidome'
      };

      await profileStore.saveProfile(testProfile);
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toEqual(testProfile);
    });

    it('should handle corrupted state and reset', async () => {
      // Manually corrupt the state
      await context.globalState.update('aidome.switchboard.profiles', 'invalid-data');

      const profiles = await profileStore.getProfiles();

      expect(profiles).toEqual([]);
    });

    it('should handle profiles missing required fields', async () => {
      // Set invalid profile missing required fields
      await context.globalState.update('aidome.switchboard.profiles', [
        { id: 'test', name: 'test' } // missing baseUrl
      ]);

      const profiles = await profileStore.getProfiles();

      expect(profiles).toEqual([]);
    });
  });

  describe('getProfileByName', () => {
    it('should return undefined for non-existent profile', async () => {
      const profile = await profileStore.getProfileByName('nonexistent');
      expect(profile).toBeUndefined();
    });

    it('should return profile by name', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-1',
        name: 'my-profile',
        baseUrl: 'https://api.aidome.cloud',
        dialect: 'openai.chat_completions',
        profileType: 'aidome'
      };

      await profileStore.saveProfile(testProfile);
      const profile = await profileStore.getProfileByName('my-profile');

      expect(profile).toEqual(testProfile);
    });
  });

  describe('saveProfile', () => {
    it('should save a new profile', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-1',
        name: 'new-profile',
        baseUrl: 'https://api.example.com',
        dialect: 'anthropic.messages',
        profileType: 'custom'
      };

      await profileStore.saveProfile(testProfile);
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0]).toEqual(testProfile);
    });

    it('should update existing profile by ID', async () => {
      const originalProfile: EndpointProfile = {
        id: 'prof-1',
        name: 'original',
        baseUrl: 'https://api.old.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      await profileStore.saveProfile(originalProfile);

      const updatedProfile: EndpointProfile = {
        ...originalProfile,
        name: 'updated',
        baseUrl: 'https://api.new.com'
      };

      await profileStore.saveProfile(updatedProfile);
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].name).toBe('updated');
      expect(profiles[0].baseUrl).toBe('https://api.new.com');
    });

    it('should handle multiple profiles', async () => {
      const profile1: EndpointProfile = {
        id: 'prof-1',
        name: 'profile-1',
        baseUrl: 'https://api1.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      const profile2: EndpointProfile = {
        id: 'prof-2',
        name: 'profile-2',
        baseUrl: 'https://api2.com',
        dialect: 'anthropic.messages',
        profileType: 'custom'
      };

      await profileStore.saveProfile(profile1);
      await profileStore.saveProfile(profile2);
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(2);
    });
  });

  describe('deleteProfile', () => {
    it('should delete a profile by ID', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-delete',
        name: 'to-delete',
        baseUrl: 'https://api.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      await profileStore.saveProfile(testProfile);
      await profileStore.deleteProfile('prof-delete');
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(0);
    });

    it('should not affect other profiles when deleting', async () => {
      const profile1: EndpointProfile = {
        id: 'prof-1',
        name: 'keep-this',
        baseUrl: 'https://api1.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      const profile2: EndpointProfile = {
        id: 'prof-2',
        name: 'delete-this',
        baseUrl: 'https://api2.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      await profileStore.saveProfile(profile1);
      await profileStore.saveProfile(profile2);
      await profileStore.deleteProfile('prof-2');
      const profiles = await profileStore.getProfiles();

      expect(profiles).toHaveLength(1);
      expect(profiles[0].id).toBe('prof-1');
    });

    it('removes legacy profileName mappings before deleting the profile record', async () => {
      const profileToDelete: EndpointProfile = {
        id: 'prof-legacy',
        name: 'legacy-profile',
        baseUrl: 'https://api.legacy.example.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };
      const profileToKeep: EndpointProfile = {
        id: 'prof-keep',
        name: 'keep-profile',
        baseUrl: 'https://api.keep.example.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      await profileStore.saveProfile(profileToDelete);
      await profileStore.saveProfile(profileToKeep);
      await context.globalState.update('aidome.switchboard.mappings', [
        {
          assistantKey: 'cline',
          profileName: 'legacy-profile',
          appliedMode: 'settings',
          appliedAt: '2026-05-20T00:00:00.000Z'
        },
        {
          assistantKey: 'continue',
          profileId: 'prof-keep',
          appliedMode: 'settings',
          appliedAt: '2026-05-20T00:00:00.000Z'
        }
      ]);

      await profileStore.deleteProfile('prof-legacy');

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([
        {
          assistantKey: 'continue',
          profileId: 'prof-keep',
          appliedMode: 'settings',
          appliedAt: '2026-05-20T00:00:00.000Z'
        }
      ]);
    });
  });

  describe('active profile management', () => {
    it('should return undefined for active profile initially', async () => {
      const activeProfileId = await profileStore.getActiveProfileId();
      expect(activeProfileId).toBeUndefined();
    });

    it('should set and get active profile ID', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-active',
        name: 'active-profile',
        baseUrl: 'https://api.com',
        dialect: 'openai.chat_completions',
        profileType: 'aidome'
      };

      await profileStore.saveProfile(testProfile);
      await profileStore.setActiveProfile('prof-active');
      const activeProfileId = await profileStore.getActiveProfileId();

      expect(activeProfileId).toBe('prof-active');
    });

    it('should get active profile object', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-active',
        name: 'active-profile',
        baseUrl: 'https://api.com',
        dialect: 'openai.chat_completions',
        profileType: 'aidome'
      };

      await profileStore.saveProfile(testProfile);
      await profileStore.setActiveProfile('prof-active');
      const activeProfile = await profileStore.getActiveProfile();

      expect(activeProfile).toEqual(testProfile);
    });

    it('should return undefined when active profile does not exist', async () => {
      await profileStore.setActiveProfile('nonexistent-id');
      const activeProfile = await profileStore.getActiveProfile();

      expect(activeProfile).toBeUndefined();
    });
  });

  describe('assistant mappings', () => {
    it('should return empty array for mappings initially', async () => {
      const mappings = await profileStore.getAssistantMappings();
      expect(mappings).toEqual([]);
    });

    it('should reset mappings when stored state is not an array', async () => {
      await context.globalState.update('aidome.switchboard.mappings', 'invalid-data');

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([]);
      expect(context.globalState.get('aidome.switchboard.mappings')).toEqual([]);
    });

    it('should save and retrieve assistant mapping', async () => {
      const mapping: AssistantMapping = {
        assistantKey: 'continue',
        profileId: 'prof-1'
      };

      await profileStore.saveAssistantMapping(mapping);
      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toHaveLength(1);
      expect(mappings[0]).toEqual(mapping);
    });

    it('should update existing mapping by assistant key and profile ID', async () => {
      const originalMapping: AssistantMapping = {
        assistantKey: 'continue',
        profileId: 'prof-1',
        appliedMode: 'settings'
      };

      await profileStore.saveAssistantMapping(originalMapping);

      const updatedMapping: AssistantMapping = {
        assistantKey: 'continue',
        profileId: 'prof-1',
        appliedMode: 'configFile'
      };

      await profileStore.saveAssistantMapping(updatedMapping);
      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toHaveLength(1);
      expect(mappings[0].profileId).toBe('prof-1');
      expect(mappings[0].appliedMode).toBe('configFile');
    });

    it('should preserve mappings for the same assistant across multiple profiles', async () => {
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-1'
      });
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-2'
      });

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toHaveLength(2);
      expect(mappings).toEqual(expect.arrayContaining([
        { assistantKey: 'claude-code', profileId: 'prof-1' },
        { assistantKey: 'claude-code', profileId: 'prof-2' }
      ]));
    });

    it('should normalize legacy profileName mappings to profileId and dedupe duplicates', async () => {
      await profileStore.saveProfile({
        id: 'prof-1',
        name: 'Production',
        baseUrl: 'https://api.example.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      });
      await context.globalState.update('aidome.switchboard.mappings', [
        {
          assistantKey: 'cline',
          profileName: 'Production',
          appliedMode: 'settings',
          appliedAt: '2026-05-21T00:00:00.000Z'
        },
        {
          assistantKey: 'cline',
          profileId: 'prof-1',
          appliedMode: 'configFile',
          appliedAt: '2026-05-22T00:00:00.000Z'
        },
        {
          assistantKey: '',
          profileId: 'prof-1'
        }
      ]);

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([
        {
          assistantKey: 'cline',
          profileId: 'prof-1',
          appliedMode: 'configFile',
          appliedAt: '2026-05-22T00:00:00.000Z'
        }
      ]);
    });

    it('should handle multiple assistant mappings', async () => {
      const mapping1: AssistantMapping = {
        assistantKey: 'continue',
        profileId: 'prof-1'
      };

      const mapping2: AssistantMapping = {
        assistantKey: 'cline',
        profileId: 'prof-2'
      };

      await profileStore.saveAssistantMapping(mapping1);
      await profileStore.saveAssistantMapping(mapping2);
      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toHaveLength(2);
    });

    it('should delete only the targeted profile mapping for an assistant', async () => {
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-1'
      });
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-2'
      });

      await profileStore.deleteAssistantMapping('claude-code', 'prof-1');

      const mappings = await profileStore.getAssistantMappings();
      expect(mappings).toEqual([{ assistantKey: 'claude-code', profileId: 'prof-2' }]);
    });

    it('should leave mappings unchanged when deleting a different assistant key', async () => {
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-1'
      });

      await profileStore.deleteAssistantMapping('continue');

      const mappings = await profileStore.getAssistantMappings();
      expect(mappings).toEqual([{ assistantKey: 'claude-code', profileId: 'prof-1' }]);
    });

    it('should leave mappings unchanged when the profile scope does not match', async () => {
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-1'
      });
      await profileStore.saveAssistantMapping({
        assistantKey: 'claude-code',
        profileId: 'prof-2'
      });

      await profileStore.deleteAssistantMapping('claude-code', 'prof-3');

      const mappings = await profileStore.getAssistantMappings();
      expect(mappings).toEqual(expect.arrayContaining([
        { assistantKey: 'claude-code', profileId: 'prof-1' },
        { assistantKey: 'claude-code', profileId: 'prof-2' }
      ]));
    });

    it('should preserve unknown legacy profileName values as profileId strings', async () => {
      await context.globalState.update('aidome.switchboard.mappings', [
        {
          assistantKey: 'cline',
          profileName: 'legacy-profile'
        }
      ]);

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([{ assistantKey: 'cline', profileId: 'legacy-profile' }]);
    });

    it('should drop array entries from stored mappings', async () => {
      await context.globalState.update('aidome.switchboard.mappings', [[]]);

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([]);
    });

    it('should drop legacy profileName values that are not strings', async () => {
      await context.globalState.update('aidome.switchboard.mappings', [
        {
          assistantKey: 'cline',
          profileName: 123
        }
      ]);

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([]);
    });

    it('should drop mappings that still have no profile after normalization', async () => {
      await context.globalState.update('aidome.switchboard.mappings', [
        {
          assistantKey: 'cline',
          profileName: '   '
        }
      ]);

      const mappings = await profileStore.getAssistantMappings();

      expect(mappings).toEqual([]);
    });

    it('should reject invalid mappings when saving', async () => {
      await expect(profileStore.saveAssistantMapping({
        assistantKey: '   ',
        profileId: 'prof-1'
      })).rejects.toThrow('Invalid assistant mapping');
    });
  });

  describe('clearAll', () => {
    it('should clear all profiles, metadata, and mappings', async () => {
      const testProfile: EndpointProfile = {
        id: 'prof-1',
        name: 'test',
        baseUrl: 'https://api.com',
        dialect: 'openai.chat_completions',
        profileType: 'custom'
      };

      const mapping: AssistantMapping = {
        assistantKey: 'continue',
        profileId: 'prof-1'
      };

      await profileStore.saveProfile(testProfile);
      await profileStore.setActiveProfile('prof-1');
      await profileStore.saveAssistantMapping(mapping);

      await profileStore.clearAll();

      const profiles = await profileStore.getProfiles();
      const activeProfileId = await profileStore.getActiveProfileId();
      const mappings = await profileStore.getAssistantMappings();

      expect(profiles).toEqual([]);
      expect(activeProfileId).toBeUndefined();
      expect(mappings).toEqual([]);
    });
  });
});
