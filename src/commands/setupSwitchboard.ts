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
import { getOutputChannel, showOutput, showPlan } from '../ui/output';
import { renderDetectionSummary } from '../ui/wizard/renderResults';
import { Logger } from '../util/log';
import { getAssistantsByTier } from '../core/registry/registryLoader';
import { startTimer } from '../util/operationTimer';
import { UserCancellationError, ConfigurationError } from '../util/errors';
import { Plan } from '../core/orchestration/planBuilder';

const VIEW_OUTPUT_ACTION = 'View Output';
const VERIFY_ROUTING_ACTION = 'Verify Routing';

// Mutex flag to prevent concurrent wizard runs
let wizardRunning = false;
const setupWizardStateEmitter = new vscode.EventEmitter<SetupWizardState>();
let setupWizardState: SetupWizardState = { isRunning: false };

export interface SetupWizardState {
  isRunning: boolean;
  currentStep?: string;
}

export const onDidChangeSetupWizardState = setupWizardStateEmitter.event;

export function getSetupWizardState(): SetupWizardState {
  return setupWizardState;
}

/**
 * Handles the setupSwitchboard command.
 * Launches the setup wizard for configuring endpoint routing.
 */
export async function setupSwitchboard(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  // Check if wizard is already running
  if (wizardRunning) {
    const stepSuffix = setupWizardState.currentStep
      ? ` Current step: ${setupWizardState.currentStep}.`
      : '';
    await vscode.window.showWarningMessage(
      `Setup wizard is already running.${stepSuffix} Look for the AIdome Setup prompt at the top of VS Code or press Escape to cancel it.`
    );
    return;
  }
  
  wizardRunning = true;
  updateSetupWizardState({ isRunning: true, currentStep: 'Starting setup' });
  const wizardTimer = startTimer();
  
  try {
    logger.info('Starting switchboard setup');
    
    const profileStore = new ProfileStore(context);
    const profileSecrets = new ProfileSecrets(context);
    const registry = await loadRegistry();
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    // Step 1/5 — Detection
    updateSetupWizardState({ isRunning: true, currentStep: 'Detecting assistants' });
    logger.info('Setup wizard step 1/5: Detection');
    const detected = await withProgress(
      'Detecting installed assistants...',
      async () => await switchboard.detectAll()
    );
    
    if (detected.assistants.length === 0 && detected.clis.length === 0) {
      await showWarning('No supported AI assistants detected. Please install an AI assistant extension first.');
      return;
    }
    
    const summary = renderDetectionSummary(detected);
    const outputChannel = getOutputChannel();
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

    // Step 2/5 — Assistant selection
    updateSetupWizardState({ isRunning: true, currentStep: 'Waiting for assistant selection' });
    logger.info('Setup wizard step 2/5: Assistant selection');
    const selectedAssistants = await selectAssistants(switchableKeys);
    if (!selectedAssistants || selectedAssistants.length === 0) {
      // Cancellation already logged inside selectAssistants()
      return;
    }
    
    // Step 3/5 — Profile selection
    updateSetupWizardState({ isRunning: true, currentStep: 'Waiting for profile selection' });
    logger.info('Setup wizard step 3/5: Profile selection');
    const profile = await getOrCreateProfile(context, profileStore, profileSecrets);
    if (!profile) {
      logger.info('Setup cancelled - no profile selected');
      return;
    }
    
    // Step 4/5 — Plan and apply
    updateSetupWizardState({ isRunning: true, currentStep: 'Building configuration plan' });
    logger.info('Setup wizard step 4/5: Building and applying plan');
    const plan = await withProgress(
      'Building configuration plan...',
      async () => await switchboard.buildPlan(profile, selectedAssistants)
    );
    
    showPlan(plan);
    updateSetupWizardState({ isRunning: true, currentStep: 'Waiting for apply confirmation' });
    
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
    
    updateSetupWizardState({ isRunning: true, currentStep: 'Applying configuration' });
    const result = await withProgress(
      'Applying configuration...',
      async () => await switchboard.applyPlan(plan)
    );
    
    // Step 5/5 — Verify and report
    updateSetupWizardState({ isRunning: true, currentStep: 'Finalizing setup results' });
    logger.info('Setup wizard step 5/5: Reporting result');
    const elapsed = wizardTimer.stop();

    if (result.success) {
      const selectedAction = await showSetupSuccess(plan, profile.name, result.appliedSteps.length);
      await handleSetupAction(selectedAction);
      logger.info(`Setup complete: ${result.appliedSteps.length} steps applied in ${elapsed}ms`);
    } else {
      // Partial success: some assistants configured, some failed.
      // The system is still usable — show which assistants succeeded and provide next steps.
      const succeeded = [...result.assistantResults.entries()]
        .filter(([, r]) => r.success)
        .map(([k]) => k);
      const failed = [...result.assistantResults.entries()]
        .filter(([, r]) => !r.success)
        .map(([k, r]) => `${k}${r.reason ? ` (${r.reason})` : ''}`);

      if (succeeded.length > 0) {
        logger.info(`Setup partially complete in ${elapsed}ms: succeeded=[${succeeded.join(', ')}] failed=[${failed.join(', ')}]`);
        const guidedAssistantCount = getGuidedAssistantCount(plan);
        const selectedAction = await showError(
          `Partial setup: ${succeeded.length} assistant(s) configured (${succeeded.join(', ')}). ` +
          `${failed.length} failed: ${failed.join(', ')}.` +
          `${guidedAssistantCount > 0
            ? ` Manual follow-up is open in the AIdome setup panel for ${guidedAssistantCount} assistant${guidedAssistantCount === 1 ? '' : 's'}.`
            : ' Check the output channel for details.'}`,
          VIEW_OUTPUT_ACTION
        );
        await handleSetupAction(selectedAction);
      } else {
        logger.error(`Setup failed in ${elapsed}ms: all ${failed.length} assistant(s) failed`);
        const selectedAction = await showError(
          `Configuration failed for all assistants. Check the output channel for details.`,
          VIEW_OUTPUT_ACTION
        );
        await handleSetupAction(selectedAction);
      }
    }
  } catch (error) {
    if (error instanceof UserCancellationError) {
      logger.info(`Setup cancelled by user at step: ${error.step}`);
      return;
    }
    if (error instanceof ConfigurationError) {
      logger.warning(
        `Configuration error during setup: ${error.message}`,
        undefined,
        { assistantKey: error.assistantKey }
      );
      await showError(error.userMessage);
      return;
    }
    logger.error('Failed to setup switchboard', error instanceof Error ? error : undefined);
    await showError(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    // Reset wizard running flag
    wizardRunning = false;
    updateSetupWizardState({ isRunning: false });
  }
}

function updateSetupWizardState(nextState: SetupWizardState): void {
  setupWizardState = nextState;
  setupWizardStateEmitter.fire(setupWizardState);
}

async function showSetupSuccess(
  plan: Plan,
  profileName: string,
  appliedAssistantCount: number
): Promise<string | undefined> {
  const guidedAssistantCount = getGuidedAssistantCount(plan);
  if (guidedAssistantCount > 0) {
    return await showWarning(
      `Successfully configured ${appliedAssistantCount} assistant(s) to use ${profileName}, ` +
      `but ${guidedAssistantCount} assistant${guidedAssistantCount === 1 ? '' : 's'} still ` +
      `require manual follow-up in the AIdome Control Center before verification.`,
      VIEW_OUTPUT_ACTION,
      VERIFY_ROUTING_ACTION
    );
  }

  return await showSuccess(
    `Successfully configured ${appliedAssistantCount} assistant(s) to use ${profileName}`,
    VERIFY_ROUTING_ACTION,
    VIEW_OUTPUT_ACTION
  );
}

function getGuidedAssistantCount(plan: Plan): number {
  const assistantKeys = new Set(
    plan.steps
      .filter(step => step.action === 'show-guided-steps')
      .map(step => step.assistantKey)
  );

  return assistantKeys.size;
}

async function handleSetupAction(action: string | undefined): Promise<void> {
  if (action === VIEW_OUTPUT_ACTION) {
    showOutput();
    return;
  }

  if (action === VERIFY_ROUTING_ACTION) {
    await vscode.commands.executeCommand('aidome-switchboard.verifyRouting');
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
