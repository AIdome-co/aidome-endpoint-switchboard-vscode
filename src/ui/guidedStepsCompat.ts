import * as vscode from 'vscode';
import { PlanStep } from '../core/orchestration/planBuilder';
import { showOutput } from './output';

export function initializeGuidedStepsView(_context: vscode.ExtensionContext): void {
}

export async function showGuidedStepsView(_step: PlanStep): Promise<void> {
  showOutput();
}