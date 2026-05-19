import * as vscode from 'vscode';
import { Switchboard } from '../core/orchestration/switchboard';
import { Plan, PlanStepAction } from '../core/orchestration/planBuilder';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { ProfileStore } from '../core/profiles/profileStore';
import { loadRegistry } from '../core/registry/registryLoader';
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
  const mappedAssistantKeys = [...new Set(
    mappings
      .filter(mapping => mapping.profileId === profile.id)
      .map(mapping => mapping.assistantKey)
  )];

  if (mappedAssistantKeys.length === 0) {
    logger.info(`Profile ${profile.name} has no assigned assistants to reapply`);
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
      title: `Reapplying ${profile.name}...`,
      cancellable: false
    },
    async progress => {
      progress.report({ message: `Preparing ${mappedAssistantKeys.length} assigned assistant(s)...` });

      try {
        const registry = await loadRegistry();
        const profileSecrets = new ProfileSecrets(context);
        const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
        const plan = await switchboard.buildPlan(profile, mappedAssistantKeys);
        const reapplyPlan = buildAutomatedReapplyPlan(plan);
        const actionableAssistantKeys = [...new Set(reapplyPlan.assistantKeys)];
        const skippedAssistantKeys = mappedAssistantKeys.filter(key => !actionableAssistantKeys.includes(key));

        if (reapplyPlan.steps.length === 0) {
          logger.info(
            `Profile ${profile.name} has no automatic reapply steps for assigned assistants: ${skippedAssistantKeys.join(', ') || 'none'}`
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

        progress.report({ message: `Applying ${actionableAssistantKeys.length} assigned assistant configuration(s)...` });

        const applyResult = await switchboard.applyPlan(reapplyPlan);
        const failedAssistantKeys = [...applyResult.assistantResults.entries()]
          .filter(([, result]) => !result.success)
          .map(([assistantKey]) => assistantKey);
        const appliedAssistantKeys = actionableAssistantKeys.filter(key => !failedAssistantKeys.includes(key));

        if (applyResult.success) {
          logger.info(`Reapplied profile ${profile.name} to ${appliedAssistantKeys.join(', ')}`);
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
          logger.warning(
            `Reapplied profile ${profile.name} with partial assistant success`,
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
          `Failed to reapply assigned assistants for profile ${profile.name}`,
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
          `Failed to reapply profile ${profile.name}`,
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
      message: result.errorMessage || `Failed to reapply "${profileName}" to its assigned assistants.`
    };
  }

  if (result.status === 'active-only') {
    if (result.skippedAssistantKeys.length > 0) {
      return {
        kind: 'warning',
        message: `"${profileName}" is assigned only to manual-switch assistants: ${result.skippedAssistantKeys.join(', ')}.`
      };
    }

    return {
      kind: 'success',
      message: `"${profileName}" is not assigned to any automatically reconfigurable assistants.`
    };
  }

  if (result.status === 'partial') {
    const skippedSuffix = result.skippedAssistantKeys.length > 0
      ? ` Manual-only assistants not updated automatically: ${result.skippedAssistantKeys.join(', ')}.`
      : '';
    return {
      kind: 'warning',
      message: `Reapplied "${profileName}" to ${result.appliedAssistantKeys.length} assigned assistant(s), but ${result.failedAssistantKeys.length} failed.${skippedSuffix}`
    };
  }

  if (result.skippedAssistantKeys.length > 0) {
    return {
      kind: 'warning',
      message: `Reapplied "${profileName}" to ${result.appliedAssistantKeys.length} assigned assistant(s). Manual-only assistants not updated automatically: ${result.skippedAssistantKeys.join(', ')}.`
    };
  }

  return {
    kind: 'success',
    message: `Reapplied "${profileName}" to ${result.appliedAssistantKeys.length} assigned assistant(s).`
  };
}

function buildAutomatedReapplyPlan(plan: Plan): Plan {
  const steps = plan.steps.filter(step => AUTOMATED_REAPPLY_ACTIONS.has(step.action));
  const assistantKeys = [...new Set(steps.map(step => step.assistantKey))];

  return {
    ...plan,
    assistantKeys,
    steps
  };
}