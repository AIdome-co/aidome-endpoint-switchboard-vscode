/**
 * Adapter for CodeGPT assistant.
 *
 * CodeGPT's current model-management UI is not represented by a stable,
 * documented VS Code setting contract. Keep this adapter guided-only rather
 * than mutating settings discovered by scanning extension metadata.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { validateUrl } from '../../core/profiles/profileValidator';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';

const DESCRIPTOR = getProviderConfigDescriptor('codegpt');

/** CodeGPT assistant adapter. */
export class CodeGptAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'DanielSanMedium.dscodegpt';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('CodeGPT endpoint URL is invalid or uses an unsupported scheme');
    }

    return addStep(createPlan(profile.id, ['codegpt']), {
      action: 'show-guided-steps',
      description: 'Complete CodeGPT model configuration in the extension UI',
      assistantKey: 'codegpt',
      data: this.getGuidedSteps(profile),
      reversible: false
    });
  }

  private getGuidedSteps(profile: EndpointProfile): GuidedStepsData {
    return {
      message: 'Complete CodeGPT model configuration in the extension UI',
      steps: [
        'Open the CodeGPT view in the VS Code Activity Bar',
        'Open the Gear icon or "Manage my AI Models"',
        'Choose Local, Custom, or another OpenAI-compatible provider',
        `Set the provider API URL/Base URL to: ${profile.baseUrl}`,
        'Enter the gateway API key in CodeGPT if the endpoint requires authentication',
        'Select a model, click Connect or Save, and reload CodeGPT if prompted'
      ],
      baseUrl: profile.baseUrl,
      tier: DESCRIPTOR?.tier ?? 'B',
      configurationType: 'in-extension-ui',
      limitation: 'CodeGPT model-management settings are version-dependent and cannot be safely inferred from extension metadata'
    };
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = await this.detect();
    if (!extension) {
      return {
        success: false,
        message: 'CodeGPT extension is not installed',
        details: { extension: false }
      };
    }

    return {
      success: false,
      message: 'CodeGPT is installed, but endpoint configuration must be verified in the model-management panel',
      details: {
        extension: true,
        tier: DESCRIPTOR?.tier ?? 'B',
        configurationStatus: 'manual-configuration-required',
        limitation: 'No stable, documented setting is available for safe automatic verification'
      }
    };
  }

  getDisplayName(): string {
    return 'CodeGPT';
  }

  getTier(): 'A' | 'B' | 'C' {
    return DESCRIPTOR?.tier ?? 'B';
  }
}
