/**
 * Adapter for Gemini CLI.
 */

import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { detectCli } from '../../core/detection/detectCLIs';
import { Logger } from '../../util/log';

/**
 * Gemini CLI adapter.
 */
export class GeminiCliAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      return await detectCli('gemini');
    } catch (error) {
      this.logger.error('Error detecting Gemini CLI', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    // Gemini CLI is Tier C (guided only) - no base URL override support
    let plan = createPlan(profile.id, ['gemini-cli']);

    // Add guided steps explaining the limitation
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

  async apply(plan: Plan): Promise<void> {
    // For Tier C, application is guidance only - no actual changes
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
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
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Gemini CLI: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Gemini CLI';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
