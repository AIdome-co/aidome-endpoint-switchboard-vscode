/**
 * Adapter for Roo Code assistant.
 *
 * ⚠️ DEFUNCT: Roo Code shut down on May 15, 2026. The extension and
 * documentation are no longer maintained. This adapter is retained for
 * backward compatibility with users who may still have the extension
 * installed, but no further updates are expected.
 */

import * as vscode from 'vscode';
import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { Logger } from '../../util/log';

/**
 * Roo Code assistant adapter.
 */
export class RooCodeAdapter implements AssistantAdapter {
  private logger = Logger.getInstance();

  async detect(): Promise<boolean> {
    try {
      const extension = vscode.extensions.getExtension('RooVeterinaryInc.roo-cline');
      return extension !== undefined;
    } catch (error) {
      this.logger.error('Error detecting Roo Code', error as Error);
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['roo-code']);

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: 'Set Roo Code OpenAI base URL',
      assistantKey: 'roo-code',
      targetPath: 'roo-cline.openAiBaseUrl',
      newValue: profile.baseUrl,
      data: { 
        settingKey: 'roo-cline.openAiBaseUrl', 
        value: profile.baseUrl 
      },
      reversible: true
    });

    plan = addStep(plan, {
      action: 'set-vscode-setting',
      description: 'Set Roo Code API provider to OpenAI',
      assistantKey: 'roo-code',
      targetPath: 'roo-cline.apiProvider',
      newValue: 'openai',
      data: { 
        settingKey: 'roo-cline.apiProvider', 
        value: 'openai' 
      },
      reversible: true
    });

    return plan;
  }

  async apply(plan: Plan): Promise<void> {
    return Promise.resolve();
  }

  async verify(): Promise<VerificationResult> {
    try {
      const config = vscode.workspace.getConfiguration();
      
      const baseUrl = config.get<string>('roo-cline.openAiBaseUrl');
      const apiProvider = config.get<string>('roo-cline.apiProvider');

      if (!baseUrl) {
        return {
          success: false,
          message: 'Roo Code openAiBaseUrl not configured',
          details: { baseUrl, apiProvider }
        };
      }

      return {
        success: true,
        message: 'Roo Code configuration verified',
        details: { 
          baseUrl, 
          apiProvider,
          configured: true 
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error verifying Roo Code config: ${(error as Error).message}`,
        details: { error: (error as Error).message }
      };
    }
  }

  getDisplayName(): string {
    return 'Roo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
