/**
 * Adapter for OpenAI Codex CLI.
 */

import { AssistantAdapter } from '../AssistantAdapter';
import { Plan } from '../../core/orchestration/planBuilder';

/**
 * OpenAI Codex CLI adapter.
 */
export class CodexAdapter implements AssistantAdapter {
  async detect(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  async buildPlan(endpointUrl: string, apiKey?: string): Promise<Plan> {
    throw new Error('Not implemented');
  }

  async apply(plan: Plan): Promise<void> {
    throw new Error('Not implemented');
  }

  async verify(): Promise<boolean> {
    throw new Error('Not implemented');
  }

  getDisplayName(): string {
    return 'OpenAI Codex (CLI / IDE)';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
