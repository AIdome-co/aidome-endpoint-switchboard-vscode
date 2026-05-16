/**
 * Profile storage manager using VS Code's globalState.
 * Manages CRUD operations for endpoint profiles.
 */

import * as vscode from 'vscode';
import { EndpointProfile, ProfileMetadata, AssistantMapping } from './profileTypes';

const PROFILES_KEY = 'aidome.switchboard.profiles';
const METADATA_KEY = 'aidome.switchboard.metadata';
const MAPPINGS_KEY = 'aidome.switchboard.mappings';

/**
 * Profile store for managing endpoint profiles.
 */
export class ProfileStore {
  private static readonly changeEmitter = new vscode.EventEmitter<void>();
  static readonly onDidChange = ProfileStore.changeEmitter.event;

  constructor(private context: vscode.ExtensionContext) {}

  private static fireDidChange(): void {
    ProfileStore.changeEmitter.fire();
  }

  /**
   * Gets all stored profiles.
   * Handles corrupted state by resetting to empty array with warning.
   * @returns Promise resolving to array of profiles
   */
  async getProfiles(): Promise<EndpointProfile[]> {
    try {
      const profiles = this.context.globalState.get<EndpointProfile[]>(PROFILES_KEY, []);
      
      // Validate profiles array structure
      if (!Array.isArray(profiles)) {
        throw new Error('Profiles state is not an array');
      }
      
      // Basic validation of each profile
      for (const profile of profiles) {
        if (!profile.id || !profile.name || !profile.baseUrl) {
          throw new Error('Profile missing required fields');
        }
      }
      
      return profiles;
    } catch (error) {
      const logger = await import('../../util/log').then(m => m.Logger.getInstance());
      logger.error('Corrupted profile state detected, resetting to empty', error instanceof Error ? error : undefined);
      
      // Reset to empty array
      await this.context.globalState.update(PROFILES_KEY, []);
      
      // Show warning notification
      vscode.window.showWarningMessage(
        'Profile data was corrupted and has been reset. Please reconfigure your profiles.',
        'OK'
      );
      
      return [];
    }
  }

  /**
   * Gets a profile by name.
   * @param name The profile name
   * @returns Promise resolving to profile or undefined
   */
  async getProfileByName(name: string): Promise<EndpointProfile | undefined> {
    const profiles = await this.getProfiles();
    return profiles.find(p => p.name === name);
  }

  /**
   * Saves a profile.
   * @param profile The profile to save
   */
  async saveProfile(profile: EndpointProfile): Promise<void> {
    const profiles = await this.getProfiles();
    const index = profiles.findIndex(p => p.id === profile.id);
    
    if (index >= 0) {
      profiles[index] = profile;
    } else {
      profiles.push(profile);
    }
    
    await this.context.globalState.update(PROFILES_KEY, profiles);
    await this.updateMetadata();
    ProfileStore.fireDidChange();
  }

  /**
   * Deletes a profile by ID.
   * @param profileId The profile ID to delete
   */
  async deleteProfile(profileId: string): Promise<void> {
    const profiles = await this.getProfiles();
    const filtered = profiles.filter(p => p.id !== profileId);
    await this.context.globalState.update(PROFILES_KEY, filtered);
    await this.updateMetadata();
    ProfileStore.fireDidChange();
  }

  /**
   * Gets the active profile ID.
   * @returns Promise resolving to active profile ID or undefined
   */
  async getActiveProfileId(): Promise<string | undefined> {
    const metadata = await this.getMetadata();
    return metadata?.activeProfileId;
  }

  /**
   * Gets the active profile.
   * @returns Promise resolving to active profile or undefined
   */
  async getActiveProfile(): Promise<EndpointProfile | undefined> {
    const profileId = await this.getActiveProfileId();
    if (!profileId) {
      return undefined;
    }
    const profiles = await this.getProfiles();
    return profiles.find(p => p.id === profileId);
  }

  /**
   * Sets the active profile.
   * @param profileId The profile ID to activate
   */
  async setActiveProfile(profileId: string): Promise<void> {
    await this.updateMetadata(profileId);
    ProfileStore.fireDidChange();
  }

  /**
   * Gets all assistant mappings.
   * @returns Promise resolving to array of mappings
   */
  async getAssistantMappings(): Promise<AssistantMapping[]> {
    return this.context.globalState.get<AssistantMapping[]>(MAPPINGS_KEY, []);
  }

  /**
   * Saves an assistant mapping.
   * @param mapping The mapping to save
   */
  async saveAssistantMapping(mapping: AssistantMapping): Promise<void> {
    const mappings = await this.getAssistantMappings();
    const index = mappings.findIndex(m => m.assistantKey === mapping.assistantKey);
    
    if (index >= 0) {
      mappings[index] = mapping;
    } else {
      mappings.push(mapping);
    }
    
    await this.context.globalState.update(MAPPINGS_KEY, mappings);
    ProfileStore.fireDidChange();
  }

  /**
   * Gets storage metadata.
   */
  private async getMetadata(): Promise<ProfileMetadata | undefined> {
    return this.context.globalState.get<ProfileMetadata>(METADATA_KEY);
  }

  /**
   * Updates storage metadata.
   */
  private async updateMetadata(activeProfileId?: string): Promise<void> {
    const currentMetadata = await this.getMetadata();
    const metadata: ProfileMetadata = {
      version: '1.0.0',
      lastSync: new Date().toISOString(),
      activeProfileId: activeProfileId ?? currentMetadata?.activeProfileId
    };
    
    await this.context.globalState.update(METADATA_KEY, metadata);
  }

  /**
   * Clears all profiles and mappings.
   */
  async clearAll(): Promise<void> {
    await this.context.globalState.update(PROFILES_KEY, undefined);
    await this.context.globalState.update(METADATA_KEY, undefined);
    await this.context.globalState.update(MAPPINGS_KEY, undefined);
    ProfileStore.fireDidChange();
  }
}
