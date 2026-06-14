/**
 * Adapter for AnythingLLM.
 *
 * AnythingLLM is a desktop application detected via filesystem paths.
 * It does not use VS Code extension detection.
 */

import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';
import * as os from 'os';
import * as path from 'path';
import { fileExists } from '../../util/fsSafe';

/**
 * AnythingLLM adapter.
 */
export class AnythingLlmAdapter implements AssistantAdapter {
  private readonly logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const detectionPaths = this.getDetectionPaths();
      
      for (const detectionPath of detectionPaths) {
        if (await fileExists(detectionPath)) {
          return true;
        }
      }
      
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
      paths.push(
        path.join(homeDir, 'AppData', 'Local', 'AnythingLLM'),
        path.join(homeDir, 'AppData', 'Local', 'Programs', 'AnythingLLM'),
        path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'AnythingLLM'),
        path.join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'AnythingLLM')
      );
    } else if (platform === 'darwin') {
      paths.push(
        '/Applications/AnythingLLM.app',
        path.join(homeDir, 'Applications', 'AnythingLLM.app')
      );
    } else {
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
    let plan = createPlan(profile.id, ['anythingllm']);

    const configGuidanceData = {
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
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'AnythingLLM configuration guidance',
      assistantKey: 'anythingllm',
      data: configGuidanceData,
      reversible: false
    });

    const clipboardGuidanceData = {
      message: 'For your convenience',
      steps: [
        `AIdome Endpoint URL: ${profile.baseUrl}`,
        'You can copy this URL from the steps above',
        'Paste it into AnythingLLM\'s Base URL field'
      ],
      baseUrl: profile.baseUrl,
      action: 'copy-to-clipboard'
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Copy endpoint URL',
      assistantKey: 'anythingllm',
      data: clipboardGuidanceData,
      reversible: false
    });

    return plan;
  }

  async apply(_plan: Plan): Promise<void> {
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
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
  }

  getDisplayName(): string {
    return 'AnythingLLM';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
