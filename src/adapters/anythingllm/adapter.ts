/**
 * Adapter for AnythingLLM.
 */

import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';
import * as os from 'os';
import * as path from 'path';
import { fileExists } from '../../util/fsSafe';

/**
 * AnythingLLM adapter.
 */
export class AnythingLlmAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      // AnythingLLM is a desktop app, not a VS Code extension
      // We can try to detect it by checking for common installation paths
      const detectionPaths = this.getDetectionPaths();
      
      for (const detectionPath of detectionPaths) {
        if (await fileExists(detectionPath)) {
          return true;
        }
      }
      
      // If we can't detect it, we'll still return true for guidance
      // since users might have it installed in a non-standard location
      return false;
    } catch (error) {
      this.logger.error('Error detecting AnythingLLM', error as Error);
      return false;
    }
  }

  private getDetectionPaths(): string[] {
    const platform = os.platform();
    const homeDir = os.homedir();
    
    const paths: string[] = [];
    
    if (platform === 'win32') {
      // Windows paths
      paths.push(
        path.join(homeDir, 'AppData', 'Local', 'AnythingLLM'),
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'AnythingLLM'),
        'C:\\Program Files\\AnythingLLM',
        'C:\\Program Files (x86)\\AnythingLLM'
      );
    } else if (platform === 'darwin') {
      // macOS paths
      paths.push(
        '/Applications/AnythingLLM.app',
        path.join(homeDir, 'Applications', 'AnythingLLM.app')
      );
    } else {
      // Linux paths
      paths.push(
        '/opt/AnythingLLM',
        path.join(homeDir, '.local', 'share', 'AnythingLLM'),
        '/usr/local/bin/anythingllm',
        '/usr/bin/anythingllm'
      );
    }
    
    return paths;
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    // AnythingLLM is Tier B (guided) - desktop app configuration
    let plan = createPlan(profile.id, ['anythingllm']);

    // Add guided steps for configuring AnythingLLM
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'AnythingLLM configuration guidance',
      assistantKey: 'anythingllm',
      data: {
        message: 'Configure AnythingLLM to use your AIdome endpoint',
        steps: [
          'Open AnythingLLM desktop application',
          'Navigate to Settings → LLM Configuration',
          'Select "Generic OpenAI" or "OpenAI Compatible" as the provider',
          `Set the Base URL to: ${profile.baseUrl}`,
          'Enter your API key if required (may be stored in AIdome profile)',
          'Select or configure the model name as appropriate',
          'Test the connection',
          'Save the configuration'
        ],
        baseUrl: profile.baseUrl,
        tier: 'B',
        configurationType: 'desktop-app-ui'
      },
      reversible: false
    });

    // Add a step to copy the base URL to clipboard for convenience
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Copy endpoint URL',
      assistantKey: 'anythingllm',
      data: {
        message: 'For your convenience',
        steps: [
          `AIdome Endpoint URL: ${profile.baseUrl}`,
          'You can copy this URL from the steps above',
          'Paste it into AnythingLLM\'s Base URL field'
        ],
        baseUrl: profile.baseUrl,
        action: 'copy-to-clipboard'
      },
      reversible: false
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    // For Tier B desktop app, application is guidance only - no VS Code changes
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const detected = await this.detect();
      
      return {
        success: true,
        message: detected 
          ? 'AnythingLLM detected. Configuration must be done in the AnythingLLM app (Tier B).' 
          : 'AnythingLLM not auto-detected. If installed, configure it manually using the guided steps.',
        details: { 
          detected: detected,
          tier: 'B',
          note: 'AnythingLLM is a desktop application. Configuration is done through its UI, not VS Code settings.',
          detectionPaths: this.getDetectionPaths()
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying AnythingLLM: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'AnythingLLM';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
