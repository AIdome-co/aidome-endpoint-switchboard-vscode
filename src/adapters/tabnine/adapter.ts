/**
 * Adapter for Tabnine assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { validateUrl } from '../../core/profiles/profileValidator';

/**
 * Tabnine assistant adapter.
 */
export class TabnineAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'TabNine.tabnine-vscode';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Tabnine endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['tabnine']);

    const guidanceData = {
      message: 'Tabnine endpoint configuration is available only through Tabnine Enterprise',
      steps: [
        'Install the Tabnine for Enterprise VS Code extension if your organization provides one',
        'Restart VS Code and choose Set server URL when Tabnine prompts for the Enterprise Server',
        `Enter the Tabnine Enterprise Server URL that fronts or integrates with AIdome; do not paste an OpenAI API URL directly into standard Tabnine`,
        'If the prompt does not appear, open VS Code Settings and use the Tabnine server configuration action',
        'Reload VS Code and sign in to the configured enterprise instance',
        'If your organization does not operate a Tabnine Enterprise Server, use Cline, Continue, or another assistant with custom endpoint support'
      ],
      baseUrl: profile.baseUrl,
      limitation: 'proprietary-protocol',
      tier: 'C',
      configurationType: 'in-extension-ui'
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
      success: false,
      message: 'Tabnine is installed, but Enterprise server configuration requires manual setup and verification (Tier C).',
      details: { 
        extension: true,
        tier: 'C',
        configurationStatus: 'manual-configuration-required',
        enterpriseServerSupported: true,
        configured: 'unknown',
        verification: 'manual-request-required',
        limitation: 'Tabnine uses a proprietary protocol; only Tabnine Enterprise Server URL configuration is supported'
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
