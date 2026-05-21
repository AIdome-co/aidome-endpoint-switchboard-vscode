/**
 * Profile storage manager using VS Code's globalState.
 * Manages CRUD operations for endpoint profiles.
 */

import * as vscode from 'vscode';
import { EndpointProfile, ProfileMetadata, AssistantMapping } from './profileTypes';

const PROFILES_KEY = 'aidome.switchboard.profiles';
const METADATA_KEY = 'aidome.switchboard.metadata';
const MAPPINGS_KEY = 'aidome.switchboard.mappings';
const VALID_APPLIED_MODES = new Set<NonNullable<AssistantMapping['appliedMode']>>([
  'settings',
  'configFile',
  'env',
  'guided'
]);

/**
 * Profile store for managing endpoint profiles.
 */
export class ProfileStore {
  constructor(private context: vscode.ExtensionContext) {}

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
  }

  /**
   * Deletes a profile by ID.
   * @param profileId The profile ID to delete
   */
  async deleteProfile(profileId: string): Promise<void> {
    const profiles = await this.getProfiles();
    const mappings = await this.getAssistantMappings();
    const filtered = profiles.filter(p => p.id !== profileId);
    const remainingMappings = mappings.filter(mapping => mapping.profileId !== profileId);
    await this.context.globalState.update(PROFILES_KEY, filtered);
    await this.context.globalState.update(MAPPINGS_KEY, remainingMappings);
    await this.updateMetadata();
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
  }

  /**
   * Gets all assistant mappings.
   * @returns Promise resolving to array of mappings
   */
  async getAssistantMappings(): Promise<AssistantMapping[]> {
    const storedMappings = this.context.globalState.get<unknown>(MAPPINGS_KEY, []);
    if (!Array.isArray(storedMappings)) {
      await this.context.globalState.update(MAPPINGS_KEY, []);
      return [];
    }

    const profiles = await this.getProfiles();
    const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
    const profilesByName = new Map(profiles.map(profile => [profile.name, profile]));
    let changed = false;

    const normalizedMappings = storedMappings.flatMap(item => {
      const normalized = normalizeMapping(item, profilesById, profilesByName);
      if (!normalized) {
        changed = true;
        return [];
      }

      if (
        itemProfileId(item) !== normalized.profileId
        || hasLegacyProfileName(item)
        || itemAppliedMode(item) !== normalized.appliedMode
        || itemAppliedAt(item) !== normalized.appliedAt
      ) {
        changed = true;
      }

      return [normalized];
    });

    const dedupedMappings: AssistantMapping[] = [];
    const mappingIndexes = new Map<string, number>();

    for (const mapping of normalizedMappings) {
      const mappingKey = getMappingKey(mapping);
      const existingIndex = mappingIndexes.get(mappingKey);

      if (existingIndex !== undefined) {
        dedupedMappings[existingIndex] = mapping;
        changed = true;
        continue;
      }

      mappingIndexes.set(mappingKey, dedupedMappings.length);
      dedupedMappings.push(mapping);
    }

    if (changed) {
      await this.context.globalState.update(MAPPINGS_KEY, dedupedMappings);
    }

    return dedupedMappings;
  }

  /**
   * Saves an assistant mapping.
   * @param mapping The mapping to save
   */
  async saveAssistantMapping(mapping: AssistantMapping): Promise<void> {
    const mappings = await this.getAssistantMappings();
    const normalizedMapping = normalizeMapping(mapping, new Map(), new Map());
    if (!normalizedMapping) {
      throw new Error(`Invalid assistant mapping for ${mapping.assistantKey}`);
    }

    const index = mappings.findIndex(m => getMappingKey(m) === getMappingKey(normalizedMapping));
    
    if (index >= 0) {
      mappings[index] = normalizedMapping;
    } else {
      mappings.push(normalizedMapping);
    }
    
    await this.context.globalState.update(MAPPINGS_KEY, mappings);
  }

  /**
   * Deletes a single assistant mapping.
   * @param assistantKey The assistant key to clear
   * @param profileId Optional profile ID to clear only that profile membership
   */
  async deleteAssistantMapping(assistantKey: string, profileId?: string): Promise<void> {
    const mappings = await this.getAssistantMappings();
    const filtered = mappings.filter(mapping => {
      if (mapping.assistantKey !== assistantKey) {
        return true;
      }

      if (profileId && mapping.profileId !== profileId) {
        return true;
      }

      return false;
    });

    if (filtered.length === mappings.length) {
      return;
    }

    await this.context.globalState.update(MAPPINGS_KEY, filtered);
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
  }
}

function normalizeMapping(
  item: unknown,
  profilesById: Map<string, EndpointProfile>,
  profilesByName: Map<string, EndpointProfile>
): AssistantMapping | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return undefined;
  }

  const candidate = item as Partial<AssistantMapping> & Record<string, unknown>;
  if (typeof candidate.assistantKey !== 'string' || candidate.assistantKey.trim().length === 0) {
    return undefined;
  }

  let profileId: string | undefined;
  if (typeof candidate.profileId === 'string' && candidate.profileId.trim().length > 0) {
    profileId = candidate.profileId.trim();
  } else if (typeof candidate.profileName === 'string' && candidate.profileName.trim().length > 0) {
    const legacyValue = candidate.profileName.trim();
    profileId = profilesById.get(legacyValue)?.id ?? profilesByName.get(legacyValue)?.id ?? legacyValue;
  }

  if (!profileId) {
    return undefined;
  }

  const normalized: AssistantMapping = {
    assistantKey: candidate.assistantKey.trim(),
    profileId
  };

  if (typeof candidate.appliedMode === 'string' && VALID_APPLIED_MODES.has(candidate.appliedMode as NonNullable<AssistantMapping['appliedMode']>)) {
    normalized.appliedMode = candidate.appliedMode as NonNullable<AssistantMapping['appliedMode']>;
  }

  if (typeof candidate.appliedAt === 'string' && candidate.appliedAt.trim().length > 0) {
    normalized.appliedAt = candidate.appliedAt;
  }

  return normalized;
}

function itemProfileId(item: unknown): string | undefined {
  return typeof item === 'object'
    && item !== null
    && 'profileId' in item
    && typeof (item as { profileId?: unknown }).profileId === 'string'
    ? (item as { profileId: string }).profileId
    : undefined;
}

function hasLegacyProfileName(item: unknown): boolean {
  return typeof item === 'object'
    && item !== null
    && 'profileName' in item
    && typeof (item as { profileName?: unknown }).profileName === 'string';
}

function itemAppliedMode(item: unknown): AssistantMapping['appliedMode'] | undefined {
  return typeof item === 'object'
    && item !== null
    && 'appliedMode' in item
    && typeof (item as { appliedMode?: unknown }).appliedMode === 'string'
    ? (item as { appliedMode: AssistantMapping['appliedMode'] }).appliedMode
    : undefined;
}

function itemAppliedAt(item: unknown): string | undefined {
  return typeof item === 'object'
    && item !== null
    && 'appliedAt' in item
    && typeof (item as { appliedAt?: unknown }).appliedAt === 'string'
    ? (item as { appliedAt: string }).appliedAt
    : undefined;
}

function getMappingKey(mapping: AssistantMapping): string {
  return `${mapping.assistantKey}::${mapping.profileId}`;
}
