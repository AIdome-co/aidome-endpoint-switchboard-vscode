/**
 * Adapter for Tabnine assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep, GuidedStepsData } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter, formatThrowable } from '../BaseExtensionAdapter';
import { validateUrl } from '../../core/profiles/profileValidator';

/**
 * Tabnine assistant adapter.
 */
export class TabnineAdapter extends BaseExtensionAdapter {
  // Both marketplace IDs ship the Enterprise flows: the legacy extension and
  // the "Tabnine for Enterprise" (self-hosted) updater extension.
  private static readonly extensionIds = ['TabNine.tabnine-vscode', 'TabNine.tabnine-vscode-self-hosted-updater'];

  protected readonly extensionId = TabnineAdapter.extensionIds[0];

  private static findInstalledExtension(): vscode.Extension<unknown> | undefined {
    for (const id of TabnineAdapter.extensionIds) {
      const extension = vscode.extensions.getExtension(id);
      if (extension) {
        return extension;
      }
    }
    return undefined;
  }

  override async detect(): Promise<boolean> {
    try {
      return TabnineAdapter.findInstalledExtension() !== undefined;
    } catch (error) {
      const formatted = formatThrowable(error);
      this.logger.error(
        `Error detecting ${this.getDisplayName()}: ${formatted.message}`,
        formatted.error,
        formatted.context
      );
      return false;
    }
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('Tabnine endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['tabnine']);

    const guidanceData = {
      message: 'Tabnine endpoint configuration is available only through Tabnine Enterprise',
      steps: [
        'Install the Tabnine for Enterprise VS Code extension if your organization provides one',
        'Admin: in the Tabnine Admin Console, open Models → Self-Managed Models and start the Add model wizard',
        'Step 1 (Provider): choose the OpenAI-compatible endpoint provider and set its base URL to the AIdome gateway endpoint',
        'Step 2 (Credentials): paste the AIdome gateway personal access token as the API key',
        'Step 3 (Model Details): select the technical model name from the auto-populated list (Tabnine queries the gateway model-listing API), or type the gateway\'s exact model identifier manually if the list is empty; set token limits and optional custom headers',
        'Step 4: set per-team availability, use Run Test to verify the endpoint, then Save — this routes Tabnine Chat/Agent models through the endpoint for the selected teams (or org-wide by default); code completions keep using Tabnine\'s own universal model',
        'Restart VS Code and choose Set server URL when Tabnine prompts for the Enterprise Server: point the extension at your organization\'s own Tabnine Enterprise instance, or at https://console.tabnine.com if your organization uses Tabnine Enterprise SaaS — never at the AIdome gateway directly',
        'If your organization has neither a self-hosted Tabnine Enterprise Server nor an Enterprise SaaS subscription, use Cline, Continue, or another assistant with custom endpoint support'
      ],
      baseUrl: profile.baseUrl,
      limitation: 'proprietary-protocol',
      tier: 'C',
      // Explicit typed outcome metadata (never inferred from limitation text).
      configurationStatus: 'unsupported'
    } satisfies GuidedStepsData;
    plan = addStep(plan, {
      action: 'show-guided-steps',
      description: 'Tabnine configuration guidance',
      assistantKey: 'tabnine',
      data: guidanceData,
      reversible: false
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = TabnineAdapter.findInstalledExtension();

    if (!extension) {
      return {
        success: false,
        message: 'Tabnine extension is not installed',
        details: { extension: false }
      };
    }

    // Installed != configured AND not verifiable from this extension: the
    // endpoint/model routing is admin-console (server-side) configuration,
    // which this extension can neither read nor verify.
    return {
      success: false,
      // Installed is NOT configurable from this extension: Tier C.
      message: 'Tabnine is installed, but endpoint configuration cannot be verified from this extension (Tier C): a Tabnine administrator routes Chat/Agent models to the endpoint via the Admin Console (Models → Self-Managed Models), which is server-side and invisible to the extension — request manual verification from your Tabnine administrator.',
      details: { 
        extension: true,
        tier: 'C',
        configurationStatus: 'unsupported',
        verification: 'manual-verification-required',
        limitation: 'Tabnine uses proprietary protocol and does not support OpenAI-compatible base URL switching from the extension'
      }
    };
  }

  getDisplayName(): string {
    return 'Tabnine';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }

  /** Tabnine has no OpenAI-compatible endpoint at all — guidance is informational. */
  getGuidedSetupStatus(): 'actionable' | 'unsupported' {
    return 'unsupported';
  }
}
