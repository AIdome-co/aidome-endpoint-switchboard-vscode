/**
 * Adapter for Roo Code.
 *
 * Roo Code is retired upstream. Its old settings are intentionally not
 * mutated because they are no longer a supported configuration contract.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { validateUrl } from '../../core/profiles/profileValidator';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';

const DESCRIPTOR = getProviderConfigDescriptor('roo-code');

/** Roo Code assistant adapter. */
export class RooCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'RooVeterinaryInc.roo-cline';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Roo Code endpoint URL is invalid or uses an unsupported scheme');
    }

    const guidanceData = {
      message: 'Roo Code is retired and cannot be safely configured by Switchboard',
      steps: [
        'Roo Code is no longer maintained by its upstream project',
        'Switchboard will not write the retired roo-cline settings because their behavior cannot be verified',
        'Use a maintained assistant with an explicit provider contract, such as Cline, Continue, or Kilo Code',
        `If you have a supported fork, configure its documented OpenAI-compatible endpoint manually: ${profile.baseUrl}`
      ],
      baseUrl: profile.baseUrl,
      tier: DESCRIPTOR?.tier ?? 'C',
      limitation: 'retired-upstream'
    } satisfies GuidedStepsData;

    return addStep(createPlan(profile.id, ['roo-code']), {
      action: 'show-guided-steps',
      description: 'Roo Code configuration guidance',
      assistantKey: 'roo-code',
      data: guidanceData,
      reversible: false
    });
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const installed = await this.detect();
    return {
      success: false,
      message: installed
        ? 'Roo Code is installed, but the retired assistant is unsupported'
        : 'Roo Code is not installed',
      details: {
        extension: installed,
        tier: DESCRIPTOR?.tier ?? 'C',
        configurationStatus: 'unsupported',
        limitation: 'retired-upstream'
      }
    };
  }

  getDisplayName(): string {
    return 'Roo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return DESCRIPTOR?.tier ?? 'C';
  }
}
