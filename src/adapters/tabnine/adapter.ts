/**
 * Adapter for Tabnine assistant.
 */

import { AssistantAdapter } from '../AssistantAdapter';
import { Plan } from '../../core/orchestration/planBuilder';

/**
 * Tabnine assistant adapter.
 */
export class TabnineAdapter implements AssistantAdapter {
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
    return 'Tabnine';
  }

  getTier(): 'A' | 'B' | 'C' {
    return 'C';
  }
}
