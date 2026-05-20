import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { Plan } from '../core/orchestration/planBuilder';
import { loadRegistry } from '../core/registry/registryLoader';
import { AssistantEntry } from '../core/registry/registryTypes';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showSuccess, showWarning, withProgress } from '../ui/notifications';
import { Logger } from '../util/log';

interface AssistantSelectionItem extends vscode.QuickPickItem {
  assistantKey: string;
}

interface ProfileSelectionItem extends vscode.QuickPickItem {
  profile: EndpointProfile;
}

export async function assignProfileAssistants(
  context: vscode.ExtensionContext,
  profileId?: string
): Promise<void> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const profiles = await profileStore.getProfiles();
  const profile = await resolveProfileSelection(profileId, profiles);

  if (!profile) {
    return;
  }

  const profileSecrets = new ProfileSecrets(context);
  const registry = await loadRegistry();
  const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
  const mappings = await profileStore.getAssistantMappings();

  const detected = await withProgress(
    `Detecting assistants for ${profile.name}...`,
    async () => await switchboard.detectAll()
  );

  const items = buildAssistantSelectionItems(profile, profiles, mappings, registry.assistants, detected);
  if (items.length === 0) {
    await showWarning('No switchable assistants are currently detected. Run setup after installing an assistant or CLI first.');
    return;
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: `Assign Assistants to ${profile.name}`,
    placeHolder: 'Select the assistants that should use this profile',
    canPickMany: true,
    ignoreFocusOut: true
  });

  if (selected === undefined) {
    logger.info(`Assistant assignment cancelled for profile ${profile.name}`);
    return;
  }

  const selectedAssistantKeys = selected.map(item => item.assistantKey);
  const currentlyAssignedAssistantKeys = mappings
    .filter(mapping => mapping.profileId === profile.id)
    .map(mapping => mapping.assistantKey);
  const deselectedAssistantKeys = currentlyAssignedAssistantKeys
    .filter(assistantKey => !selectedAssistantKeys.includes(assistantKey));

  if (selectedAssistantKeys.length === 0 && deselectedAssistantKeys.length === 0) {
    await showWarning('No assistants selected. Nothing changed.');
    return;
  }

  let plan: Plan | undefined;
  let unplannedAssistantKeys: string[] = [];
  let guidedAssistantKeys: string[] = [];

  if (selectedAssistantKeys.length > 0) {
    plan = await withProgress(
      `Building assignment plan for ${profile.name}...`,
      async () => await switchboard.buildPlan(profile, selectedAssistantKeys)
    );

    const plannedAssistantKeys = [...new Set(plan.steps.map(step => step.assistantKey))];
    unplannedAssistantKeys = selectedAssistantKeys.filter(key => !plannedAssistantKeys.includes(key));
    guidedAssistantKeys = [...new Set(plan.steps
      .filter(step => step.action === 'show-guided-steps')
      .map(step => step.assistantKey))];
  }

  if ((!plan || plan.steps.length === 0) && deselectedAssistantKeys.length === 0) {
    await showWarning(
      unplannedAssistantKeys.length > 0
        ? `No assignment steps are available for: ${unplannedAssistantKeys.join(', ')}.`
        : `No assignment steps are available for "${profile.name}".`
    );
    return;
  }

  const confirmation = await vscode.window.showInformationMessage(
    buildAssignmentConfirmationMessage(profile.name, selectedAssistantKeys.length, deselectedAssistantKeys.length),
    { modal: true },
    'Apply',
    'Cancel'
  );

  if (confirmation !== 'Apply') {
    logger.info(`Assistant assignment confirmation dismissed for profile ${profile.name}`);
    return;
  }

  let succeededAssistantKeys: string[] = [];
  let failedAssistantKeys: string[] = [];

  if (plan && plan.steps.length > 0) {
    const result = await withProgress(
      `Applying ${profile.name} to selected assistants...`,
      async () => await switchboard.applyPlan(plan)
    );

    succeededAssistantKeys = [...result.assistantResults.entries()]
      .filter(([, assistantResult]) => assistantResult.success)
      .map(([assistantKey]) => assistantKey);
    failedAssistantKeys = [...result.assistantResults.entries()]
      .filter(([, assistantResult]) => !assistantResult.success)
      .map(([assistantKey, assistantResult]) => `${assistantKey}${assistantResult.reason ? ` (${assistantResult.reason})` : ''}`);
  }

  const detachedAssistantKeys: string[] = [];
  const detachFailures: string[] = [];

  for (const assistantKey of deselectedAssistantKeys) {
    try {
      await profileStore.deleteAssistantMapping(assistantKey, profile.id);
      detachedAssistantKeys.push(assistantKey);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      detachFailures.push(`${assistantKey} (${reason})`);
      logger.error(`Failed to detach ${assistantKey} from profile ${profile.name}`, error instanceof Error ? error : undefined);
    }
  }

  const skippedSuffix = unplannedAssistantKeys.length > 0
    ? ` No plan was generated for: ${unplannedAssistantKeys.join(', ')}.`
    : '';
  const guidedSuffix = guidedAssistantKeys.length > 0
    ? ` Guided follow-up is required for: ${guidedAssistantKeys.join(', ')}.`
    : '';
  const summary = buildAssignmentOutcomeMessage(profile.name, succeededAssistantKeys.length, detachedAssistantKeys.length);
  const combinedFailures = [...failedAssistantKeys, ...detachFailures];

  if (combinedFailures.length === 0) {
    await showSuccess(`${summary}${guidedSuffix}${skippedSuffix}`);
    return;
  }

  if (succeededAssistantKeys.length > 0 || detachedAssistantKeys.length > 0) {
    await showWarning(`${summary} Failures: ${combinedFailures.join(', ')}.${guidedSuffix}${skippedSuffix}`);
    return;
  }

  await showError(
    `Failed to update assistants for "${profile.name}".${combinedFailures.length > 0 ? ` Failures: ${combinedFailures.join(', ')}.` : ''}${skippedSuffix}`
  );
}

function buildAssignmentConfirmationMessage(profileName: string, assignCount: number, detachCount: number): string {
  if (assignCount > 0 && detachCount > 0) {
    return `Apply "${profileName}" to ${assignCount} assistant(s) and detach ${detachCount} assistant(s)?`;
  }

  if (assignCount > 0) {
    return `Apply "${profileName}" to ${assignCount} assistant(s)?`;
  }

  return `Detach ${detachCount} assistant(s) from "${profileName}"?`;
}

function buildAssignmentOutcomeMessage(profileName: string, assignedCount: number, detachedCount: number): string {
  if (assignedCount > 0 && detachedCount > 0) {
    return `Assigned "${profileName}" to ${assignedCount} assistant(s) and detached ${detachedCount} assistant(s).`;
  }

  if (assignedCount > 0) {
    return `Assigned "${profileName}" to ${assignedCount} assistant(s).`;
  }

  return `Detached ${detachedCount} assistant(s) from "${profileName}".`;
}

async function resolveProfileSelection(
  profileId: string | undefined,
  profiles: EndpointProfile[]
): Promise<EndpointProfile | undefined> {
  if (profileId) {
    const profile = profiles.find(item => item.id === profileId);
    if (!profile) {
      await showError('Profile not found. Open Manage Profiles and choose a valid profile first.');
    }
    return profile;
  }

  if (profiles.length === 0) {
    await showWarning('No profiles exist yet. Run setup or Manage Profiles first.');
    return undefined;
  }

  const selected = await vscode.window.showQuickPick<ProfileSelectionItem>(
    profiles
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(profile => ({
        label: profile.name,
        description: profile.baseUrl,
        detail: profile.dialect,
        profile
      })),
    {
      title: 'Assign Assistants to Profile',
      placeHolder: 'Select a profile to assign assistants to',
      matchOnDetail: true
    }
  );

  return selected?.profile;
}

function buildAssistantSelectionItems(
  profile: EndpointProfile,
  profiles: EndpointProfile[],
  mappings: Awaited<ReturnType<ProfileStore['getAssistantMappings']>>,
  assistants: AssistantEntry[],
  detected: Awaited<ReturnType<Switchboard['detectAll']>>
): AssistantSelectionItem[] {
  const assistantsByKey = new Map(assistants.map(assistant => [assistant.key, assistant]));
  const detectedExtensionKeys = detected.assistants
    .filter(assistant => assistant.tier !== 'C')
    .map(assistant => assistant.assistantKey);
  const detectedCliKeys = detected.clis
    .filter(cli => assistantsByKey.get(cli.assistantKey)?.endpointSwitching.tier !== 'C')
    .map(cli => cli.assistantKey);
  const assignedKeys = mappings
    .filter(mapping => mapping.profileId === profile.id)
    .map(mapping => mapping.assistantKey);
  const candidateKeys = [...new Set([...assignedKeys, ...detectedExtensionKeys, ...detectedCliKeys])];

  const items: AssistantSelectionItem[] = [];

  for (const assistantKey of candidateKeys) {
    const assistant = assistantsByKey.get(assistantKey);
    if (!assistant || assistant.endpointSwitching.tier === 'C') {
      continue;
    }

    const assistantMappings = mappings.filter(item => item.assistantKey === assistantKey);
    const currentProfileMapping = assistantMappings.find(item => item.profileId === profile.id);
    const otherProfileNames = [...new Set(assistantMappings
      .filter(item => item.profileId !== profile.id)
      .map(item => profiles.find(profileItem => profileItem.id === item.profileId)?.name || item.profileId))];
    const detectedViaExtension = detected.assistants.some(item => item.assistantKey === assistantKey);
    const detectedViaCli = detected.clis.some(item => item.assistantKey === assistantKey);
    const detectionLabel = detectedViaExtension && detectedViaCli
      ? 'Detected as extension and CLI'
      : detectedViaExtension
        ? 'Detected as extension'
        : detectedViaCli
          ? 'Detected as CLI'
          : 'Previously assigned';

    const assignmentLabel = currentProfileMapping
      ? otherProfileNames.length > 0
        ? `${detectionLabel} · assigned to this profile and ${otherProfileNames.join(', ')}`
        : `${detectionLabel} · currently assigned to this profile`
      : otherProfileNames.length > 0
        ? `${detectionLabel} · currently assigned to ${otherProfileNames.join(', ')}`
        : detectionLabel;

    items.push({
      assistantKey,
      label: assistant.displayName,
      description: assistantKey,
      detail: assignmentLabel,
      picked: Boolean(currentProfileMapping)
    });
  }

  return items.sort((left, right) => Number(Boolean(right.picked)) - Number(Boolean(left.picked)) || left.label.localeCompare(right.label));
}