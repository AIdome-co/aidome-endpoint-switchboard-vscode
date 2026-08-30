/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';

const DESCRIPTOR = getProviderConfigDescriptor('gemini-cli');

/**
 * Gemini CLI adapter.
 */
export class GeminiCliAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = '';

  async detect(): Promise<boolean> {
    try {
      return await detectCli('gemini');
    } catch (error) {
      this.logger.error('Error detecting Gemini CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['gemini-cli']);

    const guidanceData = {
      message: 'Configure Gemini CLI through its gateway environment variables',
      steps: [
        'Set GOOGLE_GEMINI_BASE_URL in the environment that launches Gemini CLI',
        `Use this endpoint value: ${profile.baseUrl}`,
        'Set GEMINI_API_KEY in that same environment if the gateway requires authentication',
        'Start a new Gemini CLI process after changing the environment variables',
        'Switchboard keeps any saved profile credential in SecretStorage and does not modify the parent process environment'
      ],
      baseUrl: profile.baseUrl,
      limitation: 'process-environment-guidance',
      envVarName: 'GOOGLE_GEMINI_BASE_URL',
      tier: DESCRIPTOR?.tier ?? 'C'
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Gemini CLI configuration guidance',
      assistantKey: 'gemini-cli',
      data: guidanceData,
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const cliDetected = await detectCli('gemini');
    
    if (!cliDetected) {
      return {
        success: false,
        message: 'Gemini CLI is not installed or not in PATH',
        details: { cli: false }
      };
    }

    return {
      success: false,
      message: 'Gemini CLI is installed, but gateway environment configuration must be verified in the launching process',
      details: { 
        cli: true,
        tier: DESCRIPTOR?.tier ?? 'C',
        configurationStatus: 'manual-configuration-required',
        environmentVariable: 'GOOGLE_GEMINI_BASE_URL',
        limitation: 'Switchboard cannot inspect or change the environment of an already running CLI parent process'
      }
    };
  }

  getDisplayName(): string {
    return 'Gemini CLI';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
