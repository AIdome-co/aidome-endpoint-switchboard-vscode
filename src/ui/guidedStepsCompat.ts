import * as vscode from 'vscode';
import { PlanStep } from '../core/orchestration/planBuilder';
import {
  initializeControlCenter,
  openControlCenter as openControlCenterView,
  openGuidedSetup,
  showGuidedAssistantSetup
} from './controlCenter/view';

export function initializeGuidedStepsView(context: vscode.ExtensionContext): void {
  initializeControlCenter(context);
}

/**
 * Opens the control center using the compatibility bridge.
 * @returns Promise that resolves when the control center is shown.
 */
export async function openControlCenter(): Promise<void> {
  await openControlCenterView();
}

export async function showGuidedStepsView(step: PlanStep): Promise<void> {
  await showGuidedAssistantSetup(step);
}

export async function openGuidedStepsView(assistantKey?: string): Promise<void> {
  await openGuidedSetup(assistantKey);
}