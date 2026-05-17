import { GuidedStepsData } from '../../core/orchestration/planBuilder';
import { LogEntry } from '../../util/log';

export type ControlCenterPageId =
  | 'overview'
  | 'profiles'
  | 'assistants'
  | 'guided-setup'
  | 'verification'
  | 'models'
  | 'diagnostics'
  | 'history-reset'
  | 'advanced';

export interface GuidedSection {
  id: string;
  description: string;
  data: GuidedStepsData;
}

export interface ControlCenterPreferences {
  page: ControlCenterPageId;
  selectedAssistantKey?: string;
  selectedProfileId?: string;
}

export interface ControlCenterNavigationItem {
  id: ControlCenterPageId;
  label: string;
  badge?: number;
}

export type AssistantSurfaceStatus =
  | 'configured'
  | 'needs-manual'
  | 'info-only'
  | 'ready'
  | 'not-detected';

export interface AssistantSurfaceState {
  key: string;
  displayName: string;
  kind: string;
  tier: 'A' | 'B' | 'C';
  primaryDialect: string;
  supported: boolean | string;
  configurationModes: string[];
  detected: boolean;
  isActive: boolean;
  detectionDetails: string[];
  mappedProfileName?: string;
  appliedMode?: string;
  status: AssistantSurfaceStatus;
  statusLabel: string;
  notes: string[];
  settingHints: string[];
  envHints: string[];
  configFileHints: string[];
  guidedSections: GuidedSection[];
  previewSections: GuidedSection[];
}

export interface ProfileSurfaceState {
  id: string;
  name: string;
  baseUrl: string;
  dialect: string;
  profileType: string;
  isActive: boolean;
  lastVerified?: string;
  assistantCount: number;
  assistantNames: string[];
}

export interface ChangeEntrySurfaceState {
  id: string;
  timestamp: string;
  assistantKey: string;
  profileName: string;
  summary: string;
}

export interface OverviewSurfaceState {
  profileCount: number;
  detectedAssistantCount: number;
  configuredAssistantCount: number;
  manualFollowUpCount: number;
  activeProfileName?: string;
  activeProfileBaseUrl?: string;
  pendingAssistants: AssistantSurfaceState[];
  configuredAssistants: AssistantSurfaceState[];
  detectedAssistants: AssistantSurfaceState[];
}

export interface ProfilesPageState {
  items: ProfileSurfaceState[];
  selected?: ProfileSurfaceState;
}

export interface AssistantsPageState {
  items: AssistantSurfaceState[];
  selected?: AssistantSurfaceState;
}

export interface GuidedSetupPageState {
  items: AssistantSurfaceState[];
  selected?: AssistantSurfaceState;
  isPreview: boolean;
}

export interface VerificationPageState {
  profiles: ProfileSurfaceState[];
}

export interface ModelsPageState {
  activeProfile?: ProfileSurfaceState;
  note: string;
}

export interface DiagnosticsPageState {
  recentLogs: readonly LogEntry[];
  logCount: number;
  changeCount: number;
}

export interface HistoryResetPageState {
  recentChanges: ChangeEntrySurfaceState[];
}

export interface AdvancedSettingSurfaceState {
  label: string;
  value: string;
  description: string;
}

export interface AdvancedPageState {
  settings: AdvancedSettingSurfaceState[];
}

export interface ControlCenterState {
  page: ControlCenterPageId;
  selectedAssistantKey?: string;
  selectedProfileId?: string;
  generatedAt: string;
  activeProfileName?: string;
  navigation: ControlCenterNavigationItem[];
  overview: OverviewSurfaceState;
  profiles: ProfilesPageState;
  assistants: AssistantsPageState;
  guidedSetup: GuidedSetupPageState;
  verification: VerificationPageState;
  models: ModelsPageState;
  diagnostics: DiagnosticsPageState;
  historyReset: HistoryResetPageState;
  advanced: AdvancedPageState;
}