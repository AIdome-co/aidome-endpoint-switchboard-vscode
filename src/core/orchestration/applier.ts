/**
 * Plan applier for executing configuration steps.
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { Plan, PlanStep } from './planBuilder';
import { createBackup, safeWriteFile, isFileNotFoundError } from '../../util/fsSafe';
import { getOutputChannel } from '../../ui/output';
import { showWarning } from '../../ui/notifications';
import { Logger } from '../../util/log';
import { ChangeLog, AppliedStep, ChangeLogEntry } from './changeLog';
import { ProfileSecrets } from '../profiles/profileSecrets';
import { renderConfigFileContent } from '../providerConfig/drivers';
import { validateConfigFileStepData, validateSetEnvVarStepData, validateWriteEnvFileStepData, hasConfigMetadata } from './planStepData';
import { type AssistantApplyResult, assistantResult, isConfigurationMutationAction } from './assistantOutcome';
import { patchEnvFile, parseDotEnv } from '../providerConfig/envFileDriver';

/**
 * Result of applying a plan.
 */
export interface ApplierResult {
  success: boolean;
  appliedSteps: PlanStep[];
  failedSteps: PlanStep[];
  changeLogEntry: ChangeLogEntry;
  /** Per-assistant outcome summary for graceful degradation reporting. */
  assistantResults: Map<string, AssistantApplyResult>;
}

/**
 * Applies configuration plan steps to the system.
 */
export class PlanApplier {
  private logger: Logger;
  private changeLog: ChangeLog;
  private profileSecrets: ProfileSecrets;

  constructor(private context: vscode.ExtensionContext) {
    this.logger = Logger.getInstance();
    this.changeLog = new ChangeLog(context);
    this.profileSecrets = new ProfileSecrets(context);
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
    const assistantResults = new Map<string, AssistantApplyResult>();

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
        // GAP 1/2/10: executing steps is NOT the same as configuring the
        // assistant. Only a real automatic configuration mutation makes the
        // assistant configured; an assistant whose steps were purely
        // informational/guidance is guided-required (or unsupported when the
        // guidance explicitly declares it). Optional guidance shown AFTER a
        // successful mutation does not downgrade the outcome.
        // A mutation is real only when the action classifies as one AND the
        // write actually happened (skipped no-ops are not mutations).
        const mutationSteps = appliedChangeSteps.filter(step =>
          isConfigurationMutationAction(step.type) && step.mutationApplied !== false);
        // GAP 10: a REQUIRED (non-optional) guided step after partial
        // automatic configuration means user action is still needed for the
        // assistant to be usable — guided-required, even though the mutation
        // itself succeeded.
        const requiredGuidance = steps.find(step =>
          step.action === 'show-guided-steps' && step.data.optional !== true);
        if (mutationSteps.length > 0 && requiredGuidance) {
          // GAP 9: a mutation step that needed a required secret but found
          // none (the step returned early with guidance) must not report
          // configured — required authentication is still incomplete.
          assistantResults.set(assistantKey, assistantResult(
            'guided-required',
            requiredGuidance.data.message as string | undefined
          ));
          this.logger.warning(`[Applier] Assistant "${assistantKey}" is guided-required: required manual follow-up remains`);
        } else if (mutationSteps.length > 0) {
          // GAP 9: authentication is incomplete when the required credential
          // was not available — whether the env write was skipped entirely
          // (no-op) or left stale state in place. A confirmed no-op with no
          // credential available also leaves auth incomplete: guided-required.
          const credentialGap = appliedChangeSteps.find(step =>
            step.type === 'write-env-file'
            && (step as { secretResolved?: boolean }).secretResolved === false);
          if (credentialGap) {
            assistantResults.set(assistantKey, assistantResult(
              'guided-required',
              'No saved profile credential was found — the configuration was applied but authentication remains incomplete'
            ));
            this.logger.warning(`[Applier] Assistant "${assistantKey}" is guided-required: the required credential is missing`);
          } else {
            assistantResults.set(assistantKey, assistantResult('configured'));
            this.logger.info(`[Applier] Assistant "${assistantKey}" configured successfully`);
          }
        } else {
          // No mutation executed: check whether any guidance step declares
          // the assistant unsupported (Roo/Tabnine-style informational plans).
          // Unsupported is declared explicitly via typed metadata — never
          // inferred from free-form limitation text.
          const unsupportedStep = steps.find(step =>
            step.action === 'show-guided-steps' && step.data.configurationStatus === 'unsupported');
          if (unsupportedStep) {
            assistantResults.set(assistantKey, assistantResult('unsupported', unsupportedStep.data.message as string | undefined));
            this.logger.info(`[Applier] Assistant "${assistantKey}" is unsupported (guidance only)`);
          } else if (steps.some(step => step.action === 'show-guided-steps')) {
            const reason = steps.find(step => step.action === 'show-guided-steps')?.data.message as string | undefined;
            assistantResults.set(assistantKey, assistantResult('guided-required', reason));
            this.logger.info(`[Applier] Assistant "${assistantKey}" executed guidance-only steps — guided-required, NOT configured`);
          } else {
            // GAP 9: a confirmed no-op write-env-file (credential missing)
            // leaves authentication incomplete — that is guided-required
            // (the user must supply a credential), NOT deferred, even
            // though no file was touched.
            const noOpCredentialGap = appliedChangeSteps.find(step =>
              step.type === 'write-env-file'
              && step.mutationApplied === false
              && (step as { secretResolved?: boolean }).secretResolved === false);
            // P1: no break/continue here — classify THIS assistant and let
            // the outer per-assistant loop proceed to the next one. A
            // `break` here exited the entire multi-assistant loop, silently
            // skipping every later assistant while plan success stayed true.
            if (noOpCredentialGap) {
              assistantResults.set(assistantKey, assistantResult(
                'guided-required',
                'No saved profile credential was found — set the credential in the profile and reapply, or export it in the environment that launches the assistant'
              ));
              this.logger.warning(`[Applier] Assistant "${assistantKey}" is guided-required: no credential available and none was written`);
            } else {
              // GAP 3: nothing mutated and there are no manual instructions to
              // follow — the operation is intentionally incomplete, NOT guided.
              assistantResults.set(assistantKey, assistantResult('deferred', 'No configuration mutation was applied and no manual instructions are available'));
              this.logger.info(`[Applier] Assistant "${assistantKey}" applied no mutation and has no guidance — deferred, NOT configured`);
            }
          }
        }
      } else if (assistantFailed) {
        assistantResults.set(assistantKey, assistantResult('failed', failReason));
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

    // Fail closed on invalid step payloads BEFORE any mutation: malformed
    // driver declarations and invalid combinations are rejected here with an
    // actionable error instead of surfacing deep inside a driver.
    if (step.action === 'edit-config-file') {
      const validation = validateConfigFileStepData(step.data);
      if (!validation.ok) {
        throw new Error(`Step ${step.id} has an invalid payload: ${validation.error}`);
      }
    } else if (step.action === 'set-env-var') {
      const validation = validateSetEnvVarStepData(step.data);
      if (!validation.ok) {
        throw new Error(`Step ${step.id} has an invalid payload: ${validation.error}`);
      }
    } else if (step.action === 'write-env-file') {
      const validation = validateWriteEnvFileStepData(step.data);
      if (!validation.ok) {
        throw new Error(`Step ${step.id} has an invalid payload: ${validation.error}`);
      }
    }

    const appliedStep: AppliedStep = {
      type: step.action,
      target: step.targetPath || '',
      oldValue: step.oldValue,
      newValue: step.action === 'edit-config-file'
        ? '[redacted config-file content]'
        : step.newValue,
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
      
      case 'write-env-file':
        await this.applyWriteEnvFile(step, appliedStep);
        break;
      
      case 'show-guided-steps':
        await this.applyGuidedSteps(step, appliedStep);
        break;
      
      case 'backup-file':
        await this.applyBackup(step, appliedStep);
        break;

      case 'verify-endpoint':
        await this.applyVerifyEndpoint(step);
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

    try {
      await config.update(step.targetPath, step.newValue, scope);
      appliedStep.mutationApplied = true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('is not a registered configuration')) {
        // Intentional no-op: nothing was written, so this step must NOT
        // count as a configuration mutation downstream.
        appliedStep.mutationApplied = false;
        this.logger.warning(
          `Skipped unregistered setting "${step.targetPath}" — ` +
          `the target extension may not be installed on this machine`
        );
        return;
      }
      throw error;
    }
    
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
    let fileExists = true;
    try {
      await fs.access(step.targetPath);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
      fileExists = false;
      appliedStep.createdFile = true;
    }

    if (fileExists) {
      const backupPath = await createBackup(step.targetPath);
      if (!backupPath) {
        throw new Error(`Failed to create backup for ${step.targetPath}`);
      }
      appliedStep.backupPath = backupPath;
      this.logger.info(`Created backup at ${backupPath}`);
    }

    // Write new content
    const content = await this.resolveConfigFileContent(step, fileExists);

    const success = await safeWriteFile(step.targetPath, content);
    if (!success) {
      throw new Error(`Failed to write to ${step.targetPath}`);
    }
    appliedStep.mutationApplied = true;

    this.logger.info(`Updated config file ${step.targetPath}`);
  }

  private async resolveConfigFileContent(step: PlanStep, fileExists: boolean): Promise<string> {
    const existingContent = fileExists
      ? await fs.readFile(step.targetPath!, 'utf-8')
      : undefined;

    const driver = step.data?.driver;
    if (typeof driver !== 'string') {
      // Fail closed: a driver-less payload that still declares config
      // metadata must never fall through to the verbatim raw-value write —
      // that is how ~/.codex/config.toml once became the bare base URL.
      if (hasConfigMetadata(step.data)) {
        throw new Error(
          `Configuration file step for ${step.targetPath} declares step data without a driver; ` +
          'refusing to write the raw value verbatim. Declare a typed driver instead.'
        );
      }
      return typeof step.newValue === 'string'
        ? step.newValue
        : JSON.stringify(step.newValue, null, 2);
    }

    const baseUrl = typeof step.data.baseUrl === 'string'
      ? step.data.baseUrl
      : typeof step.newValue === 'string'
        ? step.newValue
        : undefined;
    if (!baseUrl) {
      throw new Error(`Configuration driver ${driver} requires a baseUrl`);
    }

    const authRef = typeof step.data.authRef === 'string' && step.data.authRef.trim().length > 0
      ? step.data.authRef.trim()
      : undefined;
    const secretPolicy = step.data.secretPolicy;
    const secret = secretPolicy === 'target-persisted-at-apply' && authRef
      ? await this.profileSecrets.getSecret(authRef)
      : undefined;

    if (secretPolicy === 'target-persisted-at-apply' && !secret && step.data.clearAuthWhenMissing === true) {
      const warningMessage = typeof step.data.missingSecretMessage === 'string' && step.data.missingSecretMessage.trim().length > 0
        ? step.data.missingSecretMessage
        : `Configuration credential was cleared for "${typeof step.data.profileName === 'string' ? step.data.profileName : 'the active profile'}" because no saved profile secret was found.`;
      void showWarning(
        warningMessage
      );
    }

    return renderConfigFileContent({
      baseUrl,
      existingContent,
      format: typeof step.data.format === 'string' ? step.data.format as 'json' | 'jsonc' | 'yaml' | 'toml' : undefined,
      options: step.data,
      secret
    });
  }

  /**
   * Applies a non-mutating endpoint verification marker.
   *
   * @param step Verification step to acknowledge
   * @returns Promise that always resolves after logging the deferred verification
   *
   * This is intentionally a no-op: endpoint verification is deferred to the
   * dedicated verifier command path so transactional config writes are not
   * failed after they have already committed.
   */
  private async applyVerifyEndpoint(step: PlanStep): Promise<void> {
    this.logger.info(
      `[Applier] Deferred endpoint verification for "${step.assistantKey}" to the verifier command path`
    );
  }

  /**
   * Persists provider credential environment variables into the target's
   * dotenv file (e.g. Codex ~/.codex/.env, loaded by upstream `load_dotenv`).
   *
   * The secret is resolved from SecretStorage ONLY here, immediately before
   * the write, and never appears in the plan, logs, or change history.
   * Backup-before-modify + atomic write + unrelated variables preserved.
   */
  private async applyWriteEnvFile(step: PlanStep, appliedStep: AppliedStep): Promise<void> {
    const targetPath = step.targetPath;
    const envVarName = typeof step.data.envVarName === 'string' ? step.data.envVarName : undefined;
    if (!targetPath || !envVarName) {
      throw new Error('targetPath and data.envVarName are required for write-env-file');
    }

    let fileExists = true;
    try {
      await fs.access(targetPath);
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }
      fileExists = false;
      // createdFile is set ONLY when a write below actually creates the
      // file — a missing-credential early return must not claim one.
    }

    const authRef = typeof step.data.authRef === 'string' && step.data.authRef.trim().length > 0
      ? step.data.authRef.trim()
      : undefined;
    const secret = authRef ? await this.profileSecrets.getSecret(authRef) : undefined;
    if (secret === undefined || secret.trim().length === 0) {
      appliedStep.secretResolved = false;
      appliedStep.mutationApplied = false; // truthful until a real write below
      // No saved credential: endpoint config stays applied, auth remains
      // guided. Behavior toward a possibly stale managed key is declared by
      // the step (never inferred from a provider name).
      const missingBehavior = typeof step.data.missingSecretBehavior === 'string'
        ? step.data.missingSecretBehavior
        : 'preserve';
      if (missingBehavior === 'fail') {
        throw new Error(
          `No saved profile credential for "${typeof step.data.profileName === 'string' ? step.data.profileName : authRef ?? 'the profile'}" and missingSecretBehavior is "fail" — ${envVarName} was not written to ${targetPath}`
        );
      }
      if (missingBehavior === 'remove-managed-key' && fileExists) {
        // Remove ONLY the managed key so a previous profile's credential can
        // never survive a profile switch; unrelated variables and comments
        // are preserved. Removing a key that does not exist is a no-op.
        const existingContent = await fs.readFile(targetPath, 'utf-8').catch(() => undefined);
        const existingKeys = existingContent !== undefined
          ? Object.keys(parseDotEnv(existingContent))
          : [];
        if (existingKeys.includes(envVarName)) {
          const backupPath = await patchEnvFile(
            targetPath,
            {},
            { fileLabel: 'env file', removeKeys: [envVarName] }
          );
          appliedStep.backupPath = backupPath;
          appliedStep.managedValueRemoved = true;
          // The target state changed: this IS a real mutation (rollbackable).
          appliedStep.mutationApplied = true;
          this.logger.info(
            `Removed stale managed key ${envVarName} from ${targetPath} (no saved profile credential for the newly applied profile)`
          );
        } else {
          // Key absent, nothing written: a confirmed no-op.
          appliedStep.mutationApplied = false;
          this.logger.info(`${envVarName} not present in ${targetPath} — nothing to remove`);
        }
      }
      // Truthful guidance either way: authentication is incomplete.
      this.logger.warning(
        `No saved profile credential for "${typeof step.data.profileName === 'string' ? step.data.profileName : authRef ?? 'the profile'}" — ${envVarName} was not written to ${targetPath}. ` +
        'Set the credential in the profile and reapply, or export it in the environment that launches the assistant.'
      );
      return;
    }

    const backupPath = await patchEnvFile(targetPath, { [envVarName]: secret }, { fileLabel: 'env file' });
    appliedStep.backupPath = backupPath;
    appliedStep.secretResolved = true;
    appliedStep.mutationApplied = true;
    if (!fileExists) {
      // The write above created the file — NOW it is truthful to claim it.
      appliedStep.createdFile = true;
    }
    this.logger.info(`Updated ${envVarName} in ${targetPath}`);
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
  private async applyGuidedSteps(step: PlanStep, _appliedStep: AppliedStep): Promise<void> {
    const output = getOutputChannel();
    const isOptional = step.data.optional === true;
    output.appendLine('');
    output.appendLine(isOptional ? '=== Configuration Notes ===' : '=== Manual Configuration Steps ===');
    output.appendLine(`Assistant: ${step.assistantKey}`);
    output.appendLine('');

    const steps = step.data.steps;
    if (Array.isArray(steps)) {
      steps.forEach((stepText, index) => {
        output.appendLine(`${index + 1}. ${stepText}`);
      });
      this.logger.info(`Displayed ${steps.length} guided steps for ${step.assistantKey}`);
    } else {
      const message = typeof step.data.message === 'string'
        ? step.data.message
        : `Manual configuration required for ${step.assistantKey}`;
      output.appendLine(message);
      this.logger.info(`Displayed guided message for ${step.assistantKey}`);
    }

    output.appendLine('');
    output.show();
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
    // GAP 5: a configuration mutation that was intentionally skipped never
    // happened — reverting it would only trigger spurious errors. Legacy
    // steps (mutationApplied undefined) still roll back normally.
    if (isConfigurationMutationAction(step.type) && step.mutationApplied === false) {
      this.logger.debug(`Skipping rollback of ${step.type} on ${step.target}: the step was a no-op (nothing was applied)`);
      return;
    }

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
        } else if (step.createdFile) {
          try {
            await fs.unlink(step.target);
            this.logger.info(`Removed newly created config file ${step.target}`);
          } catch (error) {
            if (!isFileNotFoundError(error)) {
              throw error;
            }
            this.logger.info(`Newly created config file already absent: ${step.target}`);
          }
        } else if (step.oldValue && typeof step.oldValue === 'string') {
          await safeWriteFile(step.target, step.oldValue);
          this.logger.info(`Restored file from oldValue`);
        }
        break;
      
      case 'write-env-file':
        if (step.backupPath) {
          try {
            const backupContent = await fs.readFile(step.backupPath, 'utf-8');
            await safeWriteFile(step.target, backupContent);
            this.logger.info(`Restored env file from backup: ${step.backupPath}`);
          } catch (error) {
            this.logger.warning(`Could not restore env file from backup: ${error}`);
          }
        } else if (step.createdFile && step.target) {
          try {
            await fs.unlink(step.target);
            this.logger.info(`Removed newly created env file ${step.target}`);
          } catch (error) {
            if (!isFileNotFoundError(error)) {
              throw error;
            }
          }
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
