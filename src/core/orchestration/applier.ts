/**
 * Plan applier for executing configuration steps.
 */

import * as vscode from 'vscode';
import { Plan, PlanStep } from './planBuilder';
import { createBackup, safeWriteFile, fileExists } from '../../util/fsSafe';
import { getOutputChannel } from '../../ui/output';
import { Logger } from '../../util/log';

/**
 * Change log entry for tracking applied changes.
 */
export interface ChangeLogEntry {
  stepId: string;
  action: string;
  targetPath?: string;
  oldValue?: unknown;
  newValue?: unknown;
  timestamp: string;
  backupPath?: string;
}

/**
 * Change log for tracking all applied changes.
 */
export interface ChangeLog {
  planId: string;
  entries: ChangeLogEntry[];
}

/**
 * Result of applying a plan.
 */
export interface ApplierResult {
  success: boolean;
  appliedSteps: PlanStep[];
  failedSteps: PlanStep[];
  changeLog: ChangeLog;
}

const CHANGE_LOG_KEY = 'aidome.switchboard.changelog';

/**
 * Applies configuration plan steps to the system.
 */
export class PlanApplier {
  private logger: Logger;

  constructor(private context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
  }

  /**
   * Applies a complete plan.
   * @param plan The plan to apply
   * @returns Promise resolving to applier result
   */
  async applyPlan(plan: Plan): Promise<ApplierResult> {
    const appliedSteps: PlanStep[] = [];
    const failedSteps: PlanStep[] = [];
    const changeLog: ChangeLog = {
      planId: plan.id,
      entries: []
    };

    this.logger.info(`Applying plan ${plan.id} with ${plan.steps.length} steps`);

    for (const step of plan.steps) {
      try {
        const entry = await this.applyStep(step);
        changeLog.entries.push(entry);
        appliedSteps.push({ ...step, completed: true });
        this.logger.info(`Step ${step.id} applied successfully`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Step ${step.id} failed: ${errorMsg}`);
        failedSteps.push({ ...step, completed: false, error: errorMsg });
        
        // Stop on first error
        break;
      }
    }

    // Store change log in globalState
    await this.saveChangeLog(changeLog);

    const success = failedSteps.length === 0;
    this.logger.info(`Plan ${plan.id} ${success ? 'completed' : 'failed'}: ${appliedSteps.length} applied, ${failedSteps.length} failed`);

    return {
      success,
      appliedSteps,
      failedSteps,
      changeLog
    };
  }

  /**
   * Applies a single plan step.
   * @param step The step to apply
   * @returns Promise resolving to change log entry
   */
  async applyStep(step: PlanStep): Promise<ChangeLogEntry> {
    this.logger.debug(`Applying step ${step.id}: ${step.action}`);

    const entry: ChangeLogEntry = {
      stepId: step.id,
      action: step.action,
      targetPath: step.targetPath,
      oldValue: step.oldValue,
      newValue: step.newValue,
      timestamp: new Date().toISOString()
    };

    switch (step.action) {
      case 'set-vscode-setting':
        await this.applyVSCodeSetting(step, entry);
        break;
      
      case 'edit-config-file':
        await this.applyConfigFileEdit(step, entry);
        break;
      
      case 'set-env-var':
        await this.applyEnvVar(step, entry);
        break;
      
      case 'show-guided-steps':
        await this.applyGuidedSteps(step, entry);
        break;
      
      case 'backup-file':
        await this.applyBackup(step, entry);
        break;
      
      default:
        throw new Error(`Unknown action: ${step.action}`);
    }

    return entry;
  }

  /**
   * Applies a VS Code setting change.
   */
  private async applyVSCodeSetting(step: PlanStep, entry: ChangeLogEntry): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for set-vscode-setting');
    }

    const config = vscode.workspace.getConfiguration();
    const currentValue = config.get(step.targetPath);
    
    // Store old value for rollback
    entry.oldValue = currentValue;

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
  private async applyConfigFileEdit(step: PlanStep, entry: ChangeLogEntry): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for edit-config-file');
    }

    // Create backup first
    if (await fileExists(step.targetPath)) {
      const backupPath = await createBackup(step.targetPath);
      if (backupPath) {
        entry.backupPath = backupPath;
        this.logger.info(`Created backup at ${backupPath}`);
      } else {
        this.logger.warning(`Failed to create backup for ${step.targetPath}`);
      }
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
  private async applyEnvVar(step: PlanStep, entry: ChangeLogEntry): Promise<void> {
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
  private async applyGuidedSteps(step: PlanStep, entry: ChangeLogEntry): Promise<void> {
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
  private async applyBackup(step: PlanStep, entry: ChangeLogEntry): Promise<void> {
    if (!step.targetPath) {
      throw new Error('targetPath is required for backup-file');
    }

    const backupPath = await createBackup(step.targetPath);
    if (!backupPath) {
      throw new Error(`Failed to create backup of ${step.targetPath}`);
    }

    entry.backupPath = backupPath;
    this.logger.info(`Created backup at ${backupPath}`);
  }

  /**
   * Reverses applied steps using a plan.
   * @param plan The plan to reverse
   */
  async rollbackPlan(plan: Plan): Promise<void> {
    this.logger.info(`Rolling back plan ${plan.id}`);

    // Get change log
    const changeLog = await this.getChangeLog(plan.id);
    if (!changeLog) {
      throw new Error(`No change log found for plan ${plan.id}`);
    }

    // Reverse steps in reverse order
    for (let i = changeLog.entries.length - 1; i >= 0; i--) {
      const entry = changeLog.entries[i];
      await this.reverseStep(entry);
    }

    this.logger.info(`Plan ${plan.id} rolled back successfully`);
  }

  /**
   * Reverses a single step using its change log entry.
   */
  private async reverseStep(entry: ChangeLogEntry): Promise<void> {
    this.logger.debug(`Reversing step ${entry.stepId}: ${entry.action}`);

    switch (entry.action) {
      case 'set-vscode-setting':
        if (entry.targetPath) {
          const config = vscode.workspace.getConfiguration();
          await config.update(entry.targetPath, entry.oldValue, vscode.ConfigurationTarget.Global);
          this.logger.info(`Reverted setting ${entry.targetPath}`);
        }
        break;
      
      case 'edit-config-file':
        // Restoration from backup would need to be implemented
        // For now, just log
        this.logger.info(`Config file rollback requires manual restoration from backup: ${entry.backupPath}`);
        break;
      
      case 'set-env-var':
      case 'show-guided-steps':
      case 'backup-file':
        // These actions don't need reversal
        break;
    }
  }

  /**
   * Saves change log to global state.
   */
  private async saveChangeLog(changeLog: ChangeLog): Promise<void> {
    const allLogs = this.context.globalState.get<ChangeLog[]>(CHANGE_LOG_KEY, []);
    allLogs.push(changeLog);
    await this.context.globalState.update(CHANGE_LOG_KEY, allLogs);
  }

  /**
   * Gets change log for a plan.
   */
  private async getChangeLog(planId: string): Promise<ChangeLog | undefined> {
    const allLogs = this.context.globalState.get<ChangeLog[]>(CHANGE_LOG_KEY, []);
    return allLogs.find(log => log.planId === planId);
  }
}
