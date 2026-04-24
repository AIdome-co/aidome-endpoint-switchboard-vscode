/**
 * Integration tests for wizard flow.
 * Verifies flow state management, step navigation, and remote detection.
 */

import { describe, it, expect, vi } from 'vitest';
import { runSetupWizard, nextStep, previousStep, WizardState } from '../../src/ui/wizard/flow';

vi.mock('vscode', () => ({
  env: {
    remoteName: undefined
  },
  window: {
    showWarningMessage: vi.fn()
  }
}));

vi.mock('../../src/core/detection/detectRemote', () => ({
  detectRemote: vi.fn(() => ({
    isRemote: false,
    remoteType: undefined
  }))
}));

vi.mock('../../src/ui/remoteBanner', () => ({
  showRemoteBanner: vi.fn()
}));

describe('Wizard Flow Integration', () => {
  describe('WizardState navigation', () => {
    it('should advance step by one', () => {
      const state: WizardState = {
        currentStep: 0,
        totalSteps: 5,
        data: {},
        completed: false
      };

      const next = nextStep(state);

      expect(next.currentStep).toBe(1);
      expect(next.totalSteps).toBe(5);
      expect(next.completed).toBe(false);
    });

    it('should not exceed totalSteps', () => {
      const state: WizardState = {
        currentStep: 5,
        totalSteps: 5,
        data: {},
        completed: false
      };

      const next = nextStep(state);

      expect(next.currentStep).toBe(5);
    });

    it('should go back one step', () => {
      const state: WizardState = {
        currentStep: 3,
        totalSteps: 5,
        data: {},
        completed: false
      };

      const prev = previousStep(state);

      expect(prev.currentStep).toBe(2);
    });

    it('should not go below step 0', () => {
      const state: WizardState = {
        currentStep: 0,
        totalSteps: 5,
        data: {},
        completed: false
      };

      const prev = previousStep(state);

      expect(prev.currentStep).toBe(0);
    });

    it('should preserve data across navigation', () => {
      const state: WizardState = {
        currentStep: 1,
        totalSteps: 5,
        data: { profileId: 'test', baseUrl: 'https://example.com' },
        completed: false
      };

      const next = nextStep(state);

      expect(next.data).toEqual({ profileId: 'test', baseUrl: 'https://example.com' });
    });
  });

  describe('runSetupWizard', () => {
    it('should complete without throwing', async () => {
      await expect(runSetupWizard()).resolves.toBeUndefined();
    });

    it('should call detectRemote and showRemoteBanner', async () => {
      const { detectRemote } = await import('../../src/core/detection/detectRemote');
      const { showRemoteBanner } = await import('../../src/ui/remoteBanner');

      await runSetupWizard();

      expect(detectRemote).toHaveBeenCalled();
      expect(showRemoteBanner).toHaveBeenCalled();
    });
  });
});
