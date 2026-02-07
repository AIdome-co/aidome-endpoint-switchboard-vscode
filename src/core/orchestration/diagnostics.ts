/**
 * Diagnostics collector and report builder for troubleshooting.
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { redactObject, redactApiKey } from '../../util/redact';
import { EndpointProfile, AssistantMapping } from '../profiles/profileTypes';
import { DetectedAssistant } from '../detection/detectExtensions';
import { DetectedCLI } from '../detection/detectCLIs';
import { VerificationResult } from './verifier';

/**
 * Remote context information (for SSH/Codespaces).
 */
export interface RemoteContext {
  isRemote: boolean;
  remoteName?: string;
  remoteAuthority?: string;
}

/**
 * System information.
 */
export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  vscodeVersion: string;
  extensionVersion: string;
}

/**
 * Input data for diagnostic report generation.
 */
export interface DiagnosticData {
  profiles: EndpointProfile[];
  assistants: DetectedAssistant[];
  clis?: DetectedCLI[];
  mappings: AssistantMapping[];
  verificationResults?: Record<string, VerificationResult>;
  remoteContext?: RemoteContext;
  systemInfo: SystemInfo;
  errors?: string[];
}

/**
 * Complete diagnostic report.
 */
export interface DiagnosticReport {
  timestamp: string;
  systemInfo: SystemInfo;
  remoteContext?: RemoteContext;
  profiles: EndpointProfile[];
  assistants: DetectedAssistant[];
  clis: DetectedCLI[];
  mappings: AssistantMapping[];
  verificationResults?: Record<string, VerificationResult>;
  errors?: string[];
}

/**
 * Generates a diagnostic report from collected data.
 * @param data The diagnostic data
 * @returns Diagnostic report with redacted secrets
 */
export function generateDiagnosticReport(data: DiagnosticData): DiagnosticReport {
  // Redact profiles to hide sensitive data
  const redactedProfiles = data.profiles.map(profile => {
    const redacted = { ...profile };
    if (redacted.authRef) {
      redacted.authRef = 'REDACTED';
    }
    return redacted;
  });

  return {
    timestamp: new Date().toISOString(),
    systemInfo: data.systemInfo,
    remoteContext: data.remoteContext,
    profiles: redactedProfiles,
    assistants: data.assistants,
    clis: data.clis || [],
    mappings: data.mappings,
    verificationResults: data.verificationResults,
    errors: data.errors
  };
}

/**
 * Formats diagnostic report as JSON.
 * @param report The diagnostic report
 * @returns JSON string
 */
export function formatAsJson(report: DiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Formats diagnostic report as markdown.
 * @param report The diagnostic report
 * @returns Markdown string
 */
export function formatAsMarkdown(report: DiagnosticReport): string {
  const lines: string[] = [];

  lines.push('# AIdome Endpoint Switchboard - Diagnostic Report');
  lines.push('');
  lines.push(`Generated: ${report.timestamp}`);
  lines.push('');

  // System Information
  lines.push('## System Information');
  lines.push('');
  lines.push(`- Platform: ${report.systemInfo.platform} (${report.systemInfo.arch})`);
  lines.push(`- VS Code: ${report.systemInfo.vscodeVersion}`);
  lines.push(`- Extension: ${report.systemInfo.extensionVersion}`);
  lines.push(`- Node.js: ${report.systemInfo.nodeVersion}`);
  lines.push('');

  // Remote Context
  if (report.remoteContext?.isRemote) {
    lines.push('## Remote Environment');
    lines.push('');
    lines.push(`- Remote: Yes`);
    lines.push(`- Name: ${report.remoteContext.remoteName || 'N/A'}`);
    lines.push(`- Authority: ${report.remoteContext.remoteAuthority || 'N/A'}`);
    lines.push('');
  }

  // Profiles
  lines.push('## Endpoint Profiles');
  lines.push('');
  if (report.profiles.length === 0) {
    lines.push('No profiles configured.');
  } else {
    for (const profile of report.profiles) {
      lines.push(`### ${profile.name}`);
      lines.push('');
      lines.push(`- Type: ${profile.profileType}`);
      lines.push(`- Base URL: ${profile.baseUrl}`);
      lines.push(`- Dialect: ${profile.dialect}`);
      lines.push(`- Auth: ${profile.authRef ? 'REDACTED' : 'None'}`);
      if (profile.tenant) {
        lines.push(`- Tenant: ${profile.tenant}`);
      }
      if (profile.lastVerified) {
        lines.push(`- Last Verified: ${profile.lastVerified}`);
      }
      lines.push('');
    }
  }

  // Detected Assistants
  lines.push('## Detected Assistants');
  lines.push('');
  if (report.assistants.length === 0) {
    lines.push('No assistants detected.');
  } else {
    for (const assistant of report.assistants) {
      lines.push(`- **${assistant.displayName}** (${assistant.assistantKey})`);
      lines.push(`  - Version: ${assistant.version}`);
      lines.push(`  - Extension ID: ${assistant.extensionId}`);
      lines.push(`  - Active: ${assistant.isActive ? 'Yes' : 'No'}`);
      lines.push(`  - Tier: ${assistant.tier}`);
    }
    lines.push('');
  }

  // Detected CLIs
  if (report.clis.length > 0) {
    lines.push('## Detected CLI Tools');
    lines.push('');
    for (const cli of report.clis) {
      lines.push(`- **${cli.command}** (${cli.assistantKey})`);
      if (cli.version) {
        lines.push(`  - Version: ${cli.version}`);
      }
      if (cli.path) {
        lines.push(`  - Path: ${cli.path}`);
      }
    }
    lines.push('');
  }

  // Assistant Mappings
  lines.push('## Assistant Mappings');
  lines.push('');
  if (report.mappings.length === 0) {
    lines.push('No mappings configured.');
  } else {
    for (const mapping of report.mappings) {
      lines.push(`- **${mapping.assistantKey}** → ${mapping.profileName}`);
      lines.push(`  - Mode: ${mapping.appliedMode}`);
      lines.push(`  - Applied: ${mapping.appliedAt}`);
    }
    lines.push('');
  }

  // Verification Results
  if (report.verificationResults && Object.keys(report.verificationResults).length > 0) {
    lines.push('## Verification Results');
    lines.push('');
    for (const [profileId, result] of Object.entries(report.verificationResults)) {
      lines.push(`### ${profileId}`);
      lines.push('');
      lines.push(`Status: ${result.status.toUpperCase()}`);
      lines.push('');
      lines.push('Checks:');
      for (const check of result.checks) {
        const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○';
        lines.push(`- ${icon} ${check.name}: ${check.message}`);
      }
      lines.push('');
      lines.push(`Message: ${result.actionableMessage}`);
      lines.push('');
    }
  }

  // Errors
  if (report.errors && report.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const error of report.errors) {
      lines.push(`- ${error}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
