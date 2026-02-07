/**
 * SecretStorage wrapper for profile authentication secrets.
 */

import * as vscode from 'vscode';
import { Logger } from '../../util/log';

const SECRET_KEY_PREFIX = 'aidome.switchboard.auth.';

/**
 * Profile secrets manager using VS Code SecretStorage.
 */
export class ProfileSecrets {
  private logger: Logger;

  constructor(private context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
  }

  /**
   * Stores a secret for a profile.
   * @param profileName The profile name
   * @param secret The secret to store
   */
  async storeSecret(profileName: string, secret: string): Promise<void> {
    const key = this.getSecretKey(profileName);
    await this.context.secrets.store(key, secret);
    this.logger.info(`Secret stored for profile: ${profileName}`);
    // NEVER log the secret value
  }

  /**
   * Retrieves a secret for a profile.
   * @param profileName The profile name
   * @returns Promise resolving to secret or undefined
   */
  async getSecret(profileName: string): Promise<string | undefined> {
    const key = this.getSecretKey(profileName);
    const secret = await this.context.secrets.get(key);
    if (secret) {
      this.logger.debug(`Secret retrieved for profile: ${profileName}`);
      // NEVER log the secret value
    }
    return secret;
  }

  /**
   * Deletes a secret for a profile.
   * @param profileName The profile name
   */
  async deleteSecret(profileName: string): Promise<void> {
    const key = this.getSecretKey(profileName);
    await this.context.secrets.delete(key);
    this.logger.info(`Secret deleted for profile: ${profileName}`);
  }

  /**
   * Gets the secret storage key for a profile.
   * @param profileName The profile name
   * @returns Secret storage key
   */
  private getSecretKey(profileName: string): string {
    return `${SECRET_KEY_PREFIX}${profileName}`;
  }

  // Keep legacy methods for backward compatibility
  /**
   * Stores an API key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   * @param apiKey The API key to store
   */
  async storeApiKey(profileId: string, assistantKey: string, apiKey: string): Promise<void> {
    const key = `aidome.switchboard.${profileId}.${assistantKey}`;
    await this.context.secrets.store(key, apiKey);
  }

  /**
   * Retrieves an API key for a profile and assistant.
   * @param profileId The profile ID
   * @param assistantKey The assistant key
   * @returns Promise resolving to the API key or undefined
   */
  async getApiKey(profileId: string, assistantKey: string): Promise<string | undefined> {
    const key = `aidome.switchboard.${profileId}.${assistantKey}`;
    return await this.context.secrets.get(key);
  }
}
