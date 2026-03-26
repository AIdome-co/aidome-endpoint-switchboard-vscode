/**
 * Setup Switchboard command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { loadRegistry } from '../core/registry/registryLoader';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showSuccess, showWarning, withProgress } from '../ui/notifications';
import { updateStatusBar } from '../ui/statusBar';
import { showPlan } from '../ui/output';
import { renderDetectionSummary, renderPlanSummary } from '../ui/wizard/renderResults';
import { Logger } from '../util/log';
import { getAssistantsByTier } from '../core/registry/registryLoader';

// Mutex flag to prevent concurrent wizard runs
let wizardRunning = false;

/**
 * Handles the setupSwitchboard command.
 * Launches the setup wizard for configuring endpoint routing.
 */
export async function setupSwitchboard(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  // Check if wizard is already running
  if (wizardRunning) {
    vscode.window.showWarningMessage('Setup wizard is already running. Please wait for it to complete.');
    return;
  }
  
  wizardRunning = true;
  
  try {
    logger.info('Starting switchboard setup');
    
    const profileStore = new ProfileStore(context);
    const profileSecrets = new ProfileSecrets(context);
    const registry = await loadRegistry();
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    const detected = await withProgress(
      'Detecting installed assistants...',
      async () => await switchboard.detectAll()
    );
    
    if (detected.assistants.length === 0 && detected.clis.length === 0) {
      await showWarning('No supported AI assistants detected. Please install an AI assistant extension first.');
      return;
    }
    
    const summary = renderDetectionSummary(detected);
    const outputChannel = vscode.window.createOutputChannel('AIdome Setup');
    outputChannel.appendLine(summary);
    outputChannel.show();

    const switchableAssistants = detected.assistants.filter(a => a.tier !== 'C');
    const nonSwitchableAssistants = detected.assistants.filter(a => a.tier === 'C');

    if (switchableAssistants.length === 0 && nonSwitchableAssistants.length > 0) {
      const names = nonSwitchableAssistants.map(a => a.displayName).join(', ');
      const tierANames = getAssistantsByTier(registry, 'A').map(a => a.displayName).join(', ');
      logger.warning(`Only non-switchable (Tier C) assistants detected: ${names}`);
      await showWarning(
        `Detected ${names}, but ${nonSwitchableAssistants.length === 1 ? 'it does' : 'they do'} not support endpoint switching. ` +
        `Install a Tier A assistant (${tierANames}) for automatic configuration.`
      );
      return;
    }

    const switchableKeys = [
      ...switchableAssistants.map(a => a.assistantKey),
      ...detected.clis.map(c => c.assistantKey)
    ];

    const selectedAssistants = await selectAssistants(switchableKeys);
    if (!selectedAssistants || selectedAssistants.length === 0) {
      // Cancellation already logged inside selectAssistants()
      return;
    }
    
    const profile = await getOrCreateProfile(context, profileStore, profileSecrets);
    if (!profile) {
      logger.info('Setup cancelled - no profile selected');
      return;
    }
    
    const plan = await withProgress(
      'Building configuration plan...',
      async () => await switchboard.buildPlan(profile, selectedAssistants)
    );
    
    showPlan(plan);
    
    const planSummary = renderPlanSummary(plan);
    const proceed = await vscode.window.showInformationMessage(
      `Configuration plan ready with ${plan.steps.length} steps. Review the plan in the output channel.\n\nProceed with configuration?`,
      { modal: true },
      'Apply',
      'Cancel'
    );
    
    if (proceed !== 'Apply') {
      logger.info('Setup cancelled by user');
      return;
    }
    
    const result = await withProgress(
      'Applying configuration...',
      async () => await switchboard.applyPlan(plan)
    );
    
    if (result.success) {
      await profileStore.setActiveProfile(profile.id);
      updateStatusBar(profile.name);
      
      await showSuccess(
        `Successfully configured ${result.appliedSteps.length} assistant(s) to use ${profile.name}`,
        'Verify'
      );
      logger.info(`Setup complete: ${result.appliedSteps.length} steps applied`);
    } else {
      const failedCount = result.failedSteps.length;
      await showError(
        `Configuration partially completed. ${failedCount} step(s) failed. Check the output for details.`,
        'View Output'
      );
      logger.error(`Setup failed: ${failedCount} steps failed`);
    }
  } catch (error) {
    logger.error('Failed to setup switchboard', error instanceof Error ? error : undefined);
    await showError(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Reset wizard running flag
    wizardRunning = false;
  }
}

async function selectAssistants(detectedKeys: string[]): Promise<string[] | undefined> {
  const logger = Logger.getInstance();
  logger.info(`Offering ${detectedKeys.length} assistant(s) for selection: ${detectedKeys.join(', ')}`);

  if (detectedKeys.length === 0) {
    logger.warning('No switchable assistants to offer in selection QuickPick');
    return undefined;
  }

  const items = detectedKeys.map(key => ({
    label: key,
    picked: true
  }));
  
  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select assistants to configure (all selected by default)',
    title: 'AIdome Setup (Step 2/5): Select Assistants',
    ignoreFocusOut: true
  });

  if (selected === undefined) {
    logger.info('Setup cancelled - user dismissed assistant selection');
    return undefined;
  }

  if (selected.length === 0) {
    logger.info('Setup cancelled - user unchecked all assistants');
    return [];
  }

  logger.info(`User selected ${selected.length} assistant(s): ${selected.map(s => s.label).join(', ')}`);
  return selected.map(s => s.label);
}

async function getOrCreateProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profileSecrets: ProfileSecrets
): Promise<EndpointProfile | undefined> {
  const profiles = await profileStore.getProfiles();
  
  const choices = [
    { label: '$(add) Create New Profile', value: 'create' },
    ...profiles.map(p => ({
      label: p.name,
      description: p.profileType === 'aidome' ? 'AIdome Gateway' : 'Custom',
      detail: p.baseUrl,
      value: p.id,
      profile: p
    }))
  ];
  
  const choice = await vscode.window.showQuickPick(choices, {
    placeHolder: 'Select a profile or create a new one',
    title: 'AIdome Setup (Step 3/5): Select Profile',
    ignoreFocusOut: true
  });
  
  if (!choice) {
    return undefined;
  }
  
  if (choice.value === 'create') {
    return await createNewProfile(context, profileStore, profileSecrets);
  }
  
  return (choice as any).profile;
}

async function createNewProfile(
  context: vscode.ExtensionContext,
  profileStore: ProfileStore,
  profileSecrets: ProfileSecrets
): Promise<EndpointProfile | undefined> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter profile name',
    placeHolder: 'e.g., Production, Development',
    title: 'AIdome Setup (Step 3/5): Create Profile',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Profile name cannot be empty';
      }
      return undefined;
    }
  });
  
  if (!name) {
    return undefined;
  }
  
  const typeChoice = await vscode.window.showQuickPick(
    [
      { label: 'AIdome Gateway', description: 'Managed LLM gateway with multi-provider support', value: 'aidome' },
      { label: 'Custom Endpoint', description: 'Your own OpenAI-compatible endpoint', value: 'custom' }
    ],
    {
      placeHolder: 'Select profile type',
      title: 'AIdome Setup (Step 3/5): Profile Type',
      ignoreFocusOut: true
    }
  );
  
  if (!typeChoice) {
    return undefined;
  }
  
  const baseUrl = await vscode.window.showInputBox({
    prompt: 'Enter base URL',
    placeHolder: typeChoice.value === 'aidome' ? 'https://api.aidome.ai' : 'https://your-endpoint.com',
    value: typeChoice.value === 'aidome' ? 'https://api.aidome.ai' : '',
    title: 'AIdome Setup (Step 3/5): Base URL',
    ignoreFocusOut: true,
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
    return undefined;
  }
  
  const dialectChoice = await vscode.window.showQuickPick(
    [
      { 
        label: 'OpenAI Chat Completions', 
        description: 'Standard OpenAI /v1/chat/completions format',
        value: 'openai.chat_completions' 
      },
      { 
        label: 'Anthropic Messages', 
        description: 'Anthropic /v1/messages format',
        value: 'anthropic.messages' 
      },
      { 
        label: 'OpenAI Responses', 
        description: 'Newer /v1/responses format',
        value: 'openai.responses' 
      }
    ],
    {
      placeHolder: 'Select API dialect',
      title: 'AIdome Setup (Step 3/5): API Dialect',
      ignoreFocusOut: true
    }
  );
  
  if (!dialectChoice) {
    return undefined;
  }
  
  let authToken: string | undefined;
  const needsAuth = await vscode.window.showQuickPick(
    [
      { label: 'Yes', description: 'Endpoint requires authentication', value: true },
      { label: 'No', description: 'No authentication required', value: false }
    ],
    {
      placeHolder: 'Does this endpoint require authentication?',
      title: 'AIdome Setup (Step 3/5): Authentication',
      ignoreFocusOut: true
    }
  );
  
  if (needsAuth?.value) {
    authToken = await vscode.window.showInputBox({
      prompt: 'Enter authentication token/API key',
      password: true,
      placeHolder: 'sk-...',
      title: 'AIdome Setup (Step 3/5): API Key',
      ignoreFocusOut: true
    });
    
    if (!authToken) {
      return undefined;
    }
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
    await profileSecrets.storeSecret(profile.name, authToken);
  }
  
  return profile;
}
