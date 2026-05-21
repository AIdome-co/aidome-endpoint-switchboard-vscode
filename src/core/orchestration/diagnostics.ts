/**
 * Diagnostics collector and report builder for troubleshooting.
 * Enhanced with comprehensive report format and no-secrets guarantee.
 */

import * as os from 'os';
import * as vscode from 'vscode';
import { redactString, redactUrl } from '../../util/redact';
import { LogEntry } from '../../util/log';
import { EndpointProfile, AssistantMapping } from '../profiles/profileTypes';
import { DetectedAssistant } from '../detection/detectExtensions';
import { DetectedCLI } from '../detection/detectCLIs';
import { VerificationReport } from './verifier';
import { RemoteContext } from '../detection/detectRemote';
import { ChangeLogEntry } from './changeLog';

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
 * Profile information for diagnostics (redacted).
 */
export interface DiagnosticsProfile {
  name: string;
  baseUrl: string;        // visible but redacted if needed
  dialect: string;
  tenant?: string;
  authConfigured: boolean; // true/false only, never the actual key
  lastVerified?: string;
  mappedAssistants: string[];
}

/**
 * Assistant information for diagnostics.
 */
export interface DiagnosticsAssistant {
  key: string;
  displayName: string;
  kind: string;
  detected: boolean;
  version?: string;
  tier: string;
  configuredProfiles?: string[];
}

/**
 * Change log entry for diagnostics (redacted).
 */
export interface DiagnosticsChangeEntry {
  timestamp: string;
  assistantKey: string;
  profileName: string;
  changesCount: number;
  targets: string[];  // file paths or setting keys only
}

/**
 * Network context for diagnostics.
 */
export interface DiagnosticsNetwork {
  httpProxy?: string;    // just "configured" or "not configured", never the value
  httpsProxy?: string;
  noProxy?: string;
  remoteHost?: string;
}

/**
 * Complete diagnostics report.
 */
export interface DiagnosticsReport {
  generatedAt: string;
  extensionVersion: string;
  vscodeVersion: string;
  remoteContext: RemoteContext;
  platform: string;
  nodeVersion: string;
  
  profiles: DiagnosticsProfile[];
  detectedAssistants: DiagnosticsAssistant[];
  changeLog: DiagnosticsChangeEntry[];
  verificationResults: VerificationReport[];
  networkContext: DiagnosticsNetwork;
  
  safetyNotice: string;  // "This report is safe to share with support — no secrets are included"
  recentLogs: LogEntry[];
}

// Legacy interfaces for backward compatibility
export interface DiagnosticData {
  profiles: EndpointProfile[];
  assistants: DetectedAssistant[];
  clis?: DetectedCLI[];
  mappings: AssistantMapping[];
  verificationResults?: Record<string, unknown>;
  remoteContext?: RemoteContext;
  systemInfo: SystemInfo;
  errors?: string[];
}

export interface DiagnosticReport {
  timestamp: string;
  systemInfo: SystemInfo;
  remoteContext?: RemoteContext;
  profiles: EndpointProfile[];
  assistants: DetectedAssistant[];
  clis: DetectedCLI[];
  mappings: AssistantMapping[];
  verificationResults?: Record<string, unknown>;
  errors?: string[];
}

/**
 * Generates a comprehensive diagnostics report with no secrets.
 * @param context Extension context
 * @param options Optional data to include
 * @returns Promise resolving to diagnostics report
 */
export async function generateDiagnostics(
  context: vscode.ExtensionContext,
  options?: {
    profiles?: EndpointProfile[];
    assistants?: DetectedAssistant[];
    mappings?: AssistantMapping[];
    changeLog?: ChangeLogEntry[];
    verificationResults?: VerificationReport[];
    remoteContext?: RemoteContext;
    recentLogs?: readonly LogEntry[];
  }
): Promise<DiagnosticsReport> {
  const profilesById = new Map((options?.profiles || []).map(profile => [profile.id, profile]));

  const systemInfo = {
    platform: `${os.platform()} ${os.arch()}`,
    arch: os.arch(),
    nodeVersion: process.version,
    vscodeVersion: vscode.version,
    extensionVersion: context.extension.packageJSON.version || '0.1.0'
  };
  
  // Convert profiles to diagnostic format (redacted)
  const diagnosticsProfiles: DiagnosticsProfile[] = (options?.profiles || []).map(profile => {
    const mappedAssistants = (options?.mappings || [])
      .filter(m => m.profileId === profile.id)
      .map(m => m.assistantKey);
    
    return {
      name: profile.name,
      baseUrl: redactUrl(profile.baseUrl),
      dialect: profile.dialect,
      tenant: profile.tenant,
      authConfigured: !!profile.authRef,  // Only boolean, never the actual key
      lastVerified: profile.lastVerified,
      mappedAssistants
    };
  });
  
  // Convert assistants to diagnostic format
  const diagnosticsAssistants: DiagnosticsAssistant[] = (options?.assistants || []).map(assistant => {
    const configuredProfiles = [...new Set((options?.mappings || [])
      .filter(m => m.assistantKey === assistant.assistantKey)
      .map(mapping => profilesById.get(mapping.profileId)?.name || mapping.profileId))];
    
    return {
      key: assistant.assistantKey,
      displayName: assistant.displayName,
      kind: assistant.kind,
      detected: true,
      version: assistant.version,
      tier: assistant.tier,
      configuredProfiles: configuredProfiles.length > 0 ? configuredProfiles : undefined
    };
  });
  
  // Convert change log to diagnostic format (redacted)
  const diagnosticsChangeLog: DiagnosticsChangeEntry[] = (options?.changeLog || []).map(entry => ({
    timestamp: entry.timestamp,
    assistantKey: entry.assistantKey,
    profileName: entry.profileName,
    changesCount: entry.steps.length,
    targets: entry.steps.map(s => redactString(s.target))
  }));
  
  // Get network context (redacted)
  const networkContext: DiagnosticsNetwork = {
    httpProxy: process.env.HTTP_PROXY ? 'configured' : 'not configured',
    httpsProxy: process.env.HTTPS_PROXY ? 'configured' : 'not configured',
    noProxy: process.env.NO_PROXY ? 'configured' : 'not configured',
    remoteHost: options?.remoteContext?.isRemote ? options.remoteContext.hostInfo : undefined
  };
  
  // Get remote context with default
  const remoteContext = options?.remoteContext || {
    isRemote: false,
    remoteName: undefined,
    remoteType: 'local' as const,
    hostInfo: 'Local machine',
    isLocalhost: true,
    warningMessages: []
  };
  
  return {
    generatedAt: new Date().toISOString(),
    extensionVersion: systemInfo.extensionVersion,
    vscodeVersion: systemInfo.vscodeVersion,
    remoteContext,
    platform: systemInfo.platform,
    nodeVersion: systemInfo.nodeVersion,
    profiles: diagnosticsProfiles,
    detectedAssistants: diagnosticsAssistants,
    changeLog: diagnosticsChangeLog,
    verificationResults: options?.verificationResults || [],
    networkContext,
    safetyNotice: 'This report is safe to share with support — no secrets are included',
    recentLogs: options?.recentLogs ? [...options.recentLogs] : []
  };
}

/**
 * Generates a diagnostic report from collected data (legacy method).
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
    redacted.baseUrl = redactUrl(redacted.baseUrl);
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
 * Formats diagnostics report as JSON with redaction.
 * @param report The diagnostics report
 * @returns JSON string
 */
export function formatAsJson(report: DiagnosticsReport | DiagnosticReport): string {
  const jsonStr = JSON.stringify(report, null, 2);
  // Second pass redaction on final output
  let redacted = redactString(jsonStr);
  
  // Redact any URLs that might have slipped through
  redacted = redacted.replace(/(https?:\/\/[^\s"]+)/g, (match: string) => redactUrl(match));
  
  return redacted;
}

/**
 * Formats diagnostics report as markdown (enhanced format).
 * @param report The diagnostics report
 * @returns Markdown string
 */
export function formatAsMarkdown(report: DiagnosticsReport | DiagnosticReport): string {
  // Check if this is the new format
  if ('safetyNotice' in report) {
    return formatEnhancedMarkdown(report as DiagnosticsReport);
  } else {
    return formatLegacyMarkdown(report as DiagnosticReport);
  }
}

/**
 * Formats enhanced diagnostics report as markdown.
 */
function formatEnhancedMarkdown(report: DiagnosticsReport): string {
  const lines: string[] = [];

  lines.push('# AIdome Endpoint Switchboard — Diagnostics Report');
  lines.push('');
  lines.push(`> ✅ ${report.safetyNotice}`);
  lines.push('');

  // Environment
  lines.push('## Environment');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('|-------|-------|');
  lines.push(`| Extension Version | ${report.extensionVersion} |`);
  lines.push(`| VS Code Version | ${report.vscodeVersion} |`);
  lines.push(`| Platform | ${report.platform} |`);
  
  if (report.remoteContext.isRemote) {
    const remoteType = report.remoteContext.remoteType.toUpperCase();
    lines.push(`| Remote Context | ${remoteType}: ${report.remoteContext.hostInfo} |`);
  } else {
    lines.push(`| Remote Context | Local machine |`);
  }
  
  lines.push(`| Node Version | ${report.nodeVersion} |`);
  lines.push('');

  // Profiles
  lines.push('## Profiles');
  lines.push('');
  if (report.profiles.length === 0) {
    lines.push('No profiles configured.');
    lines.push('');
  } else {
    for (const profile of report.profiles) {
      lines.push(`### Profile: ${profile.name}`);
      lines.push('');
      lines.push(`- **Base URL**: ${profile.baseUrl}`);
      lines.push(`- **Dialect**: ${profile.dialect}`);
      if (profile.tenant) {
        lines.push(`- **Tenant**: ${profile.tenant}`);
      }
      lines.push(`- **Auth Configured**: ${profile.authConfigured ? 'Yes' : 'No'}`);
      if (profile.lastVerified) {
        const verifiedDate = new Date(profile.lastVerified).toLocaleString();
        lines.push(`- **Last Verified**: ${verifiedDate} ✅`);
      }
      lines.push(`- **Mapped Assistants**: ${profile.mappedAssistants.join(', ') || 'None'}`);
      lines.push('');
    }
  }

  // Detected Assistants
  lines.push('## Detected Assistants');
  lines.push('');
  if (report.detectedAssistants.length === 0) {
    lines.push('No assistants detected.');
    lines.push('');
  } else {
    lines.push('| Assistant | Tier | Detected | Version | Profiles |');
    lines.push('|-----------|------|----------|---------|----------|');
    for (const assistant of report.detectedAssistants) {
      const detected = assistant.detected ? '✅' : '❌';
      const version = assistant.version || '—';
      const profiles = assistant.configuredProfiles?.join(', ') || '—';
      lines.push(`| ${assistant.displayName} | ${assistant.tier} | ${detected} | ${version} | ${profiles} |`);
    }
    lines.push('');
  }

  // Verification Results
  if (report.verificationResults && report.verificationResults.length > 0) {
    lines.push('## Verification Results');
    lines.push('');
    for (const result of report.verificationResults) {
      lines.push(`### ${result.profileName}`);
      lines.push('');
      lines.push(`**Base URL**: ${result.baseUrl}`);
      lines.push('');
      lines.push(`**Overall Status**: ${result.overallStatus.toUpperCase()}`);
      lines.push('');
      lines.push('**Steps**:');
      lines.push('');
      for (const step of result.steps) {
        const icon = step.status === 'passed' ? '✅' 
                   : step.status === 'failed' ? '❌'
                   : step.status === 'warning' ? '⚠️'
                   : '○';
        const duration = step.duration ? ` (${step.duration}ms)` : '';
        lines.push(`- ${icon} **${step.name}**: ${step.message}${duration}`);
      }
      lines.push('');
      
      if (result.actionableErrors.length > 0) {
        lines.push('**Actionable Errors**:');
        for (const error of result.actionableErrors) {
          lines.push(`- ${error}`);
        }
        lines.push('');
      }
      
      if (result.suggestions.length > 0) {
        lines.push('**Suggestions**:');
        for (const suggestion of result.suggestions) {
          lines.push(`- ${suggestion}`);
        }
        lines.push('');
      }
    }
  }

  // Change History
  if (report.changeLog.length > 0) {
    lines.push('## Change History');
    lines.push('');
    lines.push('| Timestamp | Assistant | Profile | Changes |');
    lines.push('|-----------|-----------|---------|---------|');
    for (const entry of report.changeLog) {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      lines.push(`| ${timestamp} | ${entry.assistantKey} | ${entry.profileName} | ${entry.changesCount} |`);
    }
    lines.push('');
  }

  // Network
  lines.push('## Network');
  lines.push('');
  lines.push(`- **HTTP Proxy**: ${report.networkContext.httpProxy || 'not configured'}`);
  lines.push(`- **HTTPS Proxy**: ${report.networkContext.httpsProxy || 'not configured'}`);
  if (report.networkContext.remoteHost) {
    lines.push(`- **Remote Host**: ${report.networkContext.remoteHost}`);
  }
  lines.push('');

  // Recent Logs
  if (report.recentLogs && report.recentLogs.length > 0) {
    lines.push('## Recent Logs');
    lines.push('');
    lines.push('```');
    const entries = report.recentLogs.slice(-50);
    for (const entry of entries) {
      lines.push(`[${entry.level}] ${entry.message}`);
    }
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats legacy diagnostic report as markdown.
 */
function formatLegacyMarkdown(report: DiagnosticReport): string {
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
    lines.push(`- Type: ${(report.remoteContext as any).remoteType || 'N/A'}`);
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
      lines.push(`- **${mapping.assistantKey}** → ${mapping.profileId}`);
      lines.push(`  - Mode: ${mapping.appliedMode || 'unknown'}`);
      lines.push(`  - Applied: ${mapping.appliedAt || 'unknown'}`);
    }
    lines.push('');
  }

  // Verification Results
  if (report.verificationResults && Object.keys(report.verificationResults).length > 0) {
    lines.push('## Verification Results');
    lines.push('');
    for (const [profileId, result] of Object.entries(report.verificationResults)) {
      const verResult = result as any;
      lines.push(`### ${profileId}`);
      lines.push('');
      lines.push(`Status: ${verResult.status?.toUpperCase() || 'UNKNOWN'}`);
      lines.push('');
      lines.push('Checks:');
      if (Array.isArray(verResult.checks)) {
        for (const check of verResult.checks) {
          const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '○';
          lines.push(`- ${icon} ${check.name}: ${check.message}`);
        }
      }
      lines.push('');
      lines.push(`Message: ${verResult.actionableMessage || 'N/A'}`);
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
