import * as vscode from 'vscode';
import { PlanStep } from '../../core/orchestration/planBuilder';
import { showOutput } from '../output';
import { renderControlCenterHtml } from './renderer';
import { buildControlCenterState } from './state';
import {
  getControlCenterPreferences,
  initializeControlCenterStore,
  saveControlCenterPreferences,
  upsertGuidedStep
} from './store';
import { ControlCenterPageId, ControlCenterPreferences } from './types';
import { ProfileStore } from '../../core/profiles/profileStore';
import { showError, showSuccess, showWarning } from '../notifications';
import { activateProfileAndReapplyMappings, getProfileActivationNotice } from '../../commands/profileActivation';
import { onDidChangeSetupWizardState } from '../../commands/setupSwitchboard';

let extensionContext: vscode.ExtensionContext | undefined;
let controlCenterPanel: vscode.WebviewPanel | undefined;
let controlCenterState: ControlCenterPreferences = { page: 'overview' };
let profileChangeListenerRegistered = false;
let setupWizardListenerRegistered = false;
let configurationChangeListenerRegistered = false;

type ControlCenterMessage =
  | { type: 'navigate'; page: ControlCenterPageId }
  | { type: 'select-assistant'; assistantKey: string }
  | { type: 'select-profile'; profileId: string }
  | { type: 'reapply-profile'; profileId: string }
  | { type: 'copy'; value: string; label?: string }
  | { type: 'open-file'; path: string }
  | { type: 'run-command'; command: string; args?: string[] }
  | { type: 'show-output' };

export function initializeControlCenter(context: vscode.ExtensionContext): void {
  extensionContext = context;
  initializeControlCenterStore(context);
  controlCenterState = getControlCenterPreferences();

  if (!profileChangeListenerRegistered) {
    context.subscriptions.push(ProfileStore.onDidChange(() => {
      void renderControlCenter();
    }));
    profileChangeListenerRegistered = true;
  }

  if (!setupWizardListenerRegistered) {
    context.subscriptions.push(onDidChangeSetupWizardState(() => {
      void renderControlCenter();
    }));
    setupWizardListenerRegistered = true;
  }

  if (!configurationChangeListenerRegistered) {
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('aidome-switchboard')) {
        void renderControlCenter();
      }
    }));
    configurationChangeListenerRegistered = true;
  }
}

export async function openControlCenter(overrides: Partial<ControlCenterPreferences> = {}): Promise<void> {
  if (!extensionContext) {
    throw new Error('Control center has not been initialized yet.');
  }

  controlCenterState = {
    ...getControlCenterPreferences(),
    ...controlCenterState,
    ...overrides
  };

  if (!controlCenterPanel) {
    controlCenterPanel = createControlCenterPanel();
  }

  await renderControlCenter();
  controlCenterPanel.reveal(vscode.ViewColumn.Active, false);
}

export async function openGuidedSetup(assistantKey?: string): Promise<void> {
  await openControlCenter({
    page: 'guided-setup',
    selectedAssistantKey: assistantKey || controlCenterState.selectedAssistantKey
  });
}

export async function showGuidedAssistantSetup(step: PlanStep): Promise<void> {
  await upsertGuidedStep(step);
  await openControlCenter({
    page: 'guided-setup',
    selectedAssistantKey: step.assistantKey
  });
}

function createControlCenterPanel(): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'aidomeControlCenter',
    'AIdome Control Center',
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  panel.onDidDispose(() => {
    controlCenterPanel = undefined;
  });

  panel.webview.onDidReceiveMessage(async (message: ControlCenterMessage) => {
    await handleMessage(message);
  });

  return panel;
}

async function handleMessage(message: ControlCenterMessage): Promise<void> {
  switch (message.type) {
    case 'navigate':
      controlCenterState = {
        ...controlCenterState,
        page: message.page
      };
      await renderControlCenter();
      return;

    case 'select-assistant':
      controlCenterState = {
        ...controlCenterState,
        selectedAssistantKey: message.assistantKey
      };
      await renderControlCenter();
      return;

    case 'select-profile':
      controlCenterState = {
        ...controlCenterState,
        selectedProfileId: message.profileId
      };
      await renderControlCenter();
      return;

    case 'reapply-profile':
      if (!extensionContext) {
        return;
      }

      controlCenterState = {
        ...controlCenterState,
        selectedProfileId: message.profileId
      };

      {
        const activation = await activateProfileAndReapplyMappings(extensionContext, message.profileId);
        const notice = getProfileActivationNotice(activation);

        if (notice.kind === 'success') {
          await showSuccess(notice.message);
        } else if (notice.kind === 'warning') {
          await showWarning(notice.message);
        } else {
          await showError(notice.message);
        }
      }
      await renderControlCenter();
      return;

    case 'copy':
      await vscode.env.clipboard.writeText(message.value);
      await vscode.window.showInformationMessage(`${message.label || 'Value'} copied to clipboard.`);
      return;

    case 'open-file': {
      const uri = vscode.Uri.file(message.path);
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: false });
      return;
    }

    case 'run-command':
      if (message.command === 'aidome-switchboard.setupSwitchboard') {
        void Promise.resolve(vscode.commands.executeCommand(message.command, ...(message.args || [])))
          .finally(() => {
            void renderControlCenter();
          });
        await renderControlCenter();
        return;
      }

      await vscode.commands.executeCommand(message.command, ...(message.args || []));
      await renderControlCenter();
      return;

    case 'show-output':
      showOutput();
      return;
  }
}

async function renderControlCenter(): Promise<void> {
  if (!extensionContext || !controlCenterPanel) {
    return;
  }

  const state = await buildControlCenterState(extensionContext, controlCenterState);
  controlCenterState = {
    page: state.page,
    selectedAssistantKey: state.selectedAssistantKey,
    selectedProfileId: state.selectedProfileId
  };
  await saveControlCenterPreferences(controlCenterState);

  controlCenterPanel.title = 'AIdome Control Center';
  controlCenterPanel.webview.html = renderControlCenterHtml(state);
}