/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';

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
      message: 'Gemini CLI does not support custom base URL configuration',
      steps: [
        'The official Gemini CLI connects directly to Google\'s Gemini API',
        'It does not expose a base_url override option',
        'To route Gemini requests through AIdome:',
        '  - Use an OpenAI-compatible assistant (like Cline or Continue) to connect to AIdome',
        '  - Configure AIdome to route to Gemini upstream',
        '  - This way AIdome handles the Gemini API calls on your behalf',
        'Alternative: Use environment-based HTTP proxy (advanced, may not work reliably)'
      ],
      baseUrl: profile.baseUrl,
      limitation: 'no-base-url-override',
      tier: 'C'
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
      success: true,
      message: 'Gemini CLI is installed. Note: Gemini CLI does not support custom endpoint configuration (Tier C).',
      details: { 
        cli: true,
        tier: 'C',
        limitation: 'Gemini CLI does not support base URL override'
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
