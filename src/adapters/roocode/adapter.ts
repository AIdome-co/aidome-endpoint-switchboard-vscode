import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { GuidedStepsData, Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { validateUrl } from '../../core/profiles/profileValidator';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';

const ROO_CODE_EXTENSION_ID = 'RooVeterinaryInc.roo-cline';
const OPENAI_CHAT_DIALECT = 'openai.chat_completions';
const OPENAI_RESPONSES_DIALECT = 'openai.responses';

/**
 * Adapter for the final Roo Code extension release.
 *
 * Roo Code 3.54.0 (RooCodeInc/Roo-Code v3.54.0, commit
 * 4a4cbb279bbeb2b9e98cb1808b9ce882384cf3) stores provider profiles in its
 * own SecretStorage and exposes no VS Code configuration key for endpoint
 * routing. The repository was archived on May 15, 2026. Keep this adapter
 * detection- and guidance-only so it never claims to have changed a setting
 * that Roo Code does not read.
 */

function getResponsesBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  parsed.pathname = parsed.pathname.replace(/\/v1\/?$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

function getGuidance(profile: EndpointProfile): GuidedStepsData {
  const isResponses = profile.dialect === OPENAI_RESPONSES_DIALECT;
  const providerLabel = isResponses ? 'OpenAI' : 'OpenAI Compatible';
  const baseUrl = isResponses ? getResponsesBaseUrl(profile.baseUrl) : profile.baseUrl;
  const baseUrlField = isResponses ? 'custom Base URL' : 'Base URL';

  return {
    message: 'Roo Code endpoint routing requires manual configuration in its settings',
    steps: [
      'Open the Roo Code sidebar and click its settings gear.',
      `Choose "${providerLabel}" in the API Provider dropdown.`,
      `Set ${baseUrlField} to: ${baseUrl}`,
      'Enter the gateway API key in Roo Code’s API Key field; the Switchboard does not copy secrets into Roo Code.',
      'Enter or select a model ID exposed by the gateway.',
      'Save the provider profile and select it for the active Roo Code mode.',
      'Send a small Roo Code request to confirm that the gateway receives traffic.',
    ],
    baseUrl,
    tier: 'C',
    configurationType: 'in-extension-ui',
    limitation: 'roo-code-provider-profiles-use-private-secret-storage',
  };
}

/**
 * Roo Code assistant adapter.
 */
export class RooCodeAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = ROO_CODE_EXTENSION_ID;

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    const plan = createPlan(profile.id, ['roo-code']);

    if (!profile.baseUrl || !validateUrl(profile.baseUrl)) {
      throw new Error('Roo Code endpoint URL is invalid or uses an unsupported scheme');
    }

    const supportedDialect = profile.dialect === OPENAI_CHAT_DIALECT ||
      profile.dialect === OPENAI_RESPONSES_DIALECT;

    if (!supportedDialect) {
      const guidanceData = {
        message: `Roo Code cannot use the ${profile.dialect} profile dialect through its final supported providers`,
        steps: [
          'Choose an endpoint profile using openai.chat_completions or openai.responses.',
          'Open the Roo Code sidebar and configure the matching OpenAI provider manually.',
          'Verify the selected model and send a test request from Roo Code.',
        ],
        tier: 'C',
        limitation: 'unsupported-roo-code-dialect',
        requestedDialect: profile.dialect,
      } satisfies GuidedStepsData;

      return addStep(plan, {
        action: 'show-guided-steps',
        description: 'Roo Code requires a supported OpenAI dialect',
        assistantKey: 'roo-code',
        data: guidanceData,
        reversible: false,
      });
    }

    return addStep(plan, {
      action: 'show-guided-steps',
      description: 'Configure Roo Code endpoint routing manually',
      assistantKey: 'roo-code',
      data: getGuidance(profile),
      reversible: false,
    });
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = vscode.extensions.getExtension(this.extensionId);

    if (!extension) {
      return {
        success: false,
        message: 'Roo Code is not installed',
        details: { extension: false, tier: 'C' },
      };
    }

    return {
      success: false,
      message: 'Roo Code is installed, but endpoint routing must be verified manually in Roo Code',
      details: {
        extension: true,
        tier: 'C',
        automated: false,
        configured: 'unknown',
        verification: 'manual-request-required',
        limitation: 'Roo Code provider profiles are stored in Roo Code SecretStorage, which this extension cannot inspect',
      },
    };
  }

  getDisplayName(): string {
    return 'Roo Code';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
