/**
 * Secure storage for API keys and secrets using VS Code's SecretStorage.
 */

import * as vscode from 'vscode';

/**
 * Profile secrets manager wrapping VS Code's SecretStorage.
 */
export class ProfileSecrets {
  constructor(private secrets: vscode.SecretStorage) {}

  /**
   * Stores an API key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   * @param apiKey The API key to store
   */
  async storeApiKey(profileId: string, assistantKey: string, apiKey: string): Promise<void> {
    const key = this.makeKey(profileId, assistantKey);
    await this.secrets.store(key, apiKey);
  }

  /**
   * Retrieves an API key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   * @returns Promise resolving to the API key or undefined
   */
  async getApiKey(profileId: string, assistantKey: string): Promise<string | undefined> {
    const key = this.makeKey(profileId, assistantKey);
    return await this.secrets.get(key);
  }

  /**
   * Deletes an API key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   */
  async deleteApiKey(profileId: string, assistantKey: string): Promise<void> {
    const key = this.makeKey(profileId, assistantKey);
    await this.secrets.delete(key);
  }

  /**
   * Deletes all API keys for a profile.
   * @param profileId The profile ID
   */
  async deleteProfileKeys(profileId: string): Promise<void> {
    // Note: VS Code SecretStorage doesn't support listing keys,
    // so we'd need to maintain a separate index if we need this functionality
    // For now, this is a placeholder
  }

  /**
   * Creates a storage key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   * @returns The composite key
   */
  private makeKey(profileId: string, assistantKey: string): string {
    return `aidome.switchboard.${profileId}.${assistantKey}`;
  }
}
