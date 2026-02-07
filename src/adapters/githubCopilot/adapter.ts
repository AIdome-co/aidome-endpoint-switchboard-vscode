/**
 * Adapter for GitHub Copilot assistant.
 */

import { AssistantAdapter, VerificationResult } from '../AssistantAdapter';
import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan } from '../../core/orchestration/planBuilder';

/**
 * GitHub Copilot assistant adapter.
 */
export class GitHubCopilotAdapter implements AssistantAdapter {
  async detect(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    throw new Error('Not implemented');
  }

  async apply(plan: Plan): Promise<void> {
    throw new Error('Not implemented');
  }

  async verify(): Promise<VerificationResult> {
    throw new Error('Not implemented');
  }

  getDisplayName(): string {
    return 'GitHub Copilot';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
