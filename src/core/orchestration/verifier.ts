/**
 * Verifier for endpoint routing configuration with comprehensive multi-step pipeline.
 */

import * as dns from 'dns/promises';
import * as https from 'https';
import { httpRequest, HttpError } from '../../util/http';
import { EndpointProfile } from '../profiles/profileTypes';
import { RemoteContext } from '../detection/detectRemote';
import { Logger } from '../../util/log';
import { CircuitBreaker, withRetry } from '../../util/retry';

/**
 * Individual verification step result.
 */
export interface VerificationStep {
  name: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'warning';
  message: string;
  details?: Record<string, unknown>;
  duration?: number;     // ms
}

/**
 * Complete verification report for an endpoint.
 */
export interface VerificationReport {
  profileName: string;
  baseUrl: string;
  dialect: string;
  timestamp: string;
  overallStatus: 'passed' | 'failed' | 'partial';
  steps: VerificationStep[];
  remoteContext?: RemoteContext;
  actionableErrors: string[];
  suggestions: string[];
}

// Legacy interface for backward compatibility
export interface VerificationCheck {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  message: string;
  details?: Record<string, unknown>;
}

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
  /** Per-profile circuit breakers keyed by profile ID. */
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  /** Milliseconds before an open circuit allows a probe attempt. */
  private static readonly CIRCUIT_RESET_MS = 30_000;

  constructor() {
    this.logger = Logger.getInstance();
  }

  /**
   * Returns (creating if necessary) the circuit breaker for a given profile.
   * The circuit breaker is configured to log state transitions via the logger.
   */
  private getCircuitBreaker(profileId: string): CircuitBreaker {
    if (!this.circuitBreakers.has(profileId)) {
      // Open after 3 consecutive failures; reset probe after CIRCUIT_RESET_MS
      const breaker = new CircuitBreaker(3, Verifier.CIRCUIT_RESET_MS);
      breaker.onStateChange = (from, to, failures) => {
        if (to === 'open') {
          this.logger.warning(
            `[Verifier] Circuit breaker opened for profile "${profileId}" after ${failures} consecutive failure(s). ` +
            `Verification will be suppressed for ${Verifier.CIRCUIT_RESET_MS / 1_000}s.`
          );
        } else if (to === 'half-open') {
          this.logger.info(
            `[Verifier] Circuit breaker half-open for profile "${profileId}" — allowing probe attempt.`
          );
        } else if (to === 'closed') {
          this.logger.info(
            `[Verifier] Circuit breaker closed for profile "${profileId}" — endpoint responding normally.`
          );
        }
        this.logger.debug(
          `[Verifier] Circuit breaker transition: ${from} → ${to}`,
          undefined,
          { profileId, failures }
        );
      };
      this.circuitBreakers.set(profileId, breaker);
    }
    return this.circuitBreakers.get(profileId)!;
  }

  /**
   * Runs the comprehensive 7-step verification pipeline.
   * @param profile The endpoint profile to verify
   * @param options Verification options
   * @returns Promise resolving to verification report
   */
  async runVerificationPipeline(
    profile: EndpointProfile,
    options?: {
      includeTestPrompt?: boolean;
      remoteContext?: RemoteContext;
    }
  ): Promise<VerificationReport> {
    const steps: VerificationStep[] = [];
    const actionableErrors: string[] = [];
    const suggestions: string[] = [];
    
    this.logger.info(`Starting verification pipeline for profile: ${profile.name}`);

    // Circuit breaker guard — skip the pipeline if the endpoint has failed
    // repeatedly until the reset timeout elapses.
    const breaker = this.getCircuitBreaker(profile.id);
    if (breaker.isOpen()) {
      this.logger.warning(
        `Circuit breaker open for profile "${profile.name}" — skipping verification to avoid repeated failures`
      );
      return {
        profileName: profile.name,
        baseUrl: profile.baseUrl,
        dialect: profile.dialect,
        timestamp: new Date().toISOString(),
        overallStatus: 'failed',
        steps: [
          {
            name: 'circuit-breaker',
            status: 'skipped',
            message: `Verification skipped: endpoint has failed repeatedly. Retry in ~${Verifier.CIRCUIT_RESET_MS / 1_000} s.`
          }
        ],
        remoteContext: options?.remoteContext,
        actionableErrors: [`Endpoint is temporarily unavailable. Wait ${Verifier.CIRCUIT_RESET_MS / 1_000} s and try again.`],
        suggestions: ['Ensure the endpoint URL and auth token are correct before retrying.']
      };
    }
    
    // Parse base URL
    const url = new URL(profile.baseUrl);
    const isHttps = url.protocol === 'https:';
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    
    // Step 1: DNS Resolution
    const dnsStep = await this.stepDnsResolution(url.hostname, isLocalhost);
    steps.push(dnsStep);
    
    // Step 2: TLS Verification (for HTTPS, skip for HTTP localhost)
    const tlsStep = await this.stepTlsVerification(profile.baseUrl, isHttps, isLocalhost);
    steps.push(tlsStep);
    
    // Step 3: Endpoint Reachability
    const reachabilityStep = await this.stepEndpointReachability(profile.baseUrl);
    steps.push(reachabilityStep);
    
    // If first 3 steps all failed, skip remaining steps
    const criticalFailures = [dnsStep, tlsStep, reachabilityStep].filter(s => s.status === 'failed').length;
    if (criticalFailures >= 2) {
      this.logger.warning('Multiple critical failures, skipping remaining verification steps');
      
      // Mark remaining steps as skipped
      steps.push(this.createSkippedStep('health-check', 'Skipped due to connectivity issues'));
      steps.push(this.createSkippedStep('model-list', 'Skipped due to connectivity issues'));
      steps.push(this.createSkippedStep('dialect-validation', 'Skipped due to connectivity issues'));
      steps.push(this.createSkippedStep('test-prompt', 'Skipped due to connectivity issues'));
      
      actionableErrors.push('Cannot connect to endpoint. Check network, DNS, and firewall settings.');
    } else {
      // Step 4: Health Check (optional, don't fail on this)
      const healthStep = await this.stepHealthCheck(profile.baseUrl);
      steps.push(healthStep);
      
      // Step 5: Model List (if dialect supports it)
      const modelListStep = await this.stepModelList(profile.baseUrl, profile.dialect);
      steps.push(modelListStep);
      
      // Step 6: Dialect Validation
      const dialectStep = await this.stepDialectValidation(profile.baseUrl, profile.dialect);
      steps.push(dialectStep);
      
      // Step 7: Test Prompt (optional, only if explicitly requested)
      if (options?.includeTestPrompt) {
        const testPromptStep = await this.stepTestPrompt(profile.baseUrl);
        steps.push(testPromptStep);
      } else {
        steps.push(this.createSkippedStep('test-prompt', 'Skipped — test prompt not requested'));
      }
      
      // Generate actionable errors and suggestions
      this.generateActionableMessages(steps, profile, actionableErrors, suggestions, options?.remoteContext);
    }
    
    // Determine overall status
    const failedSteps = steps.filter(s => s.status === 'failed');
    const passedSteps = steps.filter(s => s.status === 'passed');
    const warningSteps = steps.filter(s => s.status === 'warning');
    
    let overallStatus: 'passed' | 'failed' | 'partial';
    if (failedSteps.length === 0 && passedSteps.length > 0) {
      overallStatus = 'passed';
    } else if (passedSteps.length > 0 && (failedSteps.length > 0 || warningSteps.length > 0)) {
      overallStatus = 'partial';
    } else {
      overallStatus = 'failed';
    }

    // Update circuit breaker based on overall outcome
    if (overallStatus === 'passed') {
      breaker.recordSuccess();
    } else if (overallStatus === 'failed') {
      breaker.recordFailure();
      if (breaker.getState() === 'open') {
        this.logger.warning(
          `Circuit breaker opened for profile "${profile.name}" after ${breaker.getFailureCount()} consecutive failures`
        );
      }
    }
    
    return {
      profileName: profile.name,
      baseUrl: profile.baseUrl,
      dialect: profile.dialect,
      timestamp: new Date().toISOString(),
      overallStatus,
      steps,
      remoteContext: options?.remoteContext,
      actionableErrors,
      suggestions
    };
  }

  /**
   * Step 1: DNS Resolution
   */
  private async stepDnsResolution(hostname: string, isLocalhost: boolean): Promise<VerificationStep> {
    const startTime = Date.now();
    
    if (isLocalhost) {
      return {
        name: 'dns-resolution',
        status: 'skipped',
        message: 'Skipped for localhost',
        duration: Date.now() - startTime
      };
    }
    
    try {
      await dns.resolve(hostname);
      return {
        name: 'dns-resolution',
        status: 'passed',
        message: 'Hostname resolved successfully',
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        name: 'dns-resolution',
        status: 'failed',
        message: `Cannot resolve hostname '${hostname}'. Check your network/DNS settings.`,
        details: { error: error instanceof Error ? error.message : String(error) },
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Step 2: TLS Verification
   */
  private async stepTlsVerification(baseUrl: string, isHttps: boolean, isLocalhost: boolean): Promise<VerificationStep> {
    const startTime = Date.now();
    
    if (!isHttps) {
      if (isLocalhost) {
        return {
          name: 'tls-verification',
          status: 'skipped',
          message: 'Skipped — using HTTP for localhost',
          duration: Date.now() - startTime
        };
      } else {
        return {
          name: 'tls-verification',
          status: 'warning',
          message: 'Using HTTP (unencrypted). Consider using HTTPS for production.',
          duration: Date.now() - startTime
        };
      }
    }
    
    return new Promise((resolve) => {
      const url = new URL(baseUrl);
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        method: 'GET',
        path: '/',
        rejectUnauthorized: true,
        timeout: 5000
      };
      
      const req = https.request(options, (res) => {
        const cert = (res.socket as import('tls').TLSSocket).getPeerCertificate();
        req.destroy();
        
        if (cert && cert.subject) {
          resolve({
            name: 'tls-verification',
            status: 'passed',
            message: 'TLS certificate is valid',
            details: { issuer: cert.issuer?.O, validTo: cert.valid_to },
            duration: Date.now() - startTime
          });
        } else {
          resolve({
            name: 'tls-verification',
            status: 'warning',
            message: 'Could not retrieve certificate details',
            duration: Date.now() - startTime
          });
        }
      });
      
      req.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' || error.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          resolve({
            name: 'tls-verification',
            status: 'warning',
            message: 'Self-signed certificate detected. To trust it, add to system trust store.',
            details: { error: error.message },
            duration: Date.now() - startTime
          });
        } else {
          resolve({
            name: 'tls-verification',
            status: 'failed',
            message: `TLS certificate error: ${error.message}. Check certificate configuration.`,
            details: { error: error.message },
            duration: Date.now() - startTime
          });
        }
      });
      
      req.on('timeout', () => {
        req.destroy();
        resolve({
          name: 'tls-verification',
          status: 'failed',
          message: 'TLS verification timeout',
          duration: Date.now() - startTime
        });
      });
      
      req.end();
    });
  }

  /**
   * Step 3: Endpoint Reachability
   */
  private async stepEndpointReachability(baseUrl: string): Promise<VerificationStep> {
    const startTime = Date.now();
    
    try {
      const response = await withRetry(
        () => httpRequest(baseUrl, {
          method: 'GET',
          timeout: 10000
        }),
        {
          maxAttempts: 2,
          baseDelayMs: 500,
          isRetryable: (e) => !(e instanceof HttpError && e.status < 500),
          onRetry: (attempt, maxAttempts, error, nextDelayMs) => {
            const msg = error instanceof Error ? error.message : String(error);
            this.logger.warning(
              `[Verifier] Endpoint reachability check failed (attempt ${attempt}/${maxAttempts}), ` +
              `retrying in ${nextDelayMs}ms — ${msg}`
            );
          }
        }
      );
      
      return {
        name: 'endpoint-reachability',
        status: 'passed',
        message: `Endpoint is reachable (HTTP ${response.status})`,
        details: { status: response.status },
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      let message = 'Failed to reach endpoint';
      
      if (error instanceof HttpError) {
        if (error.status === 401) {
          message = '401 Unauthorized. Check your API key in profile settings.';
        } else if (error.status === 403) {
          message = '403 Forbidden. Check API key permissions.';
        } else {
          message = `HTTP ${error.status}: ${error.statusText}`;
        }
      } else if (errorMsg.includes('ECONNREFUSED')) {
        message = 'Connection refused. Check if the server is running and the port is open.';
      } else if (errorMsg.includes('ETIMEDOUT') || errorMsg.includes('timeout')) {
        message = 'Connection timed out after 10s. Check network/firewall settings.';
      } else if (errorMsg.includes('proxy')) {
        message = 'Proxy error. Check HTTPS_PROXY environment variable.';
      }
      
      return {
        name: 'endpoint-reachability',
        status: 'failed',
        message,
        details: { error: errorMsg },
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Step 4: Health Check (optional)
   */
  private async stepHealthCheck(baseUrl: string): Promise<VerificationStep> {
    const startTime = Date.now();
    const healthEndpoints = ['/health', '/v1/health', '/healthz'];
    
    for (const endpoint of healthEndpoints) {
      try {
        const healthUrl = `${baseUrl.replace(/\/$/, '')}${endpoint}`;
        const response = await httpRequest<{ status?: string }>(healthUrl, {
          method: 'GET',
          timeout: 5000,
          retries: 0
        });
        
        if (response.status === 200) {
          const healthStatus = response.body?.status;
          if (healthStatus && healthStatus !== 'healthy' && healthStatus !== 'ok') {
            return {
              name: 'health-check',
              status: 'warning',
              message: `Health endpoint reports degraded status: ${healthStatus}`,
              details: { endpoint, status: healthStatus },
              duration: Date.now() - startTime
            };
          }
          
          return {
            name: 'health-check',
            status: 'passed',
            message: 'Health endpoint reports healthy',
            details: { endpoint },
            duration: Date.now() - startTime
          };
        }
      } catch {
        // Try next endpoint
      }
    }
    
    return {
      name: 'health-check',
      status: 'skipped',
      message: 'No health endpoint found (this is normal for many providers)',
      duration: Date.now() - startTime
    };
  }

  /**
   * Step 5: Model List
   */
  private async stepModelList(baseUrl: string, dialect: string): Promise<VerificationStep> {
    const startTime = Date.now();
    
    if (!this.supportsModelsList(dialect)) {
      return {
        name: 'model-list',
        status: 'skipped',
        message: `Skipped — dialect ${dialect} doesn't use /v1/models`,
        duration: Date.now() - startTime
      };
    }
    
    try {
      const modelsUrl = `${baseUrl.replace(/\/$/, '')}/v1/models`;
      const response = await httpRequest<{ data?: unknown[] }>(modelsUrl, {
        method: 'GET',
        timeout: 10000,
        retries: 1
      });
      
      const modelCount = Array.isArray(response.body?.data) ? response.body.data.length : 0;
      
      if (modelCount === 0) {
        return {
          name: 'model-list',
          status: 'failed',
          message: 'Model list is empty. Verify provider configuration.',
          details: { modelCount: 0 },
          duration: Date.now() - startTime
        };
      }
      
      return {
        name: 'model-list',
        status: 'passed',
        message: `Found ${modelCount} models available`,
        details: { modelCount },
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      let message = 'Failed to retrieve model list';
      
      if (error instanceof HttpError && error.status === 401) {
        message = 'Could not retrieve models. Check authentication.';
      }
      
      return {
        name: 'model-list',
        status: 'failed',
        message,
        details: { error: errorMsg },
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Step 6: Dialect Validation
   */
  private async stepDialectValidation(baseUrl: string, expectedDialect: string): Promise<VerificationStep> {
    const startTime = Date.now();
    
    try {
      // Try to detect dialect from response headers
      const response = await httpRequest(baseUrl, {
        method: 'GET',
        timeout: 5000,
        retries: 0
      });
      
      // Check response headers for dialect hints
      const contentType = response.headers['content-type'];
      const server = response.headers['server'];
      
      // Simple heuristic - this could be enhanced
      let detectedDialect: string | undefined;
      
      if (typeof server === 'string') {
        if (server.toLowerCase().includes('anthropic')) {
          detectedDialect = 'anthropic.messages';
        } else if (server.toLowerCase().includes('openai')) {
          detectedDialect = 'openai.chat_completions';
        }
      }
      
      if (detectedDialect && detectedDialect !== expectedDialect) {
        return {
          name: 'dialect-validation',
          status: 'warning',
          message: `Response suggests ${detectedDialect} but profile is configured for ${expectedDialect}. Consider updating the dialect setting.`,
          details: { detected: detectedDialect, expected: expectedDialect },
          duration: Date.now() - startTime
        };
      }
      
      return {
        name: 'dialect-validation',
        status: 'skipped',
        message: 'Could not validate dialect (insufficient response data)',
        duration: Date.now() - startTime
      };
    } catch {
      return {
        name: 'dialect-validation',
        status: 'skipped',
        message: 'Could not validate dialect (endpoint unreachable)',
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Step 7: Test Prompt (optional)
   */
  private async stepTestPrompt(baseUrl: string): Promise<VerificationStep> {
    const startTime = Date.now();
    
    try {
      const chatUrl = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
      
      await httpRequest(chatUrl, {
        method: 'POST',
        timeout: 15000,
        retries: 0,
        body: {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Say hello' }],
          max_tokens: 5
        }
      });
      
      return {
        name: 'test-prompt',
        status: 'passed',
        message: 'Test prompt received valid response',
        duration: Date.now() - startTime
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        name: 'test-prompt',
        status: 'failed',
        message: `Test prompt failed: ${errorMsg}`,
        details: { error: errorMsg },
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Creates a skipped step.
   */
  private createSkippedStep(name: string, message: string): VerificationStep {
    return {
      name,
      status: 'skipped',
      message
    };
  }

  /**
   * Generates actionable errors and suggestions.
   */
  private generateActionableMessages(
    steps: VerificationStep[],
    profile: EndpointProfile,
    actionableErrors: string[],
    suggestions: string[],
    remoteContext?: RemoteContext
  ): void {
    for (const step of steps) {
      if (step.status === 'failed') {
        actionableErrors.push(`${step.name}: ${step.message}`);
      }
    }
    
    // Add remote context suggestions
    if (remoteContext?.isRemote) {
      if (profile.baseUrl.includes('localhost')) {
        suggestions.push(`Consider using the remote host's IP/hostname instead of localhost when in ${remoteContext.remoteType} environment`);
      }
    }
    
    // Add general suggestions based on failures
    const failedSteps = steps.filter(s => s.status === 'failed');
    if (failedSteps.some(s => s.name === 'dns-resolution')) {
      suggestions.push('Verify your DNS settings and network connectivity');
    }
    if (failedSteps.some(s => s.name === 'tls-verification')) {
      suggestions.push('Check TLS certificate validity or add exception for self-signed certificates');
    }
    if (failedSteps.some(s => s.name === 'endpoint-reachability')) {
      suggestions.push('Verify the endpoint URL, check firewall rules, and ensure the service is running');
    }
  }

  /**
   * Checks if a dialect supports model list endpoint.
   */
  private supportsModelsList(dialect: string): boolean {
    // Most OpenAI-compatible dialects support /v1/models
    const supportedDialects = ['openai.chat_completions', 'openai.responses', 'anthropic.messages'];
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

  /**
   * Verifies an endpoint profile (legacy method for backward compatibility).
   * @param profile The endpoint profile to verify
   * @param testPrompt Whether to run optional test prompt (default: false)
   * @returns Promise resolving to verification result
   */
  async verifyEndpoint(profile: EndpointProfile, testPrompt = false): Promise<VerificationResult> {
    // Run new pipeline and convert to legacy format
    const report = await this.runVerificationPipeline(profile, { includeTestPrompt: testPrompt });
    
    // Convert steps to checks
    const checks: VerificationCheck[] = report.steps.map(step => ({
      name: step.name,
      status: step.status === 'passed' ? 'pass' : step.status === 'failed' ? 'fail' : 'skip',
      message: step.message,
      details: step.details
    }));
    
    // Determine status
    let status: 'success' | 'partial' | 'failed';
    if (report.overallStatus === 'passed') {
      status = 'success';
    } else if (report.overallStatus === 'partial') {
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
}
