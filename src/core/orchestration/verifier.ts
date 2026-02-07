/**
 * Verifier for endpoint routing configuration.
 */

import { httpRequest, HttpError } from '../../util/http';
import { EndpointProfile } from '../profiles/profileTypes';
import { Logger } from '../../util/log';

/**
 * Individual verification check result.
 */
export interface VerificationCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Complete verification result for an endpoint.
 */
export interface VerificationResult {
  status: 'success' | 'partial' | 'failed';
  checks: VerificationCheck[];
  actionableMessage: string;
}

/**
 * Verifies endpoint routing configurations.
 */
export class Verifier {
  private logger: Logger;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Verifies an endpoint profile.
   * @param profile The endpoint profile to verify
   * @param testPrompt Whether to run optional test prompt (default: false)
   * @returns Promise resolving to verification result
   */
  async verifyEndpoint(profile: EndpointProfile, testPrompt = false): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];
    
    // Step 1: Reachability check
    const reachabilityCheck = await this.checkReachability(profile.baseUrl);
    checks.push(reachabilityCheck);

    // Step 2: Model list retrieval (if dialect supports it)
    if (reachabilityCheck.status === 'pass' && this.supportsModelsList(profile.dialect)) {
      const modelsCheck = await this.checkModelsList(profile.baseUrl);
      checks.push(modelsCheck);
    } else if (this.supportsModelsList(profile.dialect)) {
      checks.push({
        name: 'model-list',
        status: 'skip',
        message: 'Skipped due to failed reachability check'
      });
    }

    // Step 3: Optional test prompt
    if (testPrompt && reachabilityCheck.status === 'pass') {
      const promptCheck = await this.checkTestPrompt(profile.baseUrl);
      checks.push(promptCheck);
    }

    // Determine overall status
    const failedChecks = checks.filter(c => c.status === 'fail');
    const passedChecks = checks.filter(c => c.status === 'pass');
    
    let status: 'success' | 'partial' | 'failed';
    if (failedChecks.length === 0 && passedChecks.length > 0) {
      status = 'success';
    } else if (passedChecks.length > 0) {
      status = 'partial';
    } else {
      status = 'failed';
    }

    // Generate actionable message
    const actionableMessage = this.generateActionableMessage(checks, profile.baseUrl);

    return {
      status,
      checks,
      actionableMessage
    };
  }

  /**
   * Checks endpoint reachability using HTTP GET/HEAD request.
   */
  private async checkReachability(baseUrl: string): Promise<VerificationCheck> {
    try {
      this.logger.debug(`Checking reachability for ${baseUrl}`);
      
      await httpRequest(baseUrl, {
        method: 'GET',
        timeout: 5000,
        retries: 1
      });

      return {
        name: 'reachability',
        status: 'pass',
        message: `Endpoint ${baseUrl} is reachable`
      };
    } catch (error) {
      this.logger.debug(`Reachability check failed: ${error}`);
      
      return {
        name: 'reachability',
        status: 'fail',
        message: this.getReachabilityErrorMessage(error),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * Checks model list endpoint.
   */
  private async checkModelsList(baseUrl: string): Promise<VerificationCheck> {
    try {
      const modelsUrl = `${baseUrl.replace(/\/$/, '')}/v1/models`;
      this.logger.debug(`Checking models list at ${modelsUrl}`);
      
      const response = await httpRequest<{ data?: unknown[] }>(modelsUrl, {
        method: 'GET',
        timeout: 10000,
        retries: 1
      });

      const modelCount = Array.isArray(response.body?.data) ? response.body.data.length : 0;

      return {
        name: 'model-list',
        status: 'pass',
        message: `Retrieved ${modelCount} models from endpoint`,
        details: { modelCount }
      };
    } catch (error) {
      this.logger.debug(`Model list check failed: ${error}`);
      
      return {
        name: 'model-list',
        status: 'fail',
        message: 'Failed to retrieve model list',
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * Checks endpoint with a test prompt (optional).
   */
  private async checkTestPrompt(baseUrl: string): Promise<VerificationCheck> {
    try {
      const chatUrl = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      this.logger.debug(`Sending test prompt to ${chatUrl}`);
      
      await httpRequest(chatUrl, {
        method: 'POST',
        timeout: 15000,
        retries: 0,
        body: {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 5
        }
      });

      return {
        name: 'test-prompt',
        status: 'pass',
        message: 'Test prompt succeeded'
      };
    } catch (error) {
      this.logger.debug(`Test prompt failed: ${error}`);
      
      return {
        name: 'test-prompt',
        status: 'fail',
        message: 'Test prompt failed',
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  /**
   * Checks if a dialect supports model list endpoint.
   */
  private supportsModelsList(dialect: string): boolean {
    // Most OpenAI-compatible dialects support /v1/models
    const supportedDialects = ['openai', 'openai-compatible', 'azure-openai', 'anthropic-messages'];
    return supportedDialects.includes(dialect.toLowerCase());
  }

  /**
   * Gets a user-friendly error message for reachability failures.
   */
  private getReachabilityErrorMessage(error: unknown): string {
    if (error instanceof HttpError) {
      if (error.status === 401 || error.status === 403) {
        return `Authentication failed (HTTP ${error.status}). Check your API key.`;
      }
      if (error.status === 404) {
        return `Endpoint not found (HTTP 404). Verify the base URL.`;
      }
      return `HTTP error ${error.status}: ${error.statusText}`;
    }

    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (errorMsg.includes('ENOTFOUND') || errorMsg.includes('getaddrinfo')) {
      return 'DNS resolution failed. Check the hostname.';
    }
    if (errorMsg.includes('ECONNREFUSED')) {
      return 'Connection refused. The server may be down or unreachable.';
    }
    if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout')) {
      return 'Connection timeout. The server is not responding.';
    }
    if (errorMsg.includes('certificate') || errorMsg.includes('TLS') || errorMsg.includes('SSL')) {
      return 'TLS/SSL certificate error. The server certificate may be invalid.';
    }
    
    return `Network error: ${errorMsg}`;
  }

  /**
   * Generates an actionable message based on verification results.
   */
  private generateActionableMessage(checks: VerificationCheck[], baseUrl: string): string {
    const failedCheck = checks.find(c => c.status === 'fail');
    
    if (!failedCheck) {
      return `✓ Endpoint ${baseUrl} verified successfully`;
    }

    const messages: string[] = [];
    messages.push(`✗ Verification failed for ${baseUrl}`);
    
    for (const check of checks) {
      if (check.status === 'fail') {
        messages.push(`  - ${check.name}: ${check.message}`);
      }
    }

    return messages.join('\n');
  }
}
