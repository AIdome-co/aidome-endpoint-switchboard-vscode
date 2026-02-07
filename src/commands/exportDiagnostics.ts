/**
 * Export Diagnostics command handler.
 */

import * as vscode from 'vscode';
import * as os from 'os';
import { ProfileStore } from '../core/profiles/profileStore';
import { Switchboard } from '../core/orchestration/switchboard';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { loadRegistry } from '../core/registry/registryLoader';
import { generateDiagnosticReport, formatAsJson, formatAsMarkdown, DiagnosticData } from '../core/orchestration/diagnostics';
import { showError, showSuccess } from '../ui/notifications';
import { Logger } from '../util/log';

/**
 * Handles the exportDiagnostics command.
 * Exports diagnostic information for troubleshooting.
 */
export async function exportDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Generating diagnostics report');
    
    const profileStore = new ProfileStore(context);
    const profileSecrets = new ProfileSecrets(context);
    const registry = await loadRegistry();
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    
    const profiles = await profileStore.getProfiles();
    const mappings = await profileStore.getAssistantMappings();
    const detected = await switchboard.detectAll();
    
    let verificationResults;
    try {
      verificationResults = await switchboard.verifyAll();
    } catch (error) {
      logger.warning('Failed to run verification during diagnostics', error instanceof Error ? error : undefined);
    }
    
    const diagnosticData: DiagnosticData = {
      profiles,
      assistants: detected.assistants,
      clis: detected.clis,
      mappings,
      verificationResults,
      systemInfo: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        vscodeVersion: vscode.version,
        extensionVersion: context.extension.packageJSON.version || '0.1.0'
      }
    };
    
    const report = generateDiagnosticReport(diagnosticData);
    
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Save to file', value: 'file' },
        { label: 'Copy to clipboard', value: 'clipboard' }
      ],
      { placeHolder: 'How would you like to export the diagnostics?' }
    );
    
    if (!choice) {
      return;
    }
    
    const formatChoice = await vscode.window.showQuickPick(
      [
        { label: 'Markdown', value: 'markdown' },
        { label: 'JSON', value: 'json' }
      ],
      { placeHolder: 'Select export format' }
    );
    
    if (!formatChoice) {
      return;
    }
    
    const content = formatChoice.value === 'json' 
      ? formatAsJson(report)
      : formatAsMarkdown(report);
    
    if (choice.value === 'file') {
      const extension = formatChoice.value === 'json' ? 'json' : 'md';
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`aidome-diagnostics-${Date.now()}.${extension}`),
        filters: {
          [formatChoice.label]: [extension]
        }
      });
      
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        await showSuccess(`Diagnostics exported to ${uri.fsPath}`, 'Open');
        logger.info(`Diagnostics exported to ${uri.fsPath}`);
      }
    } else {
      await vscode.env.clipboard.writeText(content);
      await showSuccess('Diagnostics copied to clipboard');
      logger.info('Diagnostics copied to clipboard');
    }
  } catch (error) {
    logger.error('Failed to export diagnostics', error instanceof Error ? error : undefined);
    await showError(`Failed to export diagnostics: ${error instanceof Error ? error.message : String(error)}`);
  }
}
