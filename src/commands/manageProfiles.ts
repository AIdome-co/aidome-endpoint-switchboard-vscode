/**
 * Manage Profiles command handler with full CRUD flow.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { validateUrl } from '../core/profiles/profileValidator';
import { EndpointProfile, AssistantMapping } from '../core/profiles/profileTypes';
import { Verifier, VerificationReport } from '../core/orchestration/verifier';
import { detectRemote } from '../core/detection/detectRemote';
import { getOutputChannel } from '../presentation/output';
import { updateStatusBar } from '../presentation/statusBar';
import { showError, showSuccess, showWarning } from '../presentation/notifications';
import { Logger } from '../util/log';
import { Dialect } from '../core/dialects/dialectTypes';
import { activateProfileAndReapplyMappings, getProfileActivationNotice } from './profileActivation';

interface ProfileQuickPickItem extends vscode.QuickPickItem {
  profile: EndpointProfile;
}

interface DialectQuickPickItem extends vscode.QuickPickItem {
  dialect?: Dialect;
}

/**
 * Handles the manageProfiles command.
 * Opens the profile management interface with full CRUD operations.
 */
export async function manageProfiles(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    if (profileId) {
      const profileStore = new ProfileStore(context);
      const profiles = await profileStore.getProfiles();
      const matchedProfile = profiles.find(profile => profile.id === profileId);

      if (matchedProfile) {
        await showProfileDetails(context, matchedProfile);
        return;
      }

      logger.warning(`Requested profile ${profileId} was not found; opening main profile menu instead.`);
    }

    await showMainMenu(context);
  } catch (error) {
    logger.error('Failed to manage profiles', error instanceof Error ? error : undefined);
    await showError(`Failed to manage profiles: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Shows the main profile management menu.
 */
async function showMainMenu(context: vscode.ExtensionContext): Promise<void> {
  const profileStore = new ProfileStore(context);
  const profiles = await profileStore.getProfiles();
  const mappings = await profileStore.getAssistantMappings();
  
  const items: (vscode.QuickPickItem | ProfileQuickPickItem)[] = [
    {
      label: '$(add) Create New Profile',
      description: '',
      detail: 'Create a new endpoint profile'
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator }
  ];
  
  // Add existing profiles with status
  for (const profile of profiles) {
    const assistantCount = mappings.filter(m => m.profileName === profile.name).length;
    const status = getProfileStatusIcon(profile);
    const lastVerified = profile.lastVerified 
      ? formatLastVerified(profile.lastVerified)
      : 'Never verified';
    
    items.push({
      label: `$(list-unordered) ${profile.name}`,
      description: `${profile.baseUrl} ${status} ${lastVerified}`,
      detail: `${assistantCount} assistant${assistantCount !== 1 ? 's' : ''}`,
      profile
    } as ProfileQuickPickItem);
  }
  
  if (profiles.length > 0) {
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: '$(star) Set Active Profile',
      description: '',
      detail: 'Switch mapped assistants to a different active profile'
    });
  }
  
  const selected = await vscode.window.showQuickPick(items, {
    title: 'AIdome: Manage Profiles',
    placeHolder: 'Select an option'
  });
  
  if (!selected) {
    return;
  }
  
  if (selected.label.includes('Create New Profile')) {
    await createProfileFlow(context);
  } else if (selected.label.includes('Set Active Profile')) {
    await setDefaultProfile(context, profileStore, profiles);
  } else if ('profile' in selected) {
    await showProfileDetails(context, selected.profile);
  }
}

/**
 * Creates a new profile with full validation and verification.
 */
async function createProfileFlow(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const existingProfiles = await profileStore.getProfiles();
  let completionNotification:
    | { kind: 'success' | 'warning' | 'error'; message: string }
    | undefined;
  
  // Step 1: Profile name
  const name = await vscode.window.showInputBox({
    title: 'Create Profile (1/6): Profile Name',
    prompt: 'Enter a unique profile name',
    placeHolder: 'e.g., Production API, Dev Server',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Profile name cannot be empty';
      }
      if (value.length > 100) {
        return 'Profile name must be 100 characters or less';
      }
      if (existingProfiles.some(p => p.name === value.trim())) {
        return 'A profile with this name already exists';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return;
  }
  
  // Step 2: Base URL
  const baseUrl = await vscode.window.showInputBox({
    title: 'Create Profile (2/6): Base URL',
    prompt: 'Enter the endpoint base URL',
    placeHolder: 'https://api.example.com or http://localhost:8080',
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Base URL cannot be empty';
      }
      if (!validateUrl(value.trim())) {
        return 'URL must be https:// or http://localhost for development';
      }
      return undefined;
    }
  });
  
  if (!baseUrl) {
    return;
  }
  
  // Step 3: Dialect selection
  const dialectOptions: DialectQuickPickItem[] = [
    {
      label: '$(search) Auto-detect',
      description: 'Attempt to detect dialect from endpoint',
      detail: 'Recommended for AIdome gateways',
      dialect: undefined
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: 'openai.chat_completions',
      description: 'OpenAI Chat Completions API',
      dialect: 'openai.chat_completions'
    },
    {
      label: 'openai.responses',
      description: 'OpenAI Responses API',
      dialect: 'openai.responses'
    },
    {
      label: 'anthropic.messages',
      description: 'Anthropic Messages API',
      dialect: 'anthropic.messages'
    },
    {
      label: 'google.gemini.generate_content',
      description: 'Google Gemini API',
      dialect: 'google.gemini.generate_content'
    },
    {
      label: 'github.copilot',
      description: 'GitHub Copilot API',
      dialect: 'github.copilot'
    },
    {
      label: 'tabnine.proprietary',
      description: 'TabNine Proprietary API',
      dialect: 'tabnine.proprietary'
    }
  ];
  
  const dialectChoice = await vscode.window.showQuickPick(dialectOptions, {
    title: 'Create Profile (3/6): Dialect',
    placeHolder: 'Select API dialect'
  });
  
  if (!dialectChoice) {
    return;
  }
  
  // Step 4: If auto-detect, use default for now (can be enhanced later)
  // openai.chat_completions is the most widely supported dialect across LLM providers
  let dialect: Dialect = dialectChoice.dialect || 'openai.chat_completions';
  
  if (!dialectChoice.dialect) {
    await vscode.window.showInformationMessage('Auto-detect selected. Using openai.chat_completions as default.');
  }
  
  // Step 5: Auth token (optional)
  const authToken = await vscode.window.showInputBox({
    title: 'Create Profile (4/6): Authentication Token',
    prompt: 'Enter authentication token (optional)',
    password: true,
    placeHolder: 'Leave empty for no authentication'
  });
  
  // Step 6: Tenant (optional)
  const tenant = await vscode.window.showInputBox({
    title: 'Create Profile (5/6): Tenant',
    prompt: 'Enter tenant identifier (optional)',
    placeHolder: 'e.g., my-org, team-name'
  });
  
  // Create the profile
  const profile: EndpointProfile = {
    id: `profile-${Date.now()}`,
    name: name.trim(),
    profileType: 'custom',
    baseUrl: baseUrl.trim(),
    dialect,
    authRef: authToken ? name.trim() : undefined,
    tenant: tenant?.trim() || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  await profileStore.saveProfile(profile);
  
  if (authToken) {
    const profileSecrets = new ProfileSecrets(context);
    await profileSecrets.storeSecret(profile.name, authToken);
  }
  
  logger.info(`Profile created: ${profile.name}`);
  
  // Step 7: Verify connection immediately
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Verifying connection to ${profile.name}...`,
    cancellable: false
  }, async () => {
    const verifier = new Verifier();
    const remoteContext = detectRemote(profile.baseUrl);
    
    try {
      const report = await verifier.runVerificationPipeline(profile, {
        includeTestPrompt: false,
        remoteContext,
        authToken: authToken?.trim() || undefined
      });
      
      // Update profile with verification timestamp
      profile.lastVerified = report.timestamp;
      await profileStore.saveProfile(profile);
      
      // Show results
      displayVerificationResults(report);
      
      if (report.overallStatus === 'passed') {
        completionNotification = {
          kind: 'success',
          message: `Profile "${profile.name}" created and verified successfully!`
        };
      } else if (report.overallStatus === 'partial') {
        completionNotification = {
          kind: 'warning',
          message: `Profile "${profile.name}" created with warnings. Check output for details.`
        };
      } else {
        completionNotification = {
          kind: 'error',
          message: `Profile "${profile.name}" created but verification failed. Check output for details.`
        };
      }
    } catch (error) {
      logger.error('Verification failed', error instanceof Error ? error : undefined);
      completionNotification = {
        kind: 'warning',
        message: `Profile created but verification encountered an error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });

  if (completionNotification?.kind === 'success') {
    await showSuccess(completionNotification.message);
  } else if (completionNotification?.kind === 'warning') {
    await showWarning(completionNotification.message);
  } else if (completionNotification?.kind === 'error') {
    await showError(completionNotification.message);
  }
  
  // Return to main menu
  await showMainMenu(context);
}

/**
 * Shows profile details and available actions.
 */
async function showProfileDetails(context: vscode.ExtensionContext, profile: EndpointProfile): Promise<void> {
  const profileStore = new ProfileStore(context);
  const mappings = await profileStore.getAssistantMappings();
  const assistantCount = mappings.filter(m => m.profileName === profile.name).length;
  
  const lastVerifiedText = profile.lastVerified 
    ? `${new Date(profile.lastVerified).toISOString().replace('T', ' ').substring(0, 19)} UTC ${getProfileStatusIcon(profile)}`
    : 'Never verified';
  
  const items: vscode.QuickPickItem[] = [
    {
      label: `Base URL: ${profile.baseUrl}`,
      kind: vscode.QuickPickItemKind.Default
    },
    {
      label: `Dialect: ${profile.dialect}`,
      kind: vscode.QuickPickItemKind.Default
    },
    {
      label: `Tenant: ${profile.tenant || '(none)'}`,
      kind: vscode.QuickPickItemKind.Default
    },
    {
      label: `Last Verified: ${lastVerifiedText}`,
      kind: vscode.QuickPickItemKind.Default
    },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    {
      label: '$(pencil) Edit Profile',
      description: '',
      detail: 'Modify profile settings'
    },
    {
      label: '$(debug-start) Test Connection',
      description: '',
      detail: 'Run verification pipeline'
    },
    {
      label: '$(trash) Delete Profile',
      description: '',
      detail: 'Remove this profile'
    },
    {
      label: `$(link) View Mapped Assistants (${assistantCount})`,
      description: '',
      detail: 'See which assistants use this profile'
    }
  ];
  
  const selected = await vscode.window.showQuickPick(items, {
    title: `Profile: ${profile.name}`,
    placeHolder: 'Select an action'
  });
  
  if (!selected) {
    await showMainMenu(context);
    return;
  }
  
  if (selected.label.includes('Edit Profile')) {
    await editProfileFlow(context, profile);
  } else if (selected.label.includes('Test Connection')) {
    await testConnection(context, profile);
    await showProfileDetails(context, profile);
  } else if (selected.label.includes('Delete Profile')) {
    await deleteProfileFlow(context, profile);
  } else if (selected.label.includes('View Mapped Assistants')) {
    await viewMappedAssistants(context, profile, mappings);
    await showProfileDetails(context, profile);
  } else {
    await showProfileDetails(context, profile);
  }
}

/**
 * Edits an existing profile.
 */
async function editProfileFlow(context: vscode.ExtensionContext, profile: EndpointProfile): Promise<void> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const mappings = await profileStore.getAssistantMappings();
  const assistantCount = mappings.filter(m => m.profileName === profile.name).length;
  
  const fieldOptions: vscode.QuickPickItem[] = [
    {
      label: '$(edit) Name',
      description: profile.name,
      detail: 'Change profile name'
    },
    {
      label: '$(globe) Base URL',
      description: profile.baseUrl,
      detail: 'Change endpoint URL'
    },
    {
      label: '$(symbol-keyword) Dialect',
      description: profile.dialect,
      detail: 'Change API dialect'
    },
    {
      label: '$(key) Auth Token',
      description: profile.authRef ? '(configured)' : '(not set)',
      detail: 'Update authentication token'
    },
    {
      label: '$(organization) Tenant',
      description: profile.tenant || '(not set)',
      detail: 'Update tenant identifier'
    }
  ];
  
  const fieldChoice = await vscode.window.showQuickPick(fieldOptions, {
    title: `Edit Profile: ${profile.name}`,
    placeHolder: 'Select field to edit'
  });
  
  if (!fieldChoice) {
    await showProfileDetails(context, profile);
    return;
  }
  
  let modified = false;
  const existingProfiles = await profileStore.getProfiles();
  
  if (fieldChoice.label.includes('Name')) {
    const newName = await vscode.window.showInputBox({
      title: 'Edit Profile Name',
      prompt: 'Enter new profile name',
      value: profile.name,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'Profile name cannot be empty';
        }
        if (value.length > 100) {
          return 'Profile name must be 100 characters or less';
        }
        if (value.trim() !== profile.name && existingProfiles.some(p => p.name === value.trim())) {
          return 'A profile with this name already exists';
        }
        return undefined;
      }
    });
    
    if (newName && newName.trim() !== profile.name) {
      // Update mappings to use new name
      for (const mapping of mappings.filter(m => m.profileName === profile.name)) {
        mapping.profileName = newName.trim();
        await profileStore.saveAssistantMapping(mapping);
      }
      
      // Update secrets if they exist
      if (profile.authRef) {
        const secrets = new ProfileSecrets(context);
        const token = await secrets.getSecret(profile.name);
        if (token) {
          await secrets.deleteSecret(profile.name);
          await secrets.storeSecret(newName.trim(), token);
        }
        profile.authRef = newName.trim();
      }
      
      profile.name = newName.trim();
      modified = true;
    }
  } else if (fieldChoice.label.includes('Base URL')) {
    const newUrl = await vscode.window.showInputBox({
      title: 'Edit Base URL',
      prompt: 'Enter new base URL',
      value: profile.baseUrl,
      validateInput: (value) => {
        if (!value.trim()) {
          return 'Base URL cannot be empty';
        }
        if (!validateUrl(value.trim())) {
          return 'URL must be https:// or http://localhost for development';
        }
        return undefined;
      }
    });
    
    if (newUrl && newUrl.trim() !== profile.baseUrl) {
      profile.baseUrl = newUrl.trim();
      modified = true;
    }
  } else if (fieldChoice.label.includes('Dialect')) {
    interface EditDialectQuickPickItem extends vscode.QuickPickItem {
      dialect: Dialect;
    }
    
    const dialectOptions: EditDialectQuickPickItem[] = [
      { label: 'openai.chat_completions', description: 'OpenAI Chat Completions API', dialect: 'openai.chat_completions' },
      { label: 'openai.responses', description: 'OpenAI Responses API', dialect: 'openai.responses' },
      { label: 'anthropic.messages', description: 'Anthropic Messages API', dialect: 'anthropic.messages' },
      { label: 'google.gemini.generate_content', description: 'Google Gemini API', dialect: 'google.gemini.generate_content' },
      { label: 'github.copilot', description: 'GitHub Copilot API', dialect: 'github.copilot' },
      { label: 'tabnine.proprietary', description: 'TabNine Proprietary API', dialect: 'tabnine.proprietary' }
    ];
    
    const dialectChoice = await vscode.window.showQuickPick(dialectOptions, {
      title: 'Edit Dialect',
      placeHolder: 'Select new dialect'
    });
    
    if (dialectChoice && dialectChoice.dialect !== profile.dialect) {
      profile.dialect = dialectChoice.dialect;
      modified = true;
    }
  } else if (fieldChoice.label.includes('Auth Token')) {
    const newToken = await vscode.window.showInputBox({
      title: 'Edit Auth Token',
      prompt: 'Enter new authentication token (leave empty to remove)',
      password: true,
      placeHolder: 'Authentication token'
    });
    
    if (newToken !== undefined) {
      const secrets = new ProfileSecrets(context);
      
      if (newToken.trim()) {
        await secrets.storeSecret(profile.name, newToken.trim());
        profile.authRef = profile.name;
      } else {
        await secrets.deleteSecret(profile.name);
        profile.authRef = undefined;
      }
      modified = true;
    }
  } else if (fieldChoice.label.includes('Tenant')) {
    const newTenant = await vscode.window.showInputBox({
      title: 'Edit Tenant',
      prompt: 'Enter tenant identifier (leave empty to remove)',
      value: profile.tenant || '',
      placeHolder: 'e.g., my-org, team-name'
    });
    
    if (newTenant !== undefined && newTenant.trim() !== (profile.tenant || '')) {
      profile.tenant = newTenant.trim() || undefined;
      modified = true;
    }
  }
  
  if (modified) {
    profile.updatedAt = new Date().toISOString();
    await profileStore.saveProfile(profile);
    logger.info(`Profile updated: ${profile.name}`);
    
    // Offer to re-verify
    const shouldVerify = await vscode.window.showQuickPick(
      [
        { label: 'Yes', value: true },
        { label: 'No', value: false }
      ],
      {
        title: 'Re-verify Connection?',
        placeHolder: 'Would you like to test the connection with the updated settings?'
      }
    );
    
    if (shouldVerify?.value) {
      await testConnection(context, profile);
    }
    
    // If assistants are mapped, ask about re-applying configuration
    if (assistantCount > 0) {
      const shouldReapply = await vscode.window.showQuickPick(
        [
          { label: 'Yes', value: true },
          { label: 'No', value: false }
        ],
        {
          title: 'Re-apply Configuration?',
          placeHolder: `${assistantCount} assistant${assistantCount !== 1 ? 's use' : ' uses'} this profile. Re-apply configuration?`
        }
      );
      
      if (shouldReapply?.value) {
        await showSuccess('Configuration re-application would be handled by the setup flow.');
      }
    }
    
    await showSuccess(`Profile "${profile.name}" updated successfully`);
  }
  
  await showProfileDetails(context, profile);
}

/**
 * Deletes a profile with confirmation and reassignment.
 */
async function deleteProfileFlow(context: vscode.ExtensionContext, profile: EndpointProfile): Promise<void> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const mappings = await profileStore.getAssistantMappings();
  const profileMappings = mappings.filter(m => m.profileName === profile.name);
  const assistantCount = profileMappings.length;
  
  let confirmMessage = `Delete profile '${profile.name}'?`;
  if (assistantCount > 0) {
    confirmMessage = `⚠️ ${assistantCount} assistant${assistantCount !== 1 ? 's are' : ' is'} configured with this profile. They will become unconfigured.`;
  }
  
  const options: vscode.QuickPickItem[] = [];
  
  if (assistantCount > 0) {
    const otherProfiles = (await profileStore.getProfiles()).filter(p => p.id !== profile.id);
    if (otherProfiles.length > 0) {
      options.push({
        label: '$(arrow-right) Reassign to another profile',
        description: '',
        detail: 'Move assistant mappings to a different profile'
      });
    }
  }
  
  options.push({
    label: '$(trash) Remove mappings and delete',
    description: '',
    detail: assistantCount > 0 ? 'Assistants will become unconfigured' : 'Delete the profile'
  });
  
  options.push({
    label: '$(close) Cancel',
    description: '',
    detail: 'Keep the profile'
  });
  
  const choice = await vscode.window.showQuickPick(options, {
    title: `Delete Profile: ${profile.name}`,
    placeHolder: confirmMessage
  });
  
  if (!choice || choice.label.includes('Cancel')) {
    await showProfileDetails(context, profile);
    return;
  }
  
  if (choice.label.includes('Reassign')) {
    // Show reassignment dialog
    const otherProfiles = (await profileStore.getProfiles()).filter(p => p.id !== profile.id);
    const targetProfileItems: ProfileQuickPickItem[] = otherProfiles.map(p => ({
      label: p.name,
      description: p.baseUrl,
      profile: p
    }));
    
    const targetProfile = await vscode.window.showQuickPick(targetProfileItems, {
      title: 'Reassign Assistants',
      placeHolder: 'Select target profile for assistant mappings'
    });
    
    if (!targetProfile) {
      await showProfileDetails(context, profile);
      return;
    }
    
    // Update mappings
    for (const mapping of profileMappings) {
      mapping.profileName = targetProfile.profile.name;
      await profileStore.saveAssistantMapping(mapping);
    }
    
    await showSuccess(`${assistantCount} assistant mapping${assistantCount !== 1 ? 's' : ''} reassigned to "${targetProfile.profile.name}"`);
  }
  
  // Delete the profile
  await profileStore.deleteProfile(profile.id);
  
  // Delete secrets
  if (profile.authRef) {
    const profileSecrets = new ProfileSecrets(context);
    await profileSecrets.deleteSecret(profile.name);
  }
  
  // Update status bar if this was the active profile
  const activeProfileId = await profileStore.getActiveProfileId();
  if (profile.id === activeProfileId) {
    const remaining = await profileStore.getProfiles();
    if (remaining.length > 0) {
      await profileStore.setActiveProfile(remaining[0].id);
      updateStatusBar(remaining[0].name);
    } else {
      updateStatusBar(undefined);
    }
  }
  
  await showSuccess(`Profile "${profile.name}" deleted successfully`);
  logger.info(`Profile deleted: ${profile.name}`);
  
  await showMainMenu(context);
}

/**
 * Tests connection to a profile's endpoint.
 */
async function testConnection(context: vscode.ExtensionContext, profile: EndpointProfile): Promise<void> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const profileSecrets = new ProfileSecrets(context);
  let completionNotification:
    | { kind: 'success' | 'warning' | 'error'; message: string }
    | undefined;
  
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Testing connection to ${profile.name}...`,
    cancellable: false
  }, async () => {
    const verifier = new Verifier();
    const remoteContext = detectRemote(profile.baseUrl);
    const authToken = profile.authRef ? await profileSecrets.getSecret(profile.authRef) : undefined;
    
    try {
      const report = await verifier.runVerificationPipeline(profile, {
        includeTestPrompt: false,
        remoteContext,
        authToken
      });
      
      // Update profile with verification timestamp
      profile.lastVerified = report.timestamp;
      await profileStore.saveProfile(profile);
      
      // Show results
      displayVerificationResults(report);
      
      if (report.overallStatus === 'passed') {
        completionNotification = {
          kind: 'success',
          message: `Connection to "${profile.name}" verified successfully!`
        };
      } else if (report.overallStatus === 'partial') {
        completionNotification = {
          kind: 'warning',
          message: `Connection to "${profile.name}" has warnings. Check output for details.`
        };
      } else {
        completionNotification = {
          kind: 'error',
          message: `Connection to "${profile.name}" failed. Check output for details.`
        };
      }
    } catch (error) {
      logger.error('Verification failed', error instanceof Error ? error : undefined);
      completionNotification = {
        kind: 'error',
        message: `Verification error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  });

  if (!completionNotification) {
    return;
  }

  if (completionNotification.kind === 'success') {
    await showSuccess(completionNotification.message);
  } else if (completionNotification.kind === 'warning') {
    await showWarning(completionNotification.message);
  } else {
    await showError(completionNotification.message);
  }
}

/**
 * Sets the default active profile.
 */
async function setDefaultProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profiles: EndpointProfile[]
): Promise<void> {
  const logger = Logger.getInstance();
  const currentActiveId = await profileStore.getActiveProfileId();
  
  const items: ProfileQuickPickItem[] = profiles.map(p => ({
    label: p.name,
    description: p.baseUrl,
    detail: p.id === currentActiveId ? '$(check) Currently active' : '',
    profile: p
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    title: 'Set Active Profile',
    placeHolder: 'Select the profile to apply to configured assistants'
  });
  
  if (!selected) {
    await showMainMenu(context);
    return;
  }
  
  const activation = await activateProfileAndReapplyMappings(context, selected.profile.id);
  const notice = getProfileActivationNotice(activation);

  if (notice.kind === 'success') {
    await showSuccess(notice.message);
  } else if (notice.kind === 'warning') {
    await showWarning(notice.message);
  } else {
    await showError(notice.message);
  }

  logger.info(`Profile activation requested from Manage Profiles: ${selected.profile.name}`);
  
  await showMainMenu(context);
}

/**
 * Views assistants mapped to a profile.
 */
async function viewMappedAssistants(
  context: vscode.ExtensionContext,
  profile: EndpointProfile,
  allMappings: AssistantMapping[]
): Promise<void> {
  const profileMappings = allMappings.filter(m => m.profileName === profile.name);
  
  if (profileMappings.length === 0) {
    await vscode.window.showInformationMessage(`No assistants are currently mapped to "${profile.name}"`);
    return;
  }
  
  const items = profileMappings.map(m => ({
    label: m.assistantKey,
    description: `Applied via ${m.appliedMode}`,
    detail: `Applied at: ${new Date(m.appliedAt).toLocaleString()}`
  }));
  
  await vscode.window.showQuickPick(items, {
    title: `Assistants Using: ${profile.name}`,
    placeHolder: `${profileMappings.length} assistant${profileMappings.length !== 1 ? 's' : ''} mapped to this profile`
  });
}

/**
 * Displays verification results in the output channel.
 */
function displayVerificationResults(report: VerificationReport): void {
  const output = getOutputChannel();
  
  output.appendLine('');
  output.appendLine('='.repeat(60));
  output.appendLine(`Verification Report: ${report.profileName}`);
  output.appendLine(`Base URL: ${report.baseUrl}`);
  output.appendLine(`Dialect: ${report.dialect}`);
  output.appendLine(`Timestamp: ${report.timestamp}`);
  output.appendLine(`Overall Status: ${report.overallStatus.toUpperCase()}`);
  output.appendLine('='.repeat(60));
  
  for (const step of report.steps) {
    const icon = step.status === 'passed' ? '✓' : 
                 step.status === 'failed' ? '✗' : 
                 step.status === 'warning' ? '⚠' : '○';
    output.appendLine(`${icon} ${step.name}: ${step.message}`);
    if (step.duration) {
      output.appendLine(`  Duration: ${step.duration}ms`);
    }
  }
  
  if (report.actionableErrors.length > 0) {
    output.appendLine('');
    output.appendLine('Errors:');
    report.actionableErrors.forEach((err: string) => output.appendLine(`  - ${err}`));
  }
  
  if (report.suggestions.length > 0) {
    output.appendLine('');
    output.appendLine('Suggestions:');
    report.suggestions.forEach((sug: string) => output.appendLine(`  - ${sug}`));
  }
  
  output.appendLine('='.repeat(60));
  output.show();
}

/**
 * Gets status icon for a profile based on last verification.
 */
function getProfileStatusIcon(profile: EndpointProfile): string {
  if (!profile.lastVerified) {
    return '⚠️';
  }
  
  const now = Date.now();
  const verified = new Date(profile.lastVerified).getTime();
  const hoursSinceVerification = (now - verified) / (1000 * 60 * 60);
  
  if (hoursSinceVerification < 24) {
    return '✅';
  } else if (hoursSinceVerification < 168) {
    return '⚠️';
  } else {
    return '❌';
  }
}

/**
 * Formats last verified timestamp for display.
 */
function formatLastVerified(timestamp: string): string {
  const now = Date.now();
  const verified = new Date(timestamp).getTime();
  const diffMs = now - verified;
  
  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);
  
  if (minutes < 60) {
    return `| Verified ${minutes}m ago`;
  } else if (hours < 24) {
    return `| Verified ${hours}h ago`;
  } else if (days < 7) {
    return `| Verified ${days}d ago`;
  } else {
    return `| Verified ${new Date(timestamp).toISOString().substring(0, 10)}`;
  }
}
