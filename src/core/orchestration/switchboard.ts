/**
 * Main switchboard orchestrator.
 * Coordinates detection, planning, and application of endpoint configurations.
 */

import * as vscode from 'vscode';
import { AssistantRegistry } from '../registry/registryTypes';
import { EndpointProfile } from '../profiles/profileTypes';
import { ProfileStore } from '../profiles/profileStore';
import { ProfileSecrets } from '../profiles/profileSecrets';
import { Plan, createPlan, addStep, generateStepId } from './planBuilder';
import { PlanApplier, ApplierResult } from './applier';
import { Verifier, VerificationResult } from './verifier';
import { detectExtensions, DetectedAssistant } from '../detection/detectExtensions';
import { detectCLIs, DetectedCLI } from '../detection/detectCLIs';
import { getAdapter } from '../../adapters/adapters.index';
import { Logger } from '../../util/log';
import { startTimer } from '../../util/operationTimer';
import { withRetry } from '../../util/retry';

/**
 * Combined detection results.
 */
export interface DetectionResults {
  assistants: DetectedAssistant[];
  clis: DetectedCLI[];
}

/**
 * Switchboard orchestrator for managing endpoint routing configuration.
 */
export class Switchboard {
  private logger: Logger;
  private applier: PlanApplier;
  private verifier: Verifier;

  constructor(
    private context: vscode.ExtensionContext,
    private registry: AssistantRegistry,
    private profileStore: ProfileStore,
    private profileSecrets: ProfileSecrets
  ) {
    this.logger = Logger.getInstance();
    this.applier = new PlanApplier(context);
    this.verifier = new Verifier();
  }

  /**
   * Detects all installed assistants (extensions and CLIs).
   * @returns Promise resolving to detection results
   */
  async detectAll(): Promise<DetectionResults> {
    this.logger.info('Detecting installed assistants...');
    const timer = startTimer();

    // Detect extensions
    const assistants = detectExtensions(this.registry);
    this.logger.info(`Detected ${assistants.length} extension(s)`);

    // Detect CLIs with retry for transient process-spawn failures
    const clis = await withRetry(
      () => detectCLIs(this.registry),
      {
        maxAttempts: 2,
        baseDelayMs: 200,
        isRetryable: (e) => {
          // Retry on generic errors; don't retry on known non-transient cases
          const code = (e as NodeJS.ErrnoException).code;
          return code !== 'ENOENT';
        },
        onRetry: (attempt, maxAttempts, error, nextDelayMs) => {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warning(
            `CLI detection failed (attempt ${attempt}/${maxAttempts}), ` +
            `retrying in ${nextDelayMs}ms — ${msg}`
          );
        }
      }
    );
    this.logger.info(`Detected ${clis.length} CLI tool(s)`);

    this.logger.info(`Detection completed in ${timer.stop()}ms`);

    return {
      assistants,
      clis
    };
  }

  /**
   * Builds a configuration plan for a profile and specific assistants.
   * @param profile The profile to apply
   * @param assistantKeys Assistant keys to configure
   * @returns Promise resolving to the plan
   */
  async buildPlan(profile: EndpointProfile, assistantKeys: string[]): Promise<Plan> {
    this.logger.info(`Building plan for profile ${profile.name} with assistants: ${assistantKeys.join(', ')}`);
    const timer = startTimer();

    let plan = createPlan(profile.id, assistantKeys);

    for (const assistantKey of assistantKeys) {
      // Get adapter for this assistant
      const adapter = await getAdapter(assistantKey);
      
      if (!adapter) {
        this.logger.warning(`No adapter found for assistant: ${assistantKey}`);
        continue;
      }

      try {
        const buildContext = (assistantKey === 'claude-code' || assistantKey === 'continue')
          ? { authSecret: await this.resolveProfileAuthSecret(profile) }
          : undefined;

        // Build plan for this assistant
        const assistantPlan = await adapter.buildPlan(profile, buildContext);
        
        // Merge steps into main plan
        for (const step of assistantPlan.steps) {
          plan = addStep(plan, step);
        }
        
        this.logger.info(`Added ${assistantPlan.steps.length} step(s) for ${assistantKey}`);
      } catch (error) {
        this.logger.error(`Failed to build plan for ${assistantKey}`, error instanceof Error ? error : undefined);
        
        // Add a fallback guided step
        plan = addStep(plan, {
          action: 'show-guided-steps',
          description: `Manual configuration required for ${assistantKey}`,
          assistantKey,
          data: {
            steps: [
              `Adapter for ${assistantKey} encountered an error`,
              `Please configure manually or check logs for details`
            ]
          },
          reversible: false
        });
      }
    }

    this.logger.info(`Plan created with ${plan.steps.length} total steps in ${timer.stop()}ms`);
    return plan;
  }

  /**
   * Applies a configuration plan.
   * @param plan The plan to apply
   * @returns Promise resolving to applier result
   */
  async applyPlan(plan: Plan): Promise<ApplierResult> {
    this.logger.info(`Applying plan ${plan.id}`);
    const timer = startTimer();
    
    // Get profile name from profile ID
    const profiles = await this.profileStore.getProfiles();
    const profile = profiles.find(p => p.id === plan.profileId);
    const profileName = profile?.name || 'unknown';
    
    const result = await this.applier.applyPlan(plan, profileName);
    
    if (result.appliedSteps.length > 0) {
      this.logger.info(`Plan applied successfully in ${timer.stop()}ms`);
      
      // Update mappings in profile store
      for (const step of result.appliedSteps) {
        try {
          await this.profileStore.saveAssistantMapping({
            assistantKey: step.assistantKey,
            profileId: plan.profileId,
            profileName,
            appliedMode: this.getAppliedMode(step.action),
            appliedAt: new Date().toISOString()
          });
        } catch (error) {
          this.logger.error(`Failed to save mapping for ${step.assistantKey}`, error instanceof Error ? error : undefined);
        }
      }
    }

    if (!result.success) {
      this.logger.error(`Plan failed: ${result.failedSteps.length} step(s) failed`);
    }
    
    return result;
  }

  /**
   * Verifies all configured endpoints.
   * @returns Promise resolving to verification results by profile ID
   */
  async verifyAll(): Promise<Record<string, VerificationResult>> {
    this.logger.info('Verifying all configured endpoints');

    const profiles = await this.profileStore.getProfiles();
    const results: Record<string, VerificationResult> = {};

    for (const profile of profiles) {
      try {
        const authToken = await this.resolveProfileAuthSecret(profile);
        const result = await this.verifier.verifyEndpoint(profile, false, authToken);
        results[profile.id] = result;
        
        // Update last verified timestamp
        if (result.status === 'success') {
          profile.lastVerified = new Date().toISOString();
          await this.profileStore.saveProfile(profile);
        }
      } catch (error) {
        this.logger.error(`Verification failed for profile ${profile.name}`, error instanceof Error ? error : undefined);
        
        results[profile.id] = {
          status: 'failed',
          checks: [{
            name: 'verification',
            status: 'fail',
            message: error instanceof Error ? error.message : String(error)
          }],
          actionableMessage: `Verification error: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }

    return results;
  }

  /**
   * Verifies a single configured profile.
   * @param profileId The profile ID to verify
   * @returns Promise resolving to verification result for that profile
   */
  async verifyProfile(profileId: string): Promise<VerificationResult> {
    this.logger.info(`Verifying profile ${profileId}`);

    const profiles = await this.profileStore.getProfiles();
    const profile = profiles.find(item => item.id === profileId);

    if (!profile) {
      throw new Error(`Profile ${profileId} not found`);
    }

    const authToken = await this.resolveProfileAuthSecret(profile);
    const result = await this.verifier.verifyEndpoint(profile, false, authToken);

    if (result.status === 'success') {
      profile.lastVerified = new Date().toISOString();
      await this.profileStore.saveProfile(profile);
    }

    return result;
  }

  /**
   * Rolls back a configuration plan.
   * @param plan The plan to roll back
   */
  async rollbackPlan(plan: Plan): Promise<void> {
    this.logger.info(`Rolling back plan ${plan.id}`);
    await this.applier.rollbackPlan(plan.id);
    this.logger.info('Rollback complete');
  }

  /**
   * Determines applied mode from action type.
   */
  private getAppliedMode(action: string): 'settings' | 'configFile' | 'env' | 'guided' {
    switch (action) {
      case 'set-vscode-setting':
        return 'settings';
      case 'edit-config-file':
        return 'configFile';
      case 'set-env-var':
        return 'env';
      case 'show-guided-steps':
        return 'guided';
      default:
        return 'settings';
    }
  }

  private async resolveProfileAuthSecret(profile: EndpointProfile): Promise<string | undefined> {
    const refs = new Set(
      [profile.authRef?.trim(), profile.name.trim()].filter(
        (value): value is string => Boolean(value)
      )
    );

    for (const ref of refs) {
      const secret = await this.profileSecrets.getSecret(ref);
      if (secret?.trim()) {
        return secret.trim();
      }
    }

    return undefined;
  }
}
