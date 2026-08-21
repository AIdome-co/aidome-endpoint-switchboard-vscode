/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { validateUrl } from '../../core/profiles/profileValidator';

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
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Gemini CLI endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['gemini-cli']);

    const guidanceData = {
      message: 'Gemini CLI supports gateway base URLs through environment variables',
      steps: [
        'Choose the environment variable that matches your Gemini CLI authentication mode:',
        '  - Gemini API key authentication: GOOGLE_GEMINI_BASE_URL',
        '  - Vertex AI authentication: GOOGLE_VERTEX_BASE_URL',
        `Set the selected variable to: ${profile.baseUrl}`,
        'For macOS/Linux: export VARIABLE_NAME="<your AIdome endpoint>"',
        'For Windows PowerShell: $env:VARIABLE_NAME="<your AIdome endpoint>"',
        'Persist the variable in your shell profile or a Gemini CLI .env file, then restart Gemini CLI',
        'Keep the existing Gemini API key or Vertex AI authentication configuration unchanged'
      ],
      baseUrl: profile.baseUrl,
      envVarName: 'GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
      limitation: 'environment-variable-configuration-required',
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

    const configuredEnvironmentVariables = [
      ...(process.env['GOOGLE_GEMINI_BASE_URL'] ? ['GOOGLE_GEMINI_BASE_URL'] : []),
      ...(process.env['GOOGLE_VERTEX_BASE_URL'] ? ['GOOGLE_VERTEX_BASE_URL'] : [])
    ];
    const configured = configuredEnvironmentVariables.length > 0;

    return {
      success: configured,
      message: configured
        ? 'Gemini CLI is installed and a supported gateway base-URL environment variable is configured.'
        : 'Gemini CLI is installed, but a supported gateway base-URL environment variable is not configured.',
      details: { 
        cli: true,
        tier: 'C',
        configurationStatus: configured ? 'environment-variable-configured' : 'manual-configuration-required',
        limitation: 'Base URL overrides require GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
        supportedEnvironmentVariables: [
          'GOOGLE_GEMINI_BASE_URL',
          'GOOGLE_VERTEX_BASE_URL'
        ],
        configuredEnvironmentVariables
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
