/**
 * Plan applier for executing configuration steps.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Plan, PlanStep } from './planBuilder';
import { createBackup, safeWriteFile } from '../../util/fsSafe';
import { getOutputChannel } from '../../ui/output';
import { Logger } from '../../util/log';
import { ChangeLog, AppliedStep, ChangeLogEntry } from './changeLog';

/**
 * Result of applying a plan.
 */
export interface ApplierResult {
  success: boolean;
  appliedSteps: PlanStep[];
  failedSteps: PlanStep[];
  changeLogEntry: ChangeLogEntry;
  /** Per-assistant outcome summary for graceful degradation reporting. */
  assistantResults: Map<string, { success: boolean; reason?: string }>;
}

/**
 * Applies configuration plan steps to the system.
 */
export class PlanApplier {
  private logger: Logger;
  private changeLog: ChangeLog;

  constructor(private context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
    this.changeLog = new ChangeLog(context);
  }

  /**
   * Applies a complete plan with graceful per-assistant degradation.
   *
   * Steps are grouped by `assistantKey`. Each assistant's steps are applied as
   * an atomic unit — if any step in the group fails the group is rolled back,
   * but other assistants are still attempted. This ensures that a single broken
   * assistant does not prevent successfully-configured ones from taking effect.
   *
   * @param plan The plan to apply
   * @param profileName The profile name for change log
   * @returns Promise resolving to applier result
   */
  async applyPlan(plan: Plan, profileName: string): Promise<ApplierResult> {
    const allAppliedSteps: PlanStep[] = [];
    const allFailedSteps: PlanStep[] = [];
    const allChangeLogEntries: ChangeLogEntry[] = [];
    const assistantResults = new Map<string, { success: boolean; reason?: string }>();

    this.logger.info(`Applying plan ${plan.id} with ${plan.steps.length} steps across ${plan.assistantKeys.length} assistant(s)`);

    // Group steps by assistantKey for independent application
    const stepsByAssistant = new Map<string, PlanStep[]>();
    for (const step of plan.steps) {
      const key = step.assistantKey || 'unknown';
      if (!stepsByAssistant.has(key)) {
        stepsByAssistant.set(key, []);
      }
      stepsByAssistant.get(key)!.push(step);
    }

    for (const [assistantKey, steps] of stepsByAssistant) {
      const appliedChangeSteps: AppliedStep[] = [];
      let assistantFailed = false;
      let failReason: string | undefined;

      this.logger.info(`[Applier] Applying ${steps.length} step(s) for assistant "${assistantKey}"`);

      for (const step of steps) {
        try {
          const appliedStep = await this.applyStep(step);
          appliedChangeSteps.push(appliedStep);
          allAppliedSteps.push({ ...step, completed: true });
          this.logger.info(`[Applier] Step ${step.id} applied successfully`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.logger.error(
            `[Applier] Step ${step.id} failed for "${assistantKey}": ${errorMsg}`,
            error instanceof Error ? error : undefined
          );
          allFailedSteps.push({ ...step, completed: false, error: errorMsg });
          assistantFailed = true;
          failReason = errorMsg;

          // Roll back only this assistant's steps so other assistants are unaffected
          this.logger.warning(`[Applier] Rolling back ${appliedChangeSteps.length} step(s) for "${assistantKey}" due to failure`);
          await this.rollbackSteps(appliedChangeSteps);
          this.logger.info(`[Applier] Rollback completed for "${assistantKey}"`);
          break;
        }
      }

      if (!assistantFailed && appliedChangeSteps.length > 0) {
        const entry: ChangeLogEntry = {
          id: `${plan.id}-${assistantKey}`,
          timestamp: new Date().toISOString(),
          assistantKey,
          profileName,
          steps: appliedChangeSteps
        };
        await this.changeLog.recordApply(entry);
        allChangeLogEntries.push(entry);
        assistantResults.set(assistantKey, { success: true });
        this.logger.info(`[Applier] Assistant "${assistantKey}" configured successfully`);
      } else if (assistantFailed) {
        assistantResults.set(assistantKey, { success: false, reason: failReason });
      }
    }

    const success = allFailedSteps.length === 0;
    this.logger.info(
      `[Applier] Plan ${plan.id} ${success ? 'completed' : 'partially failed'}: ` +
      `${allAppliedSteps.length} step(s) applied, ${allFailedSteps.length} failed`
    );

    // Build a composite change log entry for API compatibility
    const compositeEntry: ChangeLogEntry = allChangeLogEntries[0] ?? {
      id: plan.id,
      timestamp: new Date().toISOString(),
      assistantKey: plan.assistantKeys[0] || 'unknown',
      profileName,
      steps: []
    };

    return {
      success,
      appliedSteps: allAppliedSteps,
      failedSteps: allFailedSteps,
      changeLogEntry: compositeEntry,
      assistantResults
    };
  }

  /**
   * Applies a single plan step.
   * @param step The step to apply
   * @returns Promise resolving to applied step
   */
  async applyStep(step: PlanStep): Promise<AppliedStep> {
    this.logger.debug(`Applying step ${step.id}: ${step.action}`);

    const appliedStep: AppliedStep = {
      type: step.action,
      target: step.targetPath || '',
      oldValue: step.oldValue,
      newValue: step.newValue,
      timestamp: new Date().toISOString()
    };

    switch (step.action) {
      case 'set-vscode-setting':
        await this.applyVSCodeSetting(step, appliedStep);
        break;
      
      case 'edit-config-file':
        await this.applyConfigFileEdit(step, appliedStep);
        break;
      
      case 'set-env-var':
        await this.applyEnvVar(step, appliedStep);
        break;
      
      case 'show-guided-steps':
        await this.applyGuidedSteps(step, appliedStep);
        break;
      
      case 'backup-file':
        await this.applyBackup(step, appliedStep);
        break;
      
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }

    return appliedStep;
  }

  /**
   * Applies a VS Code setting change.
   */
  private async applyVSCodeSetting(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for set-vscode-setting');
    }

    const config = vscode.workspace.getConfiguration();
    const currentValue = config.get(step.targetPath);
    
    // Store old value for rollback
    appliedStep.oldValue = currentValue;

    // Determine scope (user or workspace)
    const scope = step.data.scope === 'workspace' 
      ? vscode.ConfigurationTarget.Workspace 
      : vscode.ConfigurationTarget.Global;

    await config.update(step.targetPath, step.newValue, scope);
    
    this.logger.info(`Updated setting ${step.targetPath} to ${JSON.stringify(step.newValue)}`);
  }

  /**
   * Applies a configuration file edit.
   */
  private async applyConfigFileEdit(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for edit-config-file');
    }

    // Create backup first if file exists
    try {
      await fs.access(step.targetPath);
      const backupPath = await createBackup(step.targetPath);
      if (backupPath) {
        appliedStep.backupPath = backupPath;
        this.logger.info(`Created backup at ${backupPath}`);
      } else {
        this.logger.warning(`Failed to create backup for ${step.targetPath}`);
      }
    } catch {
      // File doesn't exist, no backup needed
    }

    // Write new content
    const content = typeof step.newValue === 'string' 
      ? step.newValue 
      : JSON.stringify(step.newValue, null, 2);

    const success = await safeWriteFile(step.targetPath, content);
    if (!success) {
      throw new Error(`Failed to write to ${step.targetPath}`);
    }

    this.logger.info(`Updated config file ${step.targetPath}`);
  }

  /**
   * Applies environment variable instruction.
   */
  private async applyEnvVar(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    const varName = step.targetPath;
    const varValue = step.newValue;

    if (!varName || !varValue) {
      throw new Error('targetPath (var name) and newValue are required for set-env-var');
    }

    // Environment variables can't be set programmatically for existing processes
    // Show instruction and provide copy-to-clipboard option
    const message = `To set environment variable:\nexport ${varName}="${varValue}"`;
    
    const output = getOutputChannel();
    output.appendLine('');
    output.appendLine('=== Environment Variable Setup Required ===');
    output.appendLine(message);
    output.appendLine('');
    output.appendLine(`Note: You'll need to restart VS Code after setting this environment variable.`);
    output.appendLine('');
    output.show();

    // Offer to copy to clipboard
    const action = await vscode.window.showInformationMessage(
      `Environment variable ${varName} needs to be set manually. Copy command to clipboard?`,
      'Copy',
      'Skip'
    );

    if (action === 'Copy') {
      await vscode.env.clipboard.writeText(`export ${varName}="${varValue}"`);
      vscode.window.showInformationMessage('Command copied to clipboard!');
    }

    this.logger.info(`Displayed env var instruction for ${varName}`);
  }

  /**
   * Applies guided steps display.
   */
  private async applyGuidedSteps(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    const steps = step.data.steps;
    if (!Array.isArray(steps)) {
      throw new Error('steps array is required for show-guided-steps');
    }

    const output = getOutputChannel();
    output.appendLine('');
    output.appendLine('=== Manual Configuration Steps ===');
    output.appendLine(`Assistant: ${step.assistantKey}`);
    output.appendLine('');
    
    steps.forEach((stepText, index) => {
      output.appendLine(`${index + 1}. ${stepText}`);
    });
    
    output.appendLine('');
    output.show();

    this.logger.info(`Displayed ${steps.length} guided steps for ${step.assistantKey}`);
  }

  /**
   * Applies file backup.
   */
  private async applyBackup(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for backup-file');
    }

    const backupPath = await createBackup(step.targetPath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${step.targetPath}`);
    }

    appliedStep.backupPath = backupPath;
    this.logger.info(`Created backup at ${backupPath}`);
  }

  /**
   * Rolls back a list of applied steps (for automatic rollback on failure).
   */
  private async rollbackSteps(steps: AppliedStep[]): Promise<void> {
    // Reverse steps in reverse order
    for (let i = steps.length - 1; i >= 0; i--) {
      try {
        await this.reverseStep(steps[i]);
      } catch (error) {
        this.logger.error(`Failed to rollback step: ${error instanceof Error ? error.message : String(error)}`);
        
        // Show user-friendly error for manual recovery
        const step = steps[i];
        let recoveryMessage = `Failed to automatically rollback: ${step.type} on ${step.target}\n`;
        
        if (step.backupPath) {
          recoveryMessage += `\nManual recovery steps:\n`;
          recoveryMessage += `1. Locate backup file: ${step.backupPath}\n`;
          recoveryMessage += `2. Restore to: ${step.target}\n`;
          recoveryMessage += `3. Command: cp "${step.backupPath}" "${step.target}"`;
        } else if (step.oldValue !== undefined) {
          recoveryMessage += `\nManual recovery: Set ${step.target} back to: ${JSON.stringify(step.oldValue)}`;
        } else {
          recoveryMessage += `\nNo backup available. You may need to manually restore the original configuration.`;
        }
        
        this.logger.error(recoveryMessage);
        vscode.window.showErrorMessage('Rollback failed. Check Output panel for manual recovery instructions.', 'Open Output').then(action => {
          if (action === 'Open Output') {
            getOutputChannel().show();
          }
        });
      }
    }
  }

  /**
   * Reverses applied steps using a plan ID.
   * @param planId The plan ID to reverse
   */
  async rollbackPlan(planId: string): Promise<void> {
    this.logger.info(`Rolling back plan ${planId}`);

    // Get all change log entries for this plan ID
    const allEntries = await this.changeLog.getEntries();
    const planEntry = allEntries.find(e => e.id === planId);
    
    if (!planEntry) {
      throw new Error(`No change log found for plan ${planId}`);
    }

    // Reverse steps in reverse order
    for (let i = planEntry.steps.length - 1; i >= 0; i--) {
      const step = planEntry.steps[i];
      await this.reverseStep(step);
    }

    // Remove the change log entry
    await this.changeLog.removeEntry(planId);

    this.logger.info(`Plan ${planId} rolled back successfully`);
  }

  /**
   * Reverses a single step using an applied step.
   */
  private async reverseStep(step: AppliedStep): Promise<void> {
    this.logger.debug(`Reversing step of type: ${step.type}`);

    switch (step.type) {
      case 'set-vscode-setting':
        if (step.target) {
          const config = vscode.workspace.getConfiguration();
          await config.update(step.target, step.oldValue, vscode.ConfigurationTarget.Global);
          this.logger.info(`Reverted setting ${step.target}`);
        }
        break;
      
      case 'edit-config-file':
        // Restoration from backup if available
        if (step.backupPath) {
          try {
            const backupContent = await fs.readFile(step.backupPath, 'utf-8');
            await safeWriteFile(step.target, backupContent);
            this.logger.info(`Restored file from backup: ${step.backupPath}`);
          } catch (error) {
            this.logger.warning(`Could not restore from backup: ${error}`);
            // Fallback to oldValue if available
            if (step.oldValue && typeof step.oldValue === 'string') {
              await safeWriteFile(step.target, step.oldValue);
              this.logger.info(`Restored file from oldValue`);
            }
          }
        } else if (step.oldValue && typeof step.oldValue === 'string') {
          await safeWriteFile(step.target, step.oldValue);
          this.logger.info(`Restored file from oldValue`);
        }
        break;
      
      case 'set-env-var':
      case 'show-guided-steps':
      case 'backup-file':
      case 'verify-endpoint':
        // These actions don't need reversal
        break;
    }
  }
}
