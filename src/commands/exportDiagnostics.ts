/**
 * Export Diagnostics command handler.
 */

import * as vscode from 'vscode';
import { ProfileStore } from '../core/profiles/profileStore';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { Switchboard } from '../core/orchestration/switchboard';
import { loadRegistry } from '../core/registry/registryLoader';
import { generateDiagnostics, formatAsJson, formatAsMarkdown } from '../core/orchestration/diagnostics';
import { ChangeLog } from '../core/orchestration/changeLog';
import { detectRemote } from '../core/detection/detectRemote';
import { Verifier } from '../core/orchestration/verifier';
import { Logger } from '../util/log';

/**
 * Handles the exportDiagnostics command.
 * Exports diagnostic information for troubleshooting.
 */
export async function exportDiagnostics(context: vscode.ExtensionContext): Promise<void> {
  const logger = Logger.getInstance();
  
  try {
    logger.info('Generating diagnostics report');
    
    // Initialize components
    const profileStore = new ProfileStore(context);
    const profileSecrets = new ProfileSecrets(context);
    const registry = await loadRegistry();
    const switchboard = new Switchboard(context, registry, profileStore, profileSecrets);
    const changeLog = new ChangeLog(context);
    
    // Gather profiles from ProfileStore
    const profiles = await profileStore.getProfiles();
    
    // Detect assistants using Switchboard
    const detected = await switchboard.detectAll();
    
    // Get mappings from ProfileStore
    const mappings = await profileStore.getAssistantMappings();
    
    // Get change log entries using ChangeLog class
    const changeLogEntries = await changeLog.getEntries();
    
    // Optionally run verification
    let verificationResults;
    try {
      const verifier = new Verifier();
      verificationResults = [];
      for (const profile of profiles) {
        const result = await verifier.runVerificationPipeline(profile);
        verificationResults.push(result);
      }
    } catch (error) {
      logger.warning('Failed to run verification during diagnostics', error instanceof Error ? error : undefined);
    }
    
    // Detect remote context
    const remoteContext = detectRemote();
    
    // Generate diagnostics using the new function
    const report = await generateDiagnostics(context, {
      profiles,
      assistants: detected.assistants,
      mappings,
      changeLog: changeLogEntries,
      verificationResults,
      remoteContext,
      recentLogs: Logger.getInstance().getBuffer()
    });
    
    // Show QuickPick with 4 options
    const choice = await vscode.window.showQuickPick(
      [
        { label: 'Save as JSON', value: 'save-json' },
        { label: 'Save as Markdown', value: 'save-markdown' },
        { label: 'Copy JSON to clipboard', value: 'copy-json' },
        { label: 'Copy Markdown to clipboard', value: 'copy-markdown' }
      ],
      { placeHolder: 'How would you like to export the diagnostics?' }
    );
    
    if (!choice) {
      return;
    }
    
    // Handle the choice
    if (choice.value === 'save-json') {
      const content = formatAsJson(report);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`aidome-diagnostics-${Date.now()}.json`),
        filters: {
          'JSON': ['json']
        }
      });
      
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        await vscode.window.showInformationMessage('Diagnostics report exported. This report is safe to share with support.');
        logger.info(`Diagnostics exported to ${uri.fsPath}`);
      }
    } else if (choice.value === 'save-markdown') {
      const content = formatAsMarkdown(report);
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`aidome-diagnostics-${Date.now()}.md`),
        filters: {
          'Markdown': ['md']
        }
      });
      
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        await vscode.window.showInformationMessage('Diagnostics report exported. This report is safe to share with support.');
        logger.info(`Diagnostics exported to ${uri.fsPath}`);
      }
    } else if (choice.value === 'copy-json') {
      const content = formatAsJson(report);
      await vscode.env.clipboard.writeText(content);
      await vscode.window.showInformationMessage('Diagnostics report exported. This report is safe to share with support.');
      logger.info('Diagnostics copied to clipboard as JSON');
    } else if (choice.value === 'copy-markdown') {
      const content = formatAsMarkdown(report);
      await vscode.env.clipboard.writeText(content);
      await vscode.window.showInformationMessage('Diagnostics report exported. This report is safe to share with support.');
      logger.info('Diagnostics copied to clipboard as Markdown');
    }
  } catch (error) {
    logger.error('Failed to export diagnostics', error instanceof Error ? error : undefined);
    await vscode.window.showErrorMessage(`Failed to export diagnostics: ${error instanceof Error ? error.message : String(error)}`);
  }
}
