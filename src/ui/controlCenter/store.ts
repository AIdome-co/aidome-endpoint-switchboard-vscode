import * as vscode from 'vscode';
import { GuidedStepsData, PlanStep } from '../../core/orchestration/planBuilder';
import { ControlCenterPreferences, GuidedSection } from './types';

const GUIDED_STEPS_STATE_KEY = 'aidome.switchboard.guidedSections';
const CONTROL_CENTER_PREFS_KEY = 'aidome.switchboard.controlCenterPrefs';

let extensionContext: vscode.ExtensionContext | undefined;

type StoredGuidedSections = Record<string, GuidedSection[]>;

export function initializeControlCenterStore(context: vscode.ExtensionContext): void {
  extensionContext = context;
}

export async function upsertGuidedStep(step: PlanStep): Promise<void> {
  if (!extensionContext) {
    return;
  }

  const current = getGuidedSectionsByAssistant();
  const sections = current[step.assistantKey] ? [...current[step.assistantKey]] : [];
  const nextSection: GuidedSection = {
    id: step.id,
    description: step.description,
    data: step.data as GuidedStepsData
  };

  const existingIndex = sections.findIndex(section => section.id === step.id);
  if (existingIndex >= 0) {
    sections[existingIndex] = nextSection;
  } else {
    sections.push(nextSection);
  }

  current[step.assistantKey] = sections;
  await extensionContext.globalState.update(GUIDED_STEPS_STATE_KEY, current);
}

export function getGuidedSectionsByAssistant(): StoredGuidedSections {
  return extensionContext?.globalState.get<StoredGuidedSections>(GUIDED_STEPS_STATE_KEY, {}) || {};
}

export function getControlCenterPreferences(): ControlCenterPreferences {
  return extensionContext?.globalState.get<ControlCenterPreferences>(CONTROL_CENTER_PREFS_KEY, {
    page: 'overview'
  }) || { page: 'overview' };
}

export async function saveControlCenterPreferences(preferences: ControlCenterPreferences): Promise<void> {
  if (!extensionContext) {
    return;
  }

  await extensionContext.globalState.update(CONTROL_CENTER_PREFS_KEY, preferences);
}

export function buildPreviewSections(assistantKey: string): GuidedSection[] {
  const knownPreview = createAssistantPreview(assistantKey);
  if (knownPreview.length > 0) {
    return knownPreview;
  }

  return [
    {
      id: `${assistantKey}-preview-1`,
      description: 'Guided setup preview',
      data: {
        message: 'This is a preview of the guided setup surface. Run AIdome setup to populate it with real manual configuration steps for this assistant.',
        steps: [
          'Run AIdome: Setup Endpoint Switchboard.',
          'Choose an assistant that requires manual follow-up.',
          'Open the control center again to review the persisted setup guidance.'
        ],
        tier: 'B',
        optional: true,
        configurationType: 'preview'
      }
    }
  ];
}

function createAssistantPreview(assistantKey: string): GuidedSection[] {
  switch (assistantKey) {
    case 'claude-code':
      return [
        {
          id: 'claude-code-preview-1',
          description: 'Configure Claude Code gateway routing',
          data: {
            message: 'Preview of the Claude Code manual setup flow.',
            steps: [
              'Open the Claude shared settings file.',
              'Confirm ANTHROPIC_BASE_URL points at your AIdome gateway.',
              'Provide credentials through ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an apiKeyHelper script.',
              'Restart Claude Code or VS Code after changing credentials.',
              'Run Verify Routing once the config is in place.'
            ],
            configPath: '/home/aidome-dev/.claude/settings.json',
            baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
            envVarName: 'ANTHROPIC_AUTH_TOKEN',
            tier: 'B',
            configurationType: 'settings-file-preview'
          }
        },
        {
          id: 'claude-code-preview-2',
          description: 'Why this workspace exists',
          data: {
            message: 'The control center keeps manual assistant setup visible, persistent, and action-oriented instead of hiding it in logs.',
            steps: [
              'Use the left rail to jump between product pages.',
              'Use the assistant list to switch context without rerunning setup.',
              'Use file and copy actions directly inside the page.',
              'Run setup later to replace this preview with real assistant state.'
            ],
            tier: 'B',
            optional: true,
            configurationType: 'preview'
          }
        }
      ];

    case 'kilo-code':
      return [
        {
          id: 'kilo-code-preview-1',
          description: 'Configure Kilo Code base URL',
          data: {
            message: 'Preview of the Kilo Code manual setup flow.',
            steps: [
              'Open VS Code settings.',
              'Search for Kilo Code endpoint or OpenAI base URL settings.',
              'Paste your AIdome gateway URL.',
              'Reload Kilo Code if prompted.',
              'Verify routing after the setting is saved.'
            ],
            baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
            tier: 'B',
            configurationType: 'settings-preview'
          }
        }
      ];

    case 'anythingllm':
      return [
        {
          id: 'anythingllm-preview-1',
          description: 'Configure AnythingLLM desktop app',
          data: {
            message: 'Preview of the AnythingLLM desktop-app guidance flow.',
            steps: [
              'Open the AnythingLLM desktop application.',
              'Go to Settings → LLM Configuration.',
              'Choose a Generic OpenAI or OpenAI-compatible provider.',
              'Paste the AIdome gateway URL into the Base URL field.',
              'Save and test the connection inside AnythingLLM.'
            ],
            baseUrl: 'https://demo-lab-vm-8a4ad0fc.aidome.cloud/v1',
            tier: 'B',
            configurationType: 'desktop-app-preview'
          }
        }
      ];

    default:
      return [];
  }
}