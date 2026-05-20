/**
 * Result rendering helpers for setup and verification flows.
 */

import { DetectedAssistant } from '../core/detection/detectExtensions';
import { DetectedCLI } from '../core/detection/detectCLIs';

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