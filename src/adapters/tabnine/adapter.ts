/**
 * Adapter for Tabnine assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

/**
 * Tabnine assistant adapter.
 */
export class TabnineAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('TabNine.tabnine-vscode');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting Tabnine', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    // Tabnine is Tier C (guided only) - uses proprietary protocol
    let plan = createPlan(profile.id, ['tabnine']);

    // Add guided steps explaining the limitation
    const guidanceData = {
      message: 'Tabnine uses a proprietary protocol and does not support custom OpenAI-compatible endpoints',
      steps: [
        'Tabnine connects to Tabnine cloud or Tabnine Enterprise Server',
        'It does not support OpenAI-compatible base URL switching',
        'To use AIdome with Tabnine, you would need:',
        '  - Tabnine Enterprise Server configured to route through AIdome (enterprise setup)',
        '  - OR use an alternative assistant that supports custom endpoints',
        'For most users, consider using Cline, Continue, or Roo Code instead'
      ],
      baseUrl: profile.baseUrl,
      limitation: 'proprietary-protocol',
      tier: 'C'
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Tabnine configuration guidance',
      assistantKey: 'tabnine',
      data: guidanceData,
      reversible: false
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    // For Tier C, application is guidance only - no actual changes
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const extension = vscode.extensions.getExtension('TabNine.tabnine-vscode');
      
      if (!extension) {
        return {
          success: false,
          message: 'Tabnine extension is not installed',
          details: { extension: false }
        };
      }

      return {
        success: true,
        message: 'Tabnine is installed. Note: Tabnine does not support custom endpoint configuration (Tier C).',
        details: { 
          extension: true,
          tier: 'C',
          limitation: 'Tabnine uses proprietary protocol and does not support OpenAI-compatible base URL switching'
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Tabnine: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Tabnine';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
