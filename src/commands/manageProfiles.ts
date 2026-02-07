/**
 * Manage Profiles command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showSuccess, showWarning } from '../ui/notifications';
import { updateStatusBar } from '../ui/statusBar';
import { Logger } from '../util/log';

/**
 * Handles the manageProfiles command.
 * Opens the profile management interface for creating, editing, and switching profiles.
 */
export async function manageProfiles(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    const profileStore = new ProfileStore(context);
    const profiles = await profileStore.getProfiles();
    const activeProfileId = await profileStore.getActiveProfileId();
    
    const actions = [
      { label: '$(add) Create New Profile', value: 'create' },
      { label: '$(list-unordered) Switch Profile', value: 'switch' },
      { label: '$(edit) Edit Profile', value: 'edit' },
      { label: '$(trash) Delete Profile', value: 'delete' }
    ];
    
    const action = await vscode.window.showQuickPick(actions, {
      placeHolder: 'What would you like to do?'
    });
    
    if (!action) {
      return;
    }
    
    switch (action.value) {
      case 'create':
        await createProfile(context, profileStore);
        break;
      case 'switch':
        await switchProfile(context, profileStore, profiles, activeProfileId);
        break;
      case 'edit':
        await editProfile(context, profileStore, profiles);
        break;
      case 'delete':
        await deleteProfile(context, profileStore, profiles, activeProfileId);
        break;
    }
  } catch (error) {
    logger.error('Failed to manage profiles', error instanceof Error ? error : undefined);
    await showError(`Failed to manage profiles: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function createProfile(context: vscode.ExtensionContext, profileStore: ProfileStore): Promise<void> {
  const logger = Logger.getInstance();
  
  const name = await vscode.window.showInputBox({
    prompt: 'Enter profile name',
    placeHolder: 'e.g., Production, Development',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Profile name cannot be empty';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return;
  }
  
  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: 'AIdome Gateway', value: 'aidome' },
      { label: 'Custom Endpoint', value: 'custom' }
    ],
    { placeHolder: 'Select profile type' }
  );
  
  if (!typeChoice) {
    return;
  }
  
  const baseUrl = await vscode.window.showInputBox({
    prompt: 'Enter base URL',
    placeHolder: typeChoice.value === 'aidome' ? 'https://api.aidome.ai' : 'https://your-endpoint.com',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Base URL cannot be empty';
      }
      try {
        new URL(value);
        return undefined;
      } catch {
        return 'Invalid URL format';
      }
    }
  });
  
  if (!baseUrl) {
    return;
  }
  
  const dialectChoice = await vscode.window.showQuickPick(
    [
      { label: 'OpenAI Chat Completions', value: 'openai.chat_completions' },
      { label: 'Anthropic Messages', value: 'anthropic.messages' },
      { label: 'OpenAI Responses', value: 'openai.responses' }
    ],
    { placeHolder: 'Select API dialect' }
  );
  
  if (!dialectChoice) {
    return;
  }
  
  let authToken: string | undefined;
  if (typeChoice.value === 'aidome') {
    authToken = await vscode.window.showInputBox({
      prompt: 'Enter authentication token (optional)',
      password: true,
      placeHolder: 'Leave empty for no authentication'
    });
  }
  
  const profile: EndpointProfile = {
    id: `profile-${Date.now()}`,
    name: name.trim(),
    profileType: typeChoice.value as 'aidome' | 'custom',
    baseUrl: baseUrl.trim(),
    dialect: dialectChoice.value as any,
    authRef: authToken ? name.trim() : undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await profileStore.saveProfile(profile);
  
  if (authToken) {
    const profileSecrets = new ProfileSecrets(context);
    await profileSecrets.storeSecret(profile.name, authToken);
  }
  
  await profileStore.setActiveProfile(profile.id);
  updateStatusBar(profile.name);
  
  await showSuccess(`Profile "${profile.name}" created and activated`);
  logger.info(`Profile created: ${profile.name}`);
}

async function switchProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profiles: EndpointProfile[],
  currentActiveId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  
  if (profiles.length === 0) {
    await showWarning('No profiles found. Create a profile first.');
    return;
  }
  
  const items = profiles.map(p => ({
    label: p.name,
    description: p.profileType === 'aidome' ? 'AIdome Gateway' : 'Custom',
    detail: `${p.baseUrl} • ${p.dialect}`,
    profile: p,
    picked: p.id === currentActiveId
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile to activate'
  });
  
  if (!selected) {
    return;
  }
  
  await profileStore.setActiveProfile(selected.profile.id);
  updateStatusBar(selected.profile.name);
  
  await showSuccess(`Switched to profile "${selected.profile.name}"`);
  logger.info(`Switched to profile: ${selected.profile.name}`);
}

async function editProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profiles: EndpointProfile[]
): Promise<void> {
  if (profiles.length === 0) {
    await showWarning('No profiles found. Create a profile first.');
    return;
  }
  
  const items = profiles.map(p => ({
    label: p.name,
    description: p.profileType,
    detail: p.baseUrl,
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile to edit'
  });
  
  if (!selected) {
    return;
  }
  
  await showWarning('Profile editing is not yet implemented. Use Create/Delete for now.');
}

async function deleteProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profiles: EndpointProfile[],
  currentActiveId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  
  if (profiles.length === 0) {
    await showWarning('No profiles found.');
    return;
  }
  
  const items = profiles.map(p => ({
    label: p.name,
    description: p.profileType,
    detail: p.baseUrl,
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a profile to delete'
  });
  
  if (!selected) {
    return;
  }
  
  const confirm = await showWarning(
    `Are you sure you want to delete profile "${selected.profile.name}"?`,
    'Delete',
    'Cancel'
  );
  
  if (confirm !== 'Delete') {
    return;
  }
  
  await profileStore.deleteProfile(selected.profile.id);
  
  if (selected.profile.authRef) {
    const profileSecrets = new ProfileSecrets(context);
    await profileSecrets.deleteSecret(selected.profile.name);
  }
  
  if (selected.profile.id === currentActiveId) {
    const remaining = await profileStore.getProfiles();
    if (remaining.length > 0) {
      await profileStore.setActiveProfile(remaining[0].id);
      updateStatusBar(remaining[0].name);
    } else {
      updateStatusBar(undefined);
    }
  }
  
  await showSuccess(`Profile "${selected.profile.name}" deleted`);
  logger.info(`Profile deleted: ${selected.profile.name}`);
}
