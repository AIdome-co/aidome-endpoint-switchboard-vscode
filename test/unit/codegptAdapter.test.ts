/**
 * Unit tests for CodeGPT adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeGptAdapter } from '../../src/adapters/codegpt/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as settingsScanner from '../../src/adapters/generic/settingsScanner';

// Mock vscode module
const mockExtension = {
  packageJSON: {
    contributes: {
      configuration: {
          properties: {
            'codegpt.apiUrl': {},
          'codegpt.provider': { enum: ['openai-compatible', 'custom'] }
        }
      }
    }
  }
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn()
    }))
  }
}));

vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('CodeGptAdapter', () => {
  let adapter: CodeGptAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new CodeGptAdapter();
    mockProfile = {
      id: 'test-profile',
      name: 'Test Profile',
      baseUrl: 'https://aidome.example.com/v1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    vi.clearAllMocks();
  });

  describe('detect', () => {
    it('should return true when CodeGPT extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('CodeGPT.codegpt');
    });

    it('should return false when extension is not detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.detect();

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.detect();

      expect(result).toBe(false);
    });
  });

  describe('buildPlan', () => {
    it('should create a plan with settings when keys are discovered', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([
        { key: 'codegpt.apiUrl', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue('https://old-url.com');

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('codegpt');
      expect(plan.steps.length).toBeGreaterThan(0);

      const settingStep = plan.steps.find(s => s.action === 'set-vscode-setting');
      expect(settingStep).toBeDefined();
      expect(settingStep?.newValue).toBe(mockProfile.baseUrl);
    });

    it('should fall back to guided mode when no settings keys found', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([]);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);
      
      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('codegpt');
      expect(mainGuidance.data.baseUrl).toBe(mockProfile.baseUrl);
      expect(mainGuidance.data.configurationType).toBe('in-extension-ui');
      expect(mainGuidance.data.limitation).toContain('version-dependent');
      expect(Array.isArray(mainGuidance.data.steps)).toBe(true);
      expect((mainGuidance.data.steps as string[]).length).toBeGreaterThan(0);
      expect((mainGuidance.data.steps as string[]).join('\n')).toContain('Manage my AI Models');
    });

    it('should include provider setting when discovered', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([
        { key: 'codegpt.apiUrl', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([
        { key: 'codegpt.provider', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);

      const providerStep = plan.steps.find(s => 
        s.action === 'set-vscode-setting' && 
        s.targetPath?.includes('provider')
      );
      expect(providerStep).toBeDefined();
      expect(providerStep?.newValue).toBe('openai-compatible');
    });

    it('should retain guided completion when only a provider setting is discoverable', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([
        { key: 'codegpt.provider', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue(undefined);

      const plan = await adapter.buildPlan(mockProfile);

      expect(plan.steps.some(step => step.action === 'set-vscode-setting')).toBe(true);
      const guidedStep = plan.steps.find(step => step.action === 'show-guided-steps');
      expect(guidedStep?.data.configurationType).toBe('in-extension-ui');
      expect((guidedStep?.data.steps as string[]).join('\n')).toContain('API URL/Base URL');
    });
  });

  describe('verify', () => {
    it('should return failure when extension is not installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should return failure when no settings are configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([
        { key: 'codegpt.apiUrl', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue(undefined);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('endpoint URL is not configured');
      expect(result.details?.tier).toBe('B');
      expect(result.details?.configurationStatus).toBe('manual-configuration-required');
    });

    it('should reject an unsafe or non-URL endpoint value during verification', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([
        { key: 'codegpt.apiUrl', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue('javascript:alert(1)');

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('endpoint URL is not configured');
    });

    it('should return success when settings are configured', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(settingsScanner, 'discoverBaseUrlSettings').mockReturnValue([
        { key: 'codegpt.apiUrl', confidence: 1.0, reason: 'High confidence match' }
      ]);
      vi.spyOn(settingsScanner, 'discoverProviderSettings').mockReturnValue([]);
      vi.spyOn(settingsScanner, 'getSettingValue').mockReturnValue('https://aidome.example.com/v1');

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
      expect(result.details?.configuredSettingKeys).toEqual(['codegpt.apiUrl']);
      expect(result.details?.configurationStatus).toBe('endpoint-configured');
    });

    it('should handle errors gracefully', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockImplementation(() => {
        throw new Error('Test error');
      });

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('Error verifying');
    });
  });

  describe('getDisplayName', () => {
    it('should return correct display name', () => {
      expect(adapter.getDisplayName()).toBe('CodeGPT');
    });
  });

  describe('getTier', () => {
    it('should return tier B', () => {
      expect(adapter.getTier()).toBe('B');
    });
  });
});
