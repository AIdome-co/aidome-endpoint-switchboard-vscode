import * as vscode from 'vscode';
import { validateInputUrl } from '../core/profiles/profileValidator';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { ProfileStore } from '../core/profiles/profileStore';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { Dialect } from '../core/dialects/dialectTypes';
import { showInfo } from '../ui/notifications';

export interface ProfileTypeQuickPickItem extends vscode.QuickPickItem {
  value: EndpointProfile['profileType'];
}

export interface DialectQuickPickItem extends vscode.QuickPickItem {
  dialect?: Dialect;
  value?: Dialect;
}

export interface BooleanQuickPickItem extends vscode.QuickPickItem {
  value: boolean;
}

const CREATE_PROFILE_STEP_KEYS = [
  'name',
  'profileType',
  'baseUrl',
  'dialect',
  'tenant',
  'authentication',
  'authToken'
] as const;

export type CreateProfileStepKey = (typeof CREATE_PROFILE_STEP_KEYS)[number];
export type CreateProfileStepLabels = Record<CreateProfileStepKey, string>;

export interface CreateProfileTitleOptions {
  flowTitle: string;
  contextLabel?: string;
  progressLabel?: string;
}

export interface CreateProfileFlowOptions {
  name: {
    title: string;
    prompt: string;
    placeHolder: string;
    ignoreFocusOut?: boolean;
    maxLength?: number;
    requireUniqueName?: boolean;
  };
  profileType: {
    title: string;
    placeHolder: string;
    options: ProfileTypeQuickPickItem[];
    ignoreFocusOut?: boolean;
  };
  baseUrl: {
    title: string;
    prompt: string;
    placeHolders: Record<EndpointProfile['profileType'], string>;
    defaultValues?: Partial<Record<EndpointProfile['profileType'], string>>;
    ignoreFocusOut?: boolean;
  };
  dialect: {
    title: string;
    placeHolder: string;
    options: DialectQuickPickItem[];
    autoDetectInfoMessage: string;
    ignoreFocusOut?: boolean;
  };
  tenant: {
    title: string;
    prompt: string;
    placeHolders: Record<EndpointProfile['profileType'], string>;
    ignoreFocusOut?: boolean;
  };
  authentication: {
    title: string;
    placeHolder: string;
    options: BooleanQuickPickItem[];
    ignoreFocusOut?: boolean;
  };
  authToken: {
    title: string;
    prompt: string;
    placeHolder: string;
    ignoreFocusOut?: boolean;
  };
}

function formatCreateProfileStepTitle(
  titleOptions: CreateProfileTitleOptions,
  stepLabel: string,
  stepIndex: number,
  totalSteps: number
): string {
  if (!titleOptions.contextLabel) {
    return `${titleOptions.flowTitle} (${stepIndex}/${totalSteps}): ${stepLabel}`;
  }

  return `${titleOptions.flowTitle} (${titleOptions.contextLabel}, ${titleOptions.progressLabel ?? 'Profile'} ${stepIndex}/${totalSteps}): ${stepLabel}`;
}

/**
 * Builds ordered step titles for the shared profile-creation flow.
 * @param stepLabels Per-step labels shown after the progress prefix
 * @param titleOptions Flow-level title context
 * @returns Step titles aligned to the shared profile-creation sequence
 */
export function buildCreateProfileStepTitles(
  stepLabels: CreateProfileStepLabels,
  titleOptions: CreateProfileTitleOptions
): CreateProfileStepLabels {
  const totalSteps = CREATE_PROFILE_STEP_KEYS.length;

  return CREATE_PROFILE_STEP_KEYS.reduce((titles, stepKey, index) => {
    titles[stepKey] = formatCreateProfileStepTitle(
      titleOptions,
      stepLabels[stepKey],
      index + 1,
      totalSteps
    );
    return titles;
  }, {} as CreateProfileStepLabels);
}

export const AUTO_DETECT_DIALECT_INFO_MESSAGE =
  'Auto-detect currently defaults to openai.chat_completions. It does not probe the endpoint.';

export const DEFAULT_PROFILE_TYPE_OPTIONS: ProfileTypeQuickPickItem[] = [
  {
    label: 'AIdome Gateway',
    description: 'Managed LLM gateway with multi-provider support',
    value: 'aidome'
  },
  {
    label: 'Custom Endpoint',
    description: 'Your own OpenAI-compatible endpoint',
    value: 'custom'
  }
];

export const DEFAULT_AUTH_OPTIONS: BooleanQuickPickItem[] = [
  { label: 'Yes', description: 'Endpoint requires authentication', value: true },
  { label: 'No', description: 'No authentication required', value: false }
];

export const FULL_DIALECT_OPTIONS: DialectQuickPickItem[] = [
  {
    label: '$(search) Auto-detect',
    description: 'Defaults to openai.chat_completions',
    detail: 'Does not probe the endpoint; recommended for AIdome gateways',
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

export const SETUP_DIALECT_OPTIONS: DialectQuickPickItem[] = [
  {
    label: '$(search) Auto-detect',
    description: 'Defaults to openai.chat_completions',
    detail: 'Does not probe the endpoint; recommended for AIdome gateways',
    value: undefined,
  },
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
];

/**
 * Prompts the user for profile details, persists the profile, and stores its optional secret.
 * @param profileStore Profile storage service
 * @param profileSecrets Secret storage service
 * @param options Flow-specific prompt copy and option catalogs
 * @param existingProfiles Optional existing profiles for uniqueness checks
 * @returns Persisted profile or undefined when the user cancels
 */
export async function createProfileFromPrompts(
  profileStore: ProfileStore,
  profileSecrets: ProfileSecrets,
  options: CreateProfileFlowOptions,
  existingProfiles?: EndpointProfile[]
): Promise<EndpointProfile | undefined> {
  const knownProfiles = existingProfiles ?? await profileStore.getProfiles();

  const name = await vscode.window.showInputBox({
    title: options.name.title,
    prompt: options.name.prompt,
    placeHolder: options.name.placeHolder,
    ignoreFocusOut: options.name.ignoreFocusOut,
    validateInput: (value) => {
      const trimmedValue = value.trim();
      if (!trimmedValue) {
        return 'Profile name cannot be empty';
      }
      if (options.name.maxLength && value.length > options.name.maxLength) {
        return `Profile name must be ${options.name.maxLength} characters or less`;
      }
      if (options.name.requireUniqueName && knownProfiles.some(profile => profile.name === trimmedValue)) {
        return 'A profile with this name already exists';
      }
      return undefined;
    }
  });

  if (!name) {
    return undefined;
  }

  const typeChoice = await vscode.window.showQuickPick(options.profileType.options, {
    title: options.profileType.title,
    placeHolder: options.profileType.placeHolder,
    ignoreFocusOut: options.profileType.ignoreFocusOut,
  });

  if (!typeChoice) {
    return undefined;
  }

  const baseUrl = await vscode.window.showInputBox({
    title: options.baseUrl.title,
    prompt: options.baseUrl.prompt,
    placeHolder: options.baseUrl.placeHolders[typeChoice.value],
    value: options.baseUrl.defaultValues?.[typeChoice.value],
    ignoreFocusOut: options.baseUrl.ignoreFocusOut,
    validateInput: (value) => {
      if (!value.trim()) {
        return 'Base URL cannot be empty';
      }
      if (!validateInputUrl(value.trim())) {
        return 'Enter a valid http:// or https:// URL';
      }
      return undefined;
    }
  });

  if (!baseUrl) {
    return undefined;
  }

  const dialectChoice = await vscode.window.showQuickPick(options.dialect.options, {
    title: options.dialect.title,
    placeHolder: options.dialect.placeHolder,
    ignoreFocusOut: options.dialect.ignoreFocusOut,
  });

  if (!dialectChoice) {
    return undefined;
  }

  const dialect = dialectChoice.dialect ?? dialectChoice.value ?? 'openai.chat_completions';
  if (dialectChoice.dialect === undefined && dialectChoice.value === undefined) {
    void showInfo(options.dialect.autoDetectInfoMessage);
  }

  const tenant = await vscode.window.showInputBox({
    title: options.tenant.title,
    prompt: options.tenant.prompt,
    placeHolder: options.tenant.placeHolders[typeChoice.value],
    ignoreFocusOut: options.tenant.ignoreFocusOut,
  });

  const needsAuth = await vscode.window.showQuickPick(options.authentication.options, {
    title: options.authentication.title,
    placeHolder: options.authentication.placeHolder,
    ignoreFocusOut: options.authentication.ignoreFocusOut,
  });

  if (!needsAuth) {
    return undefined;
  }

  let authToken: string | undefined;
  if (needsAuth.value) {
    authToken = await vscode.window.showInputBox({
      title: options.authToken.title,
      prompt: options.authToken.prompt,
      placeHolder: options.authToken.placeHolder,
      password: true,
      ignoreFocusOut: options.authToken.ignoreFocusOut,
    });

    if (!authToken) {
      return undefined;
    }
  }

  const profile: EndpointProfile = {
    id: `profile-${Date.now()}`,
    name: name.trim(),
    profileType: typeChoice.value,
    baseUrl: baseUrl.trim(),
    dialect,
    authRef: authToken ? name.trim() : undefined,
    tenant: tenant?.trim() || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await profileStore.saveProfile(profile);

  if (authToken) {
    await profileSecrets.storeSecret(profile.name, authToken);
  }

  return profile;
}