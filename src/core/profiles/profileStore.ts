/**
 * Profile storage manager using VS Code's globalState.
 * Manages CRUD operations for endpoint profiles.
 */

import * as vscode from 'vscode';
import { EndpointProfile, ProfileMetadata } from './profileTypes';

const PROFILES_KEY = 'aidome.switchboard.profiles';
const METADATA_KEY = 'aidome.switchboard.metadata';

/**
 * Profile store for managing endpoint profiles.
 */
export class ProfileStore {
  constructor(private context: vscode.ExtensionContext) {}

  /**
   * Gets all stored profiles.
   * @returns Promise resolving to array of profiles
   */
  async getProfiles(): Promise<EndpointProfile[]> {
    return this.context.globalState.get<EndpointProfile[]>(PROFILES_KEY, []);
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
  }

  /**
   * Gets the active profile.
   * @returns Promise resolving to active profile or undefined
   */
  async getActiveProfile(): Promise<EndpointProfile | undefined> {
    const profiles = await this.getProfiles();
    return profiles.find(p => p.isActive);
  }

  /**
   * Sets the active profile.
   * @param profileId The profile ID to activate
   */
  async setActiveProfile(profileId: string): Promise<void> {
    const profiles = await this.getProfiles();
    
    for (const profile of profiles) {
      profile.isActive = profile.id === profileId;
    }
    
    await this.context.globalState.update(PROFILES_KEY, profiles);
    await this.updateMetadata();
  }

  /**
   * Updates storage metadata.
   */
  private async updateMetadata(): Promise<void> {
    const metadata: ProfileMetadata = {
      version: '1.0.0',
      lastSync: new Date().toISOString(),
      activeProfileId: (await this.getActiveProfile())?.id
    };
    
    await this.context.globalState.update(METADATA_KEY, metadata);
  }

  /**
   * Clears all profiles.
   */
  async clearAll(): Promise<void> {
    await this.context.globalState.update(PROFILES_KEY, undefined);
    await this.context.globalState.update(METADATA_KEY, undefined);
  }
}
