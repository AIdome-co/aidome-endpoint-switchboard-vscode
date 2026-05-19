import * as vscode from 'vscode';
import { ChangeLog } from '../../core/orchestration/changeLog';
import { detectCLIs } from '../../core/detection/detectCLIs';
import { detectExtensions } from '../../core/detection/detectExtensions';
import { ProfileStore } from '../../core/profiles/profileStore';
import { loadRegistry } from '../../core/registry/registryLoader';
import { AssistantEntry } from '../../core/registry/registryTypes';
import { getRuntimeSettings } from '../../config/runtimeSettings';
import { Logger } from '../../util/log';
import { getSetupWizardState } from '../../commands/setupSwitchboard';
import {
  AssistantSurfaceState,
  ChangeEntrySurfaceState,
  ControlCenterNavigationItem,
  ControlCenterPageId,
  ControlCenterPreferences,
  ControlCenterState,
  GuidedSection,
  ProfileSurfaceState
} from './types';
import { buildPreviewSections, getGuidedSectionsByAssistant } from './store';

const PREVIEW_ASSISTANT_KEYS = ['claude-code', 'kilo-code', 'anythingllm'];

export async function buildControlCenterState(
  context: vscode.ExtensionContext,
  preferences: ControlCenterPreferences
): Promise<ControlCenterState> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const changeLog = new ChangeLog(context);
  const registry = await loadRegistry();

  const [profiles, mappings, changeEntries, detectedCli] = await Promise.all([
    profileStore.getProfiles(),
    profileStore.getAssistantMappings(),
    changeLog.getEntries(),
    detectCLIs(registry)
  ]);
  const detectedExtensions = detectExtensions(registry);
  const guidedSectionsByAssistant = getGuidedSectionsByAssistant();
  const page = normalizePage(preferences.page);

  const extensionDetections = new Map<string, typeof detectedExtensions>();
  for (const detected of detectedExtensions) {
    const current = extensionDetections.get(detected.assistantKey) || [];
    current.push(detected);
    extensionDetections.set(detected.assistantKey, current);
  }

  const cliDetections = new Map<string, typeof detectedCli>();
  for (const detected of detectedCli) {
    const current = cliDetections.get(detected.assistantKey) || [];
    current.push(detected);
    cliDetections.set(detected.assistantKey, current);
  }

  const assistants = registry.assistants
    .map(entry => buildAssistantState(
      entry,
      extensionDetections.get(entry.key) || [],
      cliDetections.get(entry.key) || [],
      mappings,
      profiles,
      guidedSectionsByAssistant[entry.key] || []
    ))
    .sort(compareAssistants);

  const profilesState = profiles
    .map(profile => {
      const assistantNames = mappings
        .filter(mapping => mapping.profileId === profile.id)
        .map(mapping => assistants.find(assistant => assistant.key === mapping.assistantKey)?.displayName || mapping.assistantKey);

      return {
        id: profile.id,
        name: profile.name,
        baseUrl: profile.baseUrl,
        dialect: profile.dialect,
        profileType: profile.profileType,
        isInUse: assistantNames.length > 0,
        lastVerified: profile.lastVerified,
        assistantCount: assistantNames.length,
        assistantNames
      } satisfies ProfileSurfaceState;
    })
    .sort((left, right) => {
      if (left.isInUse && !right.isInUse) {
        return -1;
      }
      if (!left.isInUse && right.isInUse) {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });
  const inUseProfiles = profilesState.filter(profile => profile.isInUse);

  const manualAssistants = assistants.filter(assistant => assistant.guidedSections.length > 0);
  const guidedItems = manualAssistants.length > 0
    ? manualAssistants
    : assistants.filter(assistant => PREVIEW_ASSISTANT_KEYS.includes(assistant.key) && assistant.previewSections.length > 0);
  const guidedIsPreview = manualAssistants.length === 0;

  const selectedAssistantKey = resolveAssistantSelection(preferences.selectedAssistantKey, assistants, guidedItems, page);
  const selectedAssistant = assistants.find(assistant => assistant.key === selectedAssistantKey);
  const selectedGuidedAssistant = guidedItems.find(assistant => assistant.key === selectedAssistantKey) || guidedItems[0];
  const selectedProfileId = resolveProfileSelection(preferences.selectedProfileId, profilesState);
  const selectedProfile = profilesState.find(profile => profile.id === selectedProfileId) || profilesState[0];
  const configuredAssistantCount = assistants.filter(assistant => assistant.status === 'configured').length;
  const profileUsageSummary = summarizeProfileUsage(inUseProfiles);
  const setupWizard = getSetupWizardState();

  const recentChanges: ChangeEntrySurfaceState[] = changeEntries
    .slice(-8)
    .reverse()
    .map(entry => ({
      id: entry.id,
      timestamp: entry.timestamp,
      assistantKey: entry.assistantKey,
      profileName: entry.profileName,
      summary: changeLog.getEntrySummary(entry)
    }));

  const recentLogs = logger.getBuffer().slice(-8).reverse();
  const runtimeSettings = getRuntimeSettings();

  return {
    page,
    selectedAssistantKey: selectedAssistant?.key,
    selectedProfileId: selectedProfile?.id,
    generatedAt: new Date().toISOString(),
    profileUsageSummary,
    navigation: buildNavigation(profilesState.length, assistants, manualAssistants.length, recentChanges.length),
    overview: {
      profileCount: profilesState.length,
      detectedAssistantCount: assistants.filter(assistant => assistant.detected).length,
      configuredAssistantCount,
      manualFollowUpCount: manualAssistants.length,
      profileUsageSummary,
      mappedAssistantCount: configuredAssistantCount,
      inUseProfiles,
      pendingAssistants: manualAssistants.slice(0, 5),
      configuredAssistants: assistants.filter(assistant => assistant.status === 'configured').slice(0, 6),
      detectedAssistants: assistants.filter(assistant => assistant.detected).slice(0, 6)
    },
    profiles: {
      items: profilesState,
      selected: selectedProfile
    },
    assistants: {
      items: assistants,
      selected: selectedAssistant
    },
    guidedSetup: {
      items: guidedItems,
      selected: selectedGuidedAssistant,
      isPreview: guidedIsPreview
    },
    verification: {
      profiles: profilesState
    },
    models: {
      selectedProfile,
      note: selectedProfile
        ? selectedProfile.profileType === 'aidome'
          ? 'Models & Providers can query the selected AIdome profile directly.'
          : 'Models & Providers currently target AIdome profiles. Select an AIdome profile or use Verify Routing for custom endpoints.'
        : 'No profile selected yet. Choose or create a profile before querying models and providers.'
    },
    diagnostics: {
      recentLogs,
      logCount: logger.getBuffer().length,
      changeCount: changeEntries.length
    },
    historyReset: {
      recentChanges
    },
    advanced: {
      settings: [
        {
          label: 'HTTP timeout',
          value: `${runtimeSettings.httpTimeoutMs}ms`,
          description: 'Default timeout for extension-managed HTTP requests.'
        },
        {
          label: 'TLS verification',
          value: runtimeSettings.tlsVerify ? 'Enabled' : 'Disabled',
          description: 'Controls certificate verification for extension HTTPS requests.'
        },
        {
          label: 'Dialect validation timeout',
          value: `${runtimeSettings.verifier.dialectValidationTimeoutMs}ms`,
          description: 'Timeout used by lightweight verifier route probes.'
        },
        {
          label: 'Model list timeout',
          value: `${runtimeSettings.verifier.modelListTimeoutMs}ms`,
          description: 'Timeout used when enumerating models from the active profile.'
        },
        {
          label: 'Log buffer size',
          value: `${runtimeSettings.logBufferSize}`,
          description: 'Maximum in-memory log entries retained for diagnostics.'
        }
      ]
    },
    setupWizard
  };
}

function buildAssistantState(
  entry: AssistantEntry,
  detectedExtensions: Array<{ version: string; extensionId: string; isActive: boolean }>,
  detectedClis: Array<{ command: string; version?: string; path?: string }>,
  mappings: Array<{ assistantKey: string; profileId: string; appliedMode?: string }>,
  profiles: Array<{ id: string; name: string }>,
  guidedSections: GuidedSection[]
): AssistantSurfaceState {
  const mapped = mappings.find(mapping => mapping.assistantKey === entry.key);
  const mappedProfile = mapped
    ? profiles.find(profile => profile.id === mapped.profileId)
    : undefined;
  const detectionDetails: string[] = [
    ...detectedExtensions.map(extension => `${extension.extensionId} v${extension.version}${extension.isActive ? ' (active)' : ''}`),
    ...detectedClis.map(cli => `${cli.command}${cli.version ? ` ${cli.version}` : ''}${cli.path ? ` — ${cli.path}` : ''}`)
  ];

  const detected = detectionDetails.length > 0;
  const isActive = detectedExtensions.some(extension => extension.isActive);
  const previewSections = buildPreviewSections(entry.key);

  let status: AssistantSurfaceState['status'];
  if (guidedSections.length > 0) {
    status = 'needs-manual';
  } else if (mappedProfile) {
    status = 'configured';
  } else if (!detected) {
    status = 'not-detected';
  } else if (entry.endpointSwitching.tier === 'C' || entry.endpointSwitching.supported === false || entry.endpointSwitching.supported === 'enterprise-server-only') {
    status = 'info-only';
  } else {
    status = 'ready';
  }

  return {
    key: entry.key,
    displayName: entry.displayName,
    kind: entry.kind,
    tier: entry.endpointSwitching.tier,
    primaryDialect: entry.dialect.primary,
    supported: entry.endpointSwitching.supported,
    configurationModes: entry.endpointSwitching.configurationModes,
    detected,
    isActive,
    detectionDetails,
    mappedProfileName: mappedProfile?.name,
    appliedMode: mapped?.appliedMode,
    status,
    statusLabel: getStatusLabel(status),
    notes: entry.endpointSwitching.notes,
    settingHints: entry.endpointSwitching.settingKeyHints || [],
    envHints: entry.endpointSwitching.envVarHints || [],
    configFileHints: (entry.endpointSwitching.configFileHints || []).map(hint => `${hint.path} (${hint.format}) → ${hint.fields.join(', ')}`),
    guidedSections,
    previewSections
  };
}

function resolveAssistantSelection(
  preferredKey: string | undefined,
  assistants: AssistantSurfaceState[],
  guidedItems: AssistantSurfaceState[],
  page: ControlCenterPageId
): string | undefined {
  const pool = page === 'guided-setup' ? guidedItems : assistants;
  if (preferredKey && pool.some(item => item.key === preferredKey)) {
    return preferredKey;
  }

  if (page === 'guided-setup') {
    return guidedItems[0]?.key;
  }

  return assistants.find(assistant => assistant.guidedSections.length > 0)?.key
    || assistants.find(assistant => assistant.mappedProfileName)?.key
    || assistants.find(assistant => assistant.detected)?.key
    || assistants[0]?.key;
}

function resolveProfileSelection(
  preferredId: string | undefined,
  profiles: ProfileSurfaceState[]
): string | undefined {
  if (preferredId && profiles.some(profile => profile.id === preferredId)) {
    return preferredId;
  }

  return profiles.find(profile => profile.isInUse)?.id || profiles[0]?.id;
}

function buildNavigation(
  profileCount: number,
  assistants: AssistantSurfaceState[],
  guidedCount: number,
  changeCount: number
): ControlCenterNavigationItem[] {
  const detectedCount = assistants.filter(assistant => assistant.detected).length;
  return [
    { id: 'overview', label: 'Overview' },
    { id: 'profiles', label: 'Profiles', badge: profileCount || undefined },
    { id: 'assistants', label: 'Assistants', badge: detectedCount || undefined },
    { id: 'guided-setup', label: 'Guided Setup', badge: guidedCount || undefined },
    { id: 'diagnostics', label: 'Diagnostics' },
    { id: 'history-reset', label: 'History & Reset', badge: changeCount || undefined },
    { id: 'advanced', label: 'Advanced' }
  ];
}

function normalizePage(page: ControlCenterPageId): ControlCenterPageId {
  if (page === 'verification' || page === 'models') {
    return 'profiles';
  }

  return page;
}

function compareAssistants(left: AssistantSurfaceState, right: AssistantSurfaceState): number {
  const rank = (assistant: AssistantSurfaceState): number => {
    switch (assistant.status) {
      case 'needs-manual':
        return 0;
      case 'configured':
        return 1;
      case 'ready':
        return 2;
      case 'info-only':
        return 3;
      case 'not-detected':
      default:
        return 4;
    }
  };

  return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
}

function getStatusLabel(status: AssistantSurfaceState['status']): string {
  switch (status) {
    case 'configured':
      return 'Configured';
    case 'needs-manual':
      return 'Needs manual action';
    case 'info-only':
      return 'Guided / informational';
    case 'ready':
      return 'Ready to configure';
    case 'not-detected':
    default:
      return 'Not detected';
  }
}

function summarizeProfileUsage(inUseProfiles: ProfileSurfaceState[]): string {
  if (inUseProfiles.length === 0) {
    return 'No profiles in use';
  }

  if (inUseProfiles.length === 1) {
    return inUseProfiles[0].name;
  }

  return `${inUseProfiles.length} profiles in use`;
}