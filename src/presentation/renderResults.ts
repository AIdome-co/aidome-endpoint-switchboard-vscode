/**
 * Result rendering helpers for setup and verification flows.
 */

import { VerificationResult } from '../core/orchestration/verifier';
import { Plan } from '../core/orchestration/planBuilder';
import { DetectedAssistant } from '../core/detection/detectExtensions';
import { DetectedCLI } from '../core/detection/detectCLIs';

/**
 * Renders verification results as a formatted string.
 * @param results Verification results
 * @returns Formatted string with status indicators
 */
export function renderVerificationResults(results: VerificationResult): string {
  const lines: string[] = [];

  lines.push(`Status: ${results.status.toUpperCase()}`);
  lines.push('');
  lines.push('Checks:');

  for (const check of results.checks) {
    const icon = check.status === 'pass' ? '✅' : check.status === 'fail' ? '❌' : '⚠️';
    lines.push(`${icon} ${check.name}: ${check.message}`);
  }

  lines.push('');
  lines.push(results.actionableMessage);

  return lines.join('\n');
}

/**
 * Renders detection summary as a formatted string.
 * @param detected Object with assistants and clis arrays
 * @returns Formatted string
 */
export function renderDetectionSummary(detected: { assistants: DetectedAssistant[]; clis: DetectedCLI[] }): string {
  const lines: string[] = [];

  lines.push('🔍 Detection Summary');
  lines.push('');

  if (detected.assistants.length > 0) {
    lines.push(`Extensions: ${detected.assistants.length}`);
    for (const assistant of detected.assistants) {
      const statusIcon = assistant.isActive ? '✓' : '○';
      lines.push(`  ${statusIcon} ${assistant.displayName} (${assistant.version})`);
    }
  } else {
    lines.push('No extensions detected');
  }

  lines.push('');

  if (detected.clis.length > 0) {
    lines.push(`CLI Tools: ${detected.clis.length}`);
    for (const cli of detected.clis) {
      lines.push(`  ✓ ${cli.command}${cli.version ? ` (${cli.version})` : ''}`);
    }
  } else {
    lines.push('No CLI tools detected');
  }

  return lines.join('\n');
}

/**
 * Renders plan summary as a formatted string.
 * @param plan Configuration plan
 * @returns Formatted string with step details
 */
export function renderPlanSummary(plan: Plan): string {
  const lines: string[] = [];

  lines.push('📋 Configuration Plan');
  lines.push('');
  lines.push(`Profile: ${plan.profileId}`);
  lines.push(`Assistants: ${plan.assistantKeys.join(', ')}`);
  lines.push(`Total Steps: ${plan.steps.length}`);
  lines.push('');

  lines.push('Steps:');
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    const icon = step.reversible ? '↻' : '→';
    lines.push(`  ${i + 1}. ${icon} ${step.description}`);
  }

  return lines.join('\n');
}