/**
 * Adapter for Gemini CLI.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { detectCli } from '../../core/detection/detectCLIs';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import { validateUrl } from '../../core/profiles/profileValidator';

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
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Gemini CLI endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['gemini-cli']);

    // Gemini CLI upstream refuses plain-HTTP base URLs unless they point at
    // localhost (geminicli.com configuration docs). A profile the creation
    // flow accepted with an http:// self-hosted gateway cannot be honored
    // here, so surface guided steps instead of throwing mid-plan (which
    // would leave assistants in mixed states) or guiding into a broken
    // configuration.
    const parsedEndpoint = new URL(profile.baseUrl);
    if (parsedEndpoint.protocol === 'http:'
      && !['localhost', '127.0.0.1', '[::1]'].includes(parsedEndpoint.hostname)) {
      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Gemini CLI requires an HTTPS gateway endpoint',
        assistantKey: 'gemini-cli',
        data: {
          message: 'Gemini CLI only accepts HTTPS base URLs (or localhost); choose an HTTPS gateway profile or front the gateway with TLS',
          steps: [
            'Gemini CLI rejects GOOGLE_GEMINI_BASE_URL / GOOGLE_VERTEX_BASE_URL values that use plain http:// on non-localhost hosts.',
            `The selected profile endpoint is: ${profile.baseUrl}`,
            'Either select a profile whose endpoint is HTTPS, or terminate TLS in front of the gateway (reverse proxy / load balancer) and use that HTTPS URL.',
            'localhost / 127.0.0.1 / [::1] endpoints are exempt from this upstream requirement.',
            'Re-run the wizard with an HTTPS endpoint, then set the variable as described below.'
          ],
          baseUrl: profile.baseUrl,
          envVarName: 'GOOGLE_GEMINI_BASE_URL or GOOGLE_VERTEX_BASE_URL',
          limitation: 'gemini-cli-requires-https-base-url',
          tier: DESCRIPTOR?.tier ?? 'C'
        } satisfies GuidedStepsData,
        reversible: false
      });
    }

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
        tier: DESCRIPTOR?.tier ?? 'C',
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
