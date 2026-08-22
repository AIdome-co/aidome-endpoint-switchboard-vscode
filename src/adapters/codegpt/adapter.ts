/**
 * Adapter for CodeGPT assistant.
 */

import * as vscode from 'vscode';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { validateInputUrl } from '../../core/profiles/profileValidator';
import {
  readCodeGptConnection,
  resolveCodeGptHome,
  normalizeStorageBaseUrl,
} from './codegptStorage';
/**
 * CodeGPT assistant adapter.
 */
export class CodeGptAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'CodeGPT.codegpt';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    let plan = createPlan(profile.id, ['codegpt']);

    // CodeGPT stores its local/OpenAI-compatible provider in its own SQLite
    // connection table (~/.codegpt/db.sqlite), not in contributed VS Code
    // settings. Write it exactly as CodeGPT's own UI does so models appear
    // in the CodeGPT panel automatically.
    plan = addStep(plan, {
      action: 'write-assistant-storage',
      description: 'Configure CodeGPT local provider (custom_link + api key)',
      assistantKey: 'codegpt',
      targetPath: resolveCodeGptHome(),
      data: {
        baseUrl: normalizeStorageBaseUrl(profile.baseUrl),
        authRef: profile.authRef,
      },
      reversible: true,
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = vscode.extensions.getExtension(this.extensionId);
    if (!extension) {
      return {
        success: false,
        message: 'CodeGPT extension is not installed',
        details: { extension: false }
      };
    }

    // The authoritative store is CodeGPT's own SQLite database, not VS Code
    // contributed settings. Read the real custom_link / apikey so verification
    // reflects what CodeGPT will actually use.
    const stored = await readCodeGptConnection();
    const storedBaseUrl = stored?.customLink;

    if (!storedBaseUrl) {
      return {
        success: false,
        message: 'CodeGPT local provider is not configured in its storage',
        details: {
          extension: true,
          tier: 'B',
          configurationStatus: 'manual-configuration-required',
          note: 'CodeGPT stores its local provider in ~/.codegpt/db.sqlite; run the setup to write it',
        }
      };
    }

    // The stored custom_link reflects the (already-validated) profile base URL,
    // which may legitimately be a remote http endpoint. Use the lenient parser
    // (http/https only, any host) rather than validateUrl (https/localhost only)
    // so a correctly-stored gateway URL isn't flagged as invalid.
    const storedValid = validateInputUrl(storedBaseUrl);
    return {
      success: storedValid,
      message: storedValid
        ? 'CodeGPT configuration verified (local provider stored in CodeGPT storage)'
        : 'CodeGPT stored base URL is invalid',
      details: {
        extension: true,
        storedCustomLink: storedBaseUrl,
        apiKeyConfigured: !!stored?.apikey,
        configurationStatus: storedValid ? 'endpoint-configured' : 'invalid-storage-value',
      }
    };
  }

  getDisplayName(): string {
    return 'CodeGPT';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'B';
  }
}
