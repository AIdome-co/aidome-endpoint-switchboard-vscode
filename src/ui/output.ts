/**
 * Output channel management for logging.
 */

import * as vscode from 'vscode';
import { redactString } from '../util/redact';
import { Plan } from '../core/orchestration/planBuilder';
import { VerificationResult } from '../core/orchestration/verifier';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Gets or creates the output channel.
 * @returns The output channel
 */
export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AIdome Switchboard');
  }
  return outputChannel;
}

/**
 * Logs a message to the output channel with level formatting.
 * Uses consistent [LEVEL] [TIMESTAMP] format for screen reader parsing.
 * @param message The message to log
 * @param level Log level (INFO, WARN, ERROR, DEBUG)
 */
export function log(message: string, level: string = 'INFO'): void {
  const channel = getOutputChannel();
  const timestamp = new Date().toISOString();
  channel.appendLine(`[${level}] [${timestamp}] ${message}`);
}

/**
 * Logs a message with redaction for sensitive data.
 * @param message The message to log
 * @param level Log level
 */
export function logRedacted(message: string, level: string = 'INFO'): void {
  const redacted = redactString(message);
  log(redacted, level);
}

/**
 * Shows a formatted plan in the output channel.
 * @param plan The plan to display
 */
export function showPlan(plan: Plan): void {
  const channel = getOutputChannel();
  channel.appendLine('');
  channel.appendLine('='.repeat(60));
  channel.appendLine(`Configuration Plan: ${plan.id}`);
  channel.appendLine(`Profile: ${plan.profileId}`);
  channel.appendLine(`Assistants: ${plan.assistantKeys.join(', ')}`);
  channel.appendLine(`Steps: ${plan.steps.length}`);
  channel.appendLine('='.repeat(60));
  
  plan.steps.forEach((step, index) => {
    channel.appendLine(`\n${index + 1}. ${step.description}`);
    channel.appendLine(`   Action: ${step.action}`);
    channel.appendLine(`   Assistant: ${step.assistantKey}`);
    if (step.targetPath) {
      channel.appendLine(`   Target: ${step.targetPath}`);
    }
    if (step.reversible) {
      channel.appendLine(`   Reversible: Yes`);
    }
  });
  
  channel.appendLine('\n' + '='.repeat(60));
  channel.show();
}

/**
 * Shows formatted verification results in the output channel.
 * @param results Verification results by profile ID
 */
export function showResults(results: Record<string, VerificationResult>): void {
  const channel = getOutputChannel();
  channel.appendLine('');
  channel.appendLine('='.repeat(60));
  channel.appendLine('Verification Results');
  channel.appendLine('='.repeat(60));
  
  for (const [profileId, result] of Object.entries(results)) {
    channel.appendLine(`\nProfile: ${profileId}`);
    channel.appendLine(`Status: ${result.status.toUpperCase()}`);
    channel.appendLine('Checks:');
    
    result.checks.forEach(check => {
      const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○';
      channel.appendLine(`  ${icon} ${check.name}: ${check.message}`);
    });
    
    channel.appendLine(`\nMessage: ${result.actionableMessage}`);
  }
  
  channel.appendLine('\n' + '='.repeat(60));
  channel.show();
}

/**
 * Shows the output channel.
 */
export function showOutput(): void {
  getOutputChannel().show();
}

/**
 * Clears the output channel.
 */
export function clearOutput(): void {
  getOutputChannel().clear();
}
