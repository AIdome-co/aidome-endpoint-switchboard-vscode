/**
 * Adapter for Tabnine assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';

/**
 * Tabnine assistant adapter.
 */
export class TabnineAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'TabNine.tabnine-vscode';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['tabnine']);

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

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = vscode.extensions.getExtension(this.extensionId);
    
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
  }

  getDisplayName(): string {
    return 'Tabnine';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
