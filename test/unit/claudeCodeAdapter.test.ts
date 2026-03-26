/**
 * Unit tests for Claude Code adapter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/adapters/claudeCode/adapter';
import { EndpointProfile } from '../../src/core/profiles/profileTypes';
import * as detectCLIs from '../../src/core/detection/detectCLIs';

// Mock vscode module
const mockExtension = {
  packageJSON: {}
};

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn()
  }
}));

// Mock the modules
vi.mock('../../src/core/detection/detectCLIs');
vi.mock('../../src/util/log', () => ({
  Logger: {
    getInstance: () => ({
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    })
  }
}));

describe('ClaudeCodeAdapter', () => {
  let adapter: ClaudeCodeAdapter;
  let mockProfile: EndpointProfile;

  beforeEach(() => {
    adapter = new ClaudeCodeAdapter();
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
    it('should return true when VSCode extension is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(vscode.extensions.getExtension).toHaveBeenCalledWith('anthropic.claude-code');
    });

    it('should return true when CLI is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.detect();

      expect(result).toBe(true);
      expect(detectCLIs.detectCli).toHaveBeenCalledWith('claude');
    });

    it('should return false when neither extension nor CLI is detected', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

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
    it('should create a plan with guided steps', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      expect(plan).toBeDefined();
      expect(plan.profileId).toBe(mockProfile.id);
      expect(plan.assistantKeys).toContain('claude-code');
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('should include show-guided-steps actions', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const guidedSteps = plan.steps.filter(s => s.action === 'show-guided-steps');
      expect(guidedSteps.length).toBeGreaterThan(0);
      
      const mainGuidance = guidedSteps[0];
      expect(mainGuidance.assistantKey).toBe('claude-code');
      expect(mainGuidance.data.limitation).toBe('no-base-url-override');
    });

    it('should include proxy guidance step', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const proxyGuidance = plan.steps.find(s => 
        s.action === 'show-guided-steps' && s.data.optional === true
      );
      expect(proxyGuidance).toBeDefined();
      expect(proxyGuidance?.data.envVarName).toBe('HTTPS_PROXY');
    });

    it('should not include CA cert step when caCertPath is not set', async () => {
      const plan = await adapter.buildPlan(mockProfile);

      const certStep = plan.steps.find(s =>
        s.action === 'show-guided-steps' && s.data.envVarName === 'NODE_EXTRA_CA_CERTS'
      );
      expect(certStep).toBeUndefined();
    });

    it('should include CA cert guidance step when caCertPath is set', async () => {
      const profileWithCert: EndpointProfile = {
        ...mockProfile,
        caCertPath: '/etc/ssl/certs/my-ca.pem'
      };

      const plan = await adapter.buildPlan(profileWithCert);

      const certStep = plan.steps.find(s =>
        s.action === 'show-guided-steps' && s.data.envVarName === 'NODE_EXTRA_CA_CERTS'
      );
      expect(certStep).toBeDefined();
      expect(certStep?.data.certPath).toBe('/etc/ssl/certs/my-ca.pem');
      // Steps should mention the cert path and NODE_EXTRA_CA_CERTS
      const steps = certStep?.data.steps as string[];
      expect(steps.some((s: string) => s.includes('/etc/ssl/certs/my-ca.pem'))).toBe(true);
      expect(steps.some((s: string) => s.includes('NODE_EXTRA_CA_CERTS'))).toBe(true);
    });
  });

  describe('verify', () => {
    it('should return success when extension is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed');
      expect(result.details?.extension).toBe(true);
    });

    it('should return success when CLI is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(true);

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.message).toContain('installed');
      expect(result.details?.cli).toBe(true);
    });

    it('should return failure when neither is installed', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(undefined);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const result = await adapter.verify();

      expect(result.success).toBe(false);
      expect(result.message).toContain('not installed');
    });

    it('should detect proxy environment variables', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);
      
      // Mock environment variable
      const originalEnv = process.env.HTTPS_PROXY;
      process.env.HTTPS_PROXY = 'http://proxy.example.com:8080';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.httpsProxy).toBe(true);
      expect(result.message).toContain('Proxy environment variables detected');

      // Restore
      if (originalEnv === undefined) {
        delete process.env.HTTPS_PROXY;
      } else {
        process.env.HTTPS_PROXY = originalEnv;
      }
    });

    it('should include nodeExtraCaCerts in details when env var is set', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const originalEnv = process.env.NODE_EXTRA_CA_CERTS;
      process.env.NODE_EXTRA_CA_CERTS = '/etc/ssl/certs/my-ca.pem';

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.nodeExtraCaCerts).toBe('/etc/ssl/certs/my-ca.pem');

      // Restore
      if (originalEnv === undefined) {
        delete process.env.NODE_EXTRA_CA_CERTS;
      } else {
        process.env.NODE_EXTRA_CA_CERTS = originalEnv;
      }
    });

    it('should report null nodeExtraCaCerts when env var is not set', async () => {
      const vscode = await import('vscode');
      vi.spyOn(vscode.extensions, 'getExtension').mockReturnValue(mockExtension as any);
      vi.spyOn(detectCLIs, 'detectCli').mockResolvedValue(false);

      const originalEnv = process.env.NODE_EXTRA_CA_CERTS;
      delete process.env.NODE_EXTRA_CA_CERTS;

      const result = await adapter.verify();

      expect(result.success).toBe(true);
      expect(result.details?.nodeExtraCaCerts).toBeNull();

      // Restore
      if (originalEnv !== undefined) {
        process.env.NODE_EXTRA_CA_CERTS = originalEnv;
      }
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
      expect(adapter.getDisplayName()).toBe('Claude Code');
    });
  });

  describe('getTier', () => {
    it('should return tier C', () => {
      expect(adapter.getTier()).toBe('C');
    });
  });
});
