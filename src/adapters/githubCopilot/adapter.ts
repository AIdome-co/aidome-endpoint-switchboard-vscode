/**
 * Adapter for GitHub Copilot assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

/**
 * GitHub Copilot assistant adapter.
 */
export class GitHubCopilotAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      // Check for both the main Copilot extension and Copilot Chat
      const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
      const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
      
      return copilotExtension !== undefined || copilotChatExtension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting GitHub Copilot', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    // GitHub Copilot is Tier C (guided only) - proprietary service
    let plan = createPlan(profile.id, ['github-copilot']);

    // Add guided steps explaining the limitation
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'GitHub Copilot configuration guidance',
      assistantKey: 'github-copilot',
      data: {
        message: 'GitHub Copilot does not support custom API endpoints',
        steps: [
          'GitHub Copilot connects directly to GitHub\'s proprietary Copilot service',
          'It does not expose a base_url override in VS Code settings',
          'GitHub Copilot uses a proprietary protocol, not OpenAI-compatible APIs',
          'To use AIdome\'s endpoint routing features:',
          '  - Consider using Cline, Continue, or Roo Code instead',
          '  - These assistants support custom OpenAI-compatible endpoints',
          '  - AIdome can then route their requests to various LLM providers',
          'For enterprise use cases, consider GitHub Copilot Enterprise with custom policies'
        ],
        baseUrl: profile.baseUrl,
        limitation: 'proprietary-service-no-override',
        tier: 'C'
      },
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
      const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
      const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
      
      if (!copilotExtension && !copilotChatExtension) {
        return {
          success: false,
          message: 'GitHub Copilot is not installed',
          details: { 
            copilot: false,
            copilotChat: false
          }
        };
      }

      return {
        success: true,
        message: 'GitHub Copilot is installed. Note: Copilot does not support custom endpoint configuration (Tier C).',
        details: { 
          copilot: !!copilotExtension,
          copilotChat: !!copilotChatExtension,
          tier: 'C',
          limitation: 'GitHub Copilot uses proprietary service APIs and does not support base URL override'
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying GitHub Copilot: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
