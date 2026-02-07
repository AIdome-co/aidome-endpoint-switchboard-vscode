/**
 * Adapter for Claude Code assistant.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { detectCli } from '../../core/detection/detectCLIs';
import { Logger } from '../../util/log';

/**
 * Claude Code assistant adapter.
 */
export class ClaudeCodeAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      // Check for both VSCode extension and CLI
      const extensionDetected = vscode.extensions.getExtension('anthropic.claude-code') !== undefined;
      const cliDetected = await detectCli('claude');
      
      return extensionDetected || cliDetected;
    } catch (error) {
      this.logger.error('Error detecting Claude Code', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    // Claude Code is Tier C (guided only) - doesn't support direct base URL override
    let plan = createPlan(profile.id, ['claude-code']);

    // Add guided steps since we can't automate this
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Claude Code configuration guidance',
      assistantKey: 'claude-code',
      data: { 
        message: 'Claude Code does not support custom API base URLs',
        steps: [
          'Claude Code connects directly to Anthropic\'s API',
          'To route through AIdome, you would need to use HTTP_PROXY or HTTPS_PROXY environment variables',
          'However, this requires AIdome to act as a forward proxy, which may not be supported',
          'Consider using an alternative assistant that supports custom base URLs for full endpoint switching'
        ],
        baseUrl: profile.baseUrl,
        limitation: 'no-base-url-override'
      },
      reversible: false
    });

    // Optionally add proxy environment variable steps as guidance
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Optional: Set HTTPS_PROXY for routing (advanced)',
      assistantKey: 'claude-code',
      data: { 
        message: 'Advanced: Use proxy-based routing',
        steps: [
          'If AIdome supports forward proxy mode:',
          '1. Set HTTPS_PROXY environment variable to AIdome proxy URL',
          '2. Restart VS Code to apply environment changes',
          '3. Verify that requests are being routed through AIdome',
          'Note: This is an advanced configuration and may not work with all setups'
        ],
        envVarName: 'HTTPS_PROXY',
        optional: true
      },
      reversible: false
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    // For Tier C, application is mostly guidance - no actual changes
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      // For Claude Code, we can only verify that it's installed
      const extension = vscode.extensions.getExtension('anthropic.claude-code');
      const cliDetected = await detectCli('claude');

      if (!extension && !cliDetected) {
        return {
          success: false,
          message: 'Claude Code is not installed',
          details: { extension: false, cli: false }
        };
      }

      // Check for proxy environment variables
      const httpsProxy = process.env.HTTPS_PROXY;
      const httpProxy = process.env.HTTP_PROXY;

      if (httpsProxy || httpProxy) {
        return {
          success: true,
          message: 'Claude Code is installed. Proxy environment variables detected.',
          details: { 
            extension: !!extension,
            cli: cliDetected,
            httpsProxy: !!httpsProxy,
            httpProxy: !!httpProxy,
            note: 'Proxy-based routing may or may not be effective for Claude Code'
          }
        };
      }

      return {
        success: true,
        message: 'Claude Code is installed. No custom endpoint configuration detected (Tier C - guided only).',
        details: { 
          extension: !!extension,
          cli: cliDetected,
          tier: 'C',
          limitation: 'Claude Code does not support custom base URL configuration'
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Claude Code: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Claude Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
