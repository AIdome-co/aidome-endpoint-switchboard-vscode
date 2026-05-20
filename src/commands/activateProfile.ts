import * as vscode from 'vscode';
import { Switchboard } from '../core/orchestration/switchboard';
import { Plan, PlanStepAction } from '../core/orchestration/planBuilder';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { ProfileStore } from '../core/profiles/profileStore';
import { loadRegistry } from '../core/registry/registryLoader';
import { updateStatusBar } from '../ui/statusBar';
import { Logger } from '../util/log';

const AUTOMATED_REAPPLY_ACTIONS = new Set<PlanStepAction>([
  'set-vscode-setting',
  'edit-config-file'
]);

export interface ProfileActivationResult {
  status: 'success' | 'partial' | 'active-only' | 'failed';
  profile: EndpointProfile;
  mappedAssistantKeys: string[];
  appliedAssistantKeys: string[];
  failedAssistantKeys: string[];
  skippedAssistantKeys: string[];
  errorMessage?: string;
}

export async function activateProfileAndReapplyMappings(
  context: vscode.ExtensionContext,
  profileId: string
): Promise<ProfileActivationResult> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const profiles = await profileStore.getProfiles();
  const profile = profiles.find(item => item.id === profileId);

  if (!profile) {
    const fallbackProfile: EndpointProfile = {
      id: profileId,
      name: profileId,
      baseUrl: '',
      dialect: 'openai.chat_completions',
      profileType: 'custom',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };
    return {
      status: 'failed',
      profile: fallbackProfile,
      mappedAssistantKeys: [],
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      skippedAssistantKeys: [],
      errorMessage: `Profile ${profileId} not found.`
    };
  }

  const mappings = await profileStore.getAssistantMappings();
  const mappedAssistantKeys = [...new Set(mappings.map(mapping => mapping.assistantKey))];

  if (mappedAssistantKeys.length === 0) {
    await profileStore.setActiveProfile(profile.id);
    updateStatusBar(profile.name);
    logger.info(`Activated profile ${profile.name} with no configured assistants to reapply`);
    return {
      status: 'active-only',
      profile,
      mappedAssistantKeys,
      appliedAssistantKeys: [],
      failedAssistantKeys: [],
      skippedAssistantKeys: []
    };
  }

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Switching assistants to ${profile.name}...`,
      cancellable: false
    },
    async progress => {
      progress.report({ message: `Preparing ${mappedAssistantKeys.length} mapped assistant(s)...` });

      try {
        const registry = await loadRegistry();
        const profileSecrets = new ProfileSecrets(context);
        const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
        const plan = await switchboard.buildPlan(profile, mappedAssistantKeys);
        const reapplyPlan = buildAutomatedReapplyPlan(plan);
        const actionableAssistantKeys = [...new Set(reapplyPlan.assistantKeys)];
        const skippedAssistantKeys = mappedAssistantKeys.filter(key => !actionableAssistantKeys.includes(key));

        if (reapplyPlan.steps.length === 0) {
          await profileStore.setActiveProfile(profile.id);
          updateStatusBar(profile.name);
          logger.info(
            `Activated profile ${profile.name} but no mapped assistants had automatic reapply steps: ${skippedAssistantKeys.join(', ') || 'none'}`
          );
          return {
            status: 'active-only' as const,
            profile,
            mappedAssistantKeys,
            appliedAssistantKeys: [],
            failedAssistantKeys: [],
            skippedAssistantKeys
          };
        }

        progress.report({ message: `Applying ${actionableAssistantKeys.length} assistant configuration(s)...` });

        const applyResult = await switchboard.applyPlan(reapplyPlan);
        const failedAssistantKeys = [...applyResult.assistantResults.entries()]
          .filter(([, result]) => !result.success)
          .map(([assistantKey]) => assistantKey);
        const appliedAssistantKeys = actionableAssistantKeys.filter(key => !failedAssistantKeys.includes(key));

        if (applyResult.success) {
          await profileStore.setActiveProfile(profile.id);
          updateStatusBar(profile.name);
          logger.info(`Activated profile ${profile.name} and reapplied ${appliedAssistantKeys.join(', ')}`);
          return {
            status: 'success' as const,
            profile,
            mappedAssistantKeys,
            appliedAssistantKeys,
            failedAssistantKeys: [],
            skippedAssistantKeys
          };
        }

        if (appliedAssistantKeys.length > 0) {
          await profileStore.setActiveProfile(profile.id);
          updateStatusBar(profile.name);
          logger.warning(
            `Activated profile ${profile.name} with partial assistant reapply success`,
            undefined,
            {
              appliedAssistantKeys,
              failedAssistantKeys,
              skippedAssistantKeys
            }
          );
          return {
            status: 'partial' as const,
            profile,
            mappedAssistantKeys,
            appliedAssistantKeys,
            failedAssistantKeys,
            skippedAssistantKeys
          };
        }

        logger.error(
          `Failed to reapply mapped assistants for profile ${profile.name}`,
          undefined,
          { failedAssistantKeys, skippedAssistantKeys }
        );
        return {
          status: 'failed' as const,
          profile,
          mappedAssistantKeys,
          appliedAssistantKeys: [],
          failedAssistantKeys,
          skippedAssistantKeys,
          errorMessage: `No assistant configurations were updated for "${profile.name}".`
        };
      } catch (error) {
        logger.error(
          `Failed to activate profile ${profile.name}`,
          error instanceof Error ? error : undefined
        );
        return {
          status: 'failed' as const,
          profile,
          mappedAssistantKeys,
          appliedAssistantKeys: [],
          failedAssistantKeys: [],
          skippedAssistantKeys: [],
          errorMessage: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );
}

export function getProfileActivationNotice(
  result: ProfileActivationResult
): { kind: 'success' | 'warning' | 'error'; message: string } {
  const profileName = result.profile.name;

  if (result.status === 'failed') {
    return {
      kind: 'error',
      message: result.errorMessage || `Failed to switch assistants to "${profileName}".`
    };
  }

  if (result.status === 'active-only') {
    if (result.skippedAssistantKeys.length > 0) {
      return {
        kind: 'warning',
        message: `Active profile set to "${profileName}", but these assistants require manual switching: ${result.skippedAssistantKeys.join(', ')}.`
      };
    }

    return {
      kind: 'success',
      message: `Active profile set to "${profileName}". No configured assistants needed reapplying.`
    };
  }

  if (result.status === 'partial') {
    const skippedSuffix = result.skippedAssistantKeys.length > 0
      ? ` Manual-only assistants not updated automatically: ${result.skippedAssistantKeys.join(', ')}.`
      : '';
    return {
      kind: 'warning',
      message: `Active profile switched to "${profileName}". Reapplied ${result.appliedAssistantKeys.length} assistant(s), but ${result.failedAssistantKeys.length} failed.${skippedSuffix}`
    };
  }

  if (result.skippedAssistantKeys.length > 0) {
    return {
      kind: 'warning',
      message: `Active profile switched to "${profileName}". Reapplied ${result.appliedAssistantKeys.length} assistant(s). Manual-only assistants not updated automatically: ${result.skippedAssistantKeys.join(', ')}.`
    };
  }

  return {
    kind: 'success',
    message: `Active profile switched to "${profileName}" and ${result.appliedAssistantKeys.length} assistant(s) updated.`
  };
}

function buildAutomatedReapplyPlan(plan: Plan): Plan {
  const automatedSteps = plan.steps.filter(step => AUTOMATED_REAPPLY_ACTIONS.has(step.action));
  const assistantKeys = [...new Set(automatedSteps.map(step => step.assistantKey))];
  return {
    ...plan,
    steps: automatedSteps,
    assistantKeys
  };
}
