/**
 * Adapter for Cline assistant.
 */

import { AssistantAdapter } from '../AssistantAdapter';
import { Plan } from '../../core/orchestration/planBuilder';

/**
 * Cline assistant adapter.
 */
export class ClineAdapter implements AssistantAdapter {
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
    return 'Cline';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'A';
  }
}
