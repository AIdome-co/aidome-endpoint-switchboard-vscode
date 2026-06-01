/**
 * Setup Switchboard command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { loadRegistry } from '../core/registry/registryLoader';
import { AssistantEntry } from '../core/registry/registryTypes';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showInfo, showSuccess, showWarning, withProgress } from '../ui/notifications';
import { updateStatusBar } from '../ui/statusBar';
import { showPlan } from '../ui/output';
import { renderDetectionSummary, renderPlanSummary } from '../ui/wizard/renderResults';
import { Logger } from '../util/log';
import { getAssistantsByTier } from '../core/registry/registryLoader';
import { startTimer } from '../util/operationTimer';
import { UserCancellationError, ConfigurationError } from '../util/errors';
import {
  AUTO_DETECT_DIALECT_INFO_MESSAGE,
  DEFAULT_AUTH_OPTIONS,
  DEFAULT_PROFILE_TYPE_OPTIONS,
  SETUP_DIALECT_OPTIONS,
  type CreateProfileFlowOptions,
  buildCreateProfileStepTitles,
  createProfileFromPrompts,
} from './profileCreation';
import { verifyProfileConnection } from './profileVerification';

// Mutex flag to prevent concurrent wizard runs
let wizardRunning = false;

interface SetupAssistantSelectionItem extends vscode.QuickPickItem {
  assistantKey: string;
}

const SETUP_PROFILE_CREATION_TITLES = buildCreateProfileStepTitles(
  {
    name: 'Profile Name',
    profileType: 'Profile Type',
    baseUrl: 'Base URL',
    dialect: 'API Dialect',
    tenant: 'Tenant',
    authentication: 'Authentication',
    authToken: 'API Key',
  },
  {
    flowTitle: 'AIdome Setup',
    contextLabel: 'Step 3/5',
  }
);

const SETUP_PROFILE_CREATION_OPTIONS: CreateProfileFlowOptions = {
  name: {
    title: SETUP_PROFILE_CREATION_TITLES.name,
    prompt: 'Enter profile name',
    placeHolder: 'e.g., Production, Development',
    ignoreFocusOut: true,
  },
  profileType: {
    title: SETUP_PROFILE_CREATION_TITLES.profileType,
    placeHolder: 'Select profile type',
    options: DEFAULT_PROFILE_TYPE_OPTIONS,
    ignoreFocusOut: true,
  },
  baseUrl: {
    title: SETUP_PROFILE_CREATION_TITLES.baseUrl,
    prompt: 'Enter base URL',
    placeHolders: {
      aidome: 'https://api.aidome.ai',
      custom: 'https://your-endpoint.com',
    },
    defaultValues: {
      aidome: 'https://api.aidome.ai',
      custom: '',
    },
    ignoreFocusOut: true,
  },
  dialect: {
    title: SETUP_PROFILE_CREATION_TITLES.dialect,
    placeHolder: 'Select API dialect',
    options: SETUP_DIALECT_OPTIONS,
    autoDetectInfoMessage: AUTO_DETECT_DIALECT_INFO_MESSAGE,
    ignoreFocusOut: true,
  },
  tenant: {
    title: SETUP_PROFILE_CREATION_TITLES.tenant,
    prompt: 'Enter tenant identifier (optional)',
    placeHolders: {
      aidome: 'e.g., my-org, team-name',
      custom: 'Optional tenant identifier',
    },
    ignoreFocusOut: true,
  },
  authentication: {
    title: SETUP_PROFILE_CREATION_TITLES.authentication,
    placeHolder: 'Does this endpoint require authentication?',
    options: DEFAULT_AUTH_OPTIONS,
    ignoreFocusOut: true,
  },
  authToken: {
    title: SETUP_PROFILE_CREATION_TITLES.authToken,
    prompt: 'Enter authentication token/API key',
    placeHolder: 'sk-...',
    ignoreFocusOut: true,
  },
};

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
  const wizardTimer = startTimer();
  
  try {
    logger.info('Starting switchboard setup');
    
    const profileStore = new ProfileStore(context);
    const profileSecrets = new ProfileSecrets(context);
    const registry = await loadRegistry();
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    // Step 1/5 — Detection
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

    const assistantSelectionItems = buildAssistantSelectionItems(
      switchableAssistants,
      detected.clis,
      registry.assistants
    );

    // Step 2/5 — Assistant selection
    logger.info('Setup wizard step 2/5: Assistant selection');
    const selectedAssistants = await selectAssistants(assistantSelectionItems);
    if (!selectedAssistants || selectedAssistants.length === 0) {
      // Cancellation already logged inside selectAssistants()
      return;
    }
    
    // Step 3/5 — Profile selection
    logger.info('Setup wizard step 3/5: Profile selection');
    const profile = await getOrCreateProfile(context, profileStore, profileSecrets);
    if (!profile) {
      logger.info('Setup cancelled - no profile selected');
      return;
    }
    
    // Step 4/5 — Plan and apply
    logger.info('Setup wizard step 4/5: Building and applying plan');
    const plan = await withProgress(
      'Building configuration plan...',
      async () => await switchboard.buildPlan(profile, selectedAssistants)
    );
    
    showPlan(plan);
    
    const planSummary = renderPlanSummary(plan);
    const proceed = await vscode.window.showInformationMessage(
      `Configuration plan ready with ${plan.steps.length} steps. Review the plan in the output channel.\n\nProceed with configuration?`,
      { modal: true },
      'Apply'
    );
    
    if (proceed !== 'Apply') {
      logger.info('Setup cancelled by user');
      return;
    }
    
    const result = await withProgress(
      'Applying configuration...',
      async () => await switchboard.applyPlan(plan)
    );
    
    // Step 5/5 — Verify and report
    logger.info('Setup wizard step 5/5: Reporting result');
    const elapsed = wizardTimer.stop();

    if (result.success) {
      await profileStore.setActiveProfile(profile.id);
      updateStatusBar(profile.name);
      void vscode.commands.executeCommand('aidome-switchboard.refreshAssistantsView');
      
      const action = await showSuccess(
        `Successfully configured ${result.appliedSteps.length} assistant(s) to use ${profile.name}`,
        'Verify'
      );
      if (action === 'Verify') {
        await verifyProfileConnection(context, profile, {
          progressTitle: `Verifying connection to ${profile.name}...`
        });
      }
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
        // At least some assistants were configured — activate the profile so
        // the successfully configured ones start routing through it.
        await profileStore.setActiveProfile(profile.id);
        updateStatusBar(profile.name);
        void vscode.commands.executeCommand('aidome-switchboard.refreshAssistantsView');
        logger.info(`Setup partially complete in ${elapsed}ms: succeeded=[${succeeded.join(', ')}] failed=[${failed.join(', ')}]`);
        await showError(
          `Partial setup: ${succeeded.length} assistant(s) configured (${succeeded.join(', ')}). ` +
          `${failed.length} failed: ${failed.join(', ')}. Check the output channel for details.`,
          'View Output'
        );
      } else {
        logger.error(`Setup failed in ${elapsed}ms: all ${failed.length} assistant(s) failed`);
        await showError(
          `Configuration failed for all assistants. Check the output channel for details.`,
          'View Output'
        );
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
  }
}

async function selectAssistants(items: SetupAssistantSelectionItem[]): Promise<string[] | undefined> {
  const logger = Logger.getInstance();
  logger.info(`Offering ${items.length} assistant(s) for selection: ${items.map(item => item.assistantKey).join(', ')}`);

  if (items.length === 0) {
    logger.warning('No switchable assistants to offer in selection QuickPick');
    return undefined;
  }
  
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

  logger.info(`User selected ${selected.length} assistant(s): ${selected.map(item => item.assistantKey).join(', ')}`);
  return selected.map(item => item.assistantKey);
}

function buildAssistantSelectionItems(
  detectedAssistants: Awaited<ReturnType<Switchboard['detectAll']>>['assistants'],
  detectedClis: Awaited<ReturnType<Switchboard['detectAll']>>['clis'],
  registryAssistants: AssistantEntry[]
): SetupAssistantSelectionItem[] {
  const assistantsByKey = new Map(registryAssistants.map(assistant => [assistant.key, assistant]));
  const switchableExtensionKeys = detectedAssistants
    .filter(assistant => assistant.tier !== 'C')
    .map(assistant => assistant.assistantKey);
  const switchableCliKeys = detectedClis
    .filter(cli => assistantsByKey.get(cli.assistantKey)?.endpointSwitching.tier !== 'C')
    .map(cli => cli.assistantKey);
  const candidateKeys = [...new Set([...switchableExtensionKeys, ...switchableCliKeys])];

  return candidateKeys.map(assistantKey => {
    const registryAssistant = assistantsByKey.get(assistantKey);
    const detectedAssistant = detectedAssistants.find(item => item.assistantKey === assistantKey);
    const detectedViaExtension = detectedAssistants.some(item => item.assistantKey === assistantKey);
    const detectedViaCli = detectedClis.some(item => item.assistantKey === assistantKey);
    const label = detectedViaExtension && detectedViaCli
      ? `${registryAssistant?.displayName || detectedAssistant?.displayName || assistantKey} (Extension + CLI)`
      : registryAssistant?.displayName || detectedAssistant?.displayName || assistantKey;
    const detail = detectedViaExtension && detectedViaCli
      ? 'Detected as VS Code extension and CLI'
      : detectedViaExtension
        ? 'Detected as VS Code extension'
        : 'Detected as CLI';

    return {
      assistantKey,
      label,
      description: assistantKey,
      detail,
      picked: true
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
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
    return await createNewProfile(profileStore, profileSecrets);
  }
  
  return (choice as any).profile;
}

async function createNewProfile(
  profileStore: ProfileStore,
  profileSecrets: ProfileSecrets
): Promise<EndpointProfile | undefined> {
  return await createProfileFromPrompts(profileStore, profileSecrets, SETUP_PROFILE_CREATION_OPTIONS);
}
