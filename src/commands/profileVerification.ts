import * as vscode from 'vscode';
import { detectRemote } from '../core/detection/detectRemote';
import { Verifier, VerificationReport } from '../core/orchestration/verifier';
import { ProfileSecrets } from '../core/profiles/profileSecrets';
import { ProfileStore } from '../core/profiles/profileStore';
import { EndpointProfile } from '../core/profiles/profileTypes';
import { showError, showSuccess, showWarning, withProgress } from '../ui/notifications';
import { getOutputChannel } from '../ui/output';
import { Logger } from '../util/log';

interface VerifyProfileConnectionOptions {
  progressTitle?: string;
}

export type ProfileVerificationExecutionResult =
  | { kind: 'passed'; report: VerificationReport }
  | { kind: 'partial'; report: VerificationReport }
  | { kind: 'failed'; report: VerificationReport }
  | { kind: 'error'; message: string };

/**
 * Runs verification for a single profile, persists the verification timestamp, and renders the report.
 * @param context Extension context
 * @param profile Profile to verify
 * @param options Optional progress display overrides
 * @returns Structured verification outcome for caller-specific messaging
 */
export async function runProfileVerification(
  context: vscode.ExtensionContext,
  profile: EndpointProfile,
  options: VerifyProfileConnectionOptions = {}
): Promise<ProfileVerificationExecutionResult> {
  const logger = Logger.getInstance();
  const profileStore = new ProfileStore(context);
  const profileSecrets = new ProfileSecrets(context);
  let result: ProfileVerificationExecutionResult | undefined;

  await withProgress(
    options.progressTitle ?? `Testing connection to ${profile.name}...`,
    async () => {
      const verifier = new Verifier();
      const remoteContext = detectRemote(profile.baseUrl);
      const authToken = profile.authRef ? await profileSecrets.getSecret(profile.authRef) : undefined;

      try {
        const report = await verifier.runVerificationPipeline(profile, {
          includeTestPrompt: false,
          remoteContext,
          authToken,
        });

        profile.lastVerified = report.timestamp;
        await profileStore.saveProfile(profile);
        displayVerificationResults(report);

        if (report.overallStatus === 'passed') {
          result = { kind: 'passed', report };
        } else if (report.overallStatus === 'partial') {
          result = { kind: 'partial', report };
        } else {
          result = { kind: 'failed', report };
        }
      } catch (error) {
        logger.error('Verification failed', error instanceof Error ? error : undefined);
        result = {
          kind: 'error',
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  );

  if (!result) {
    return {
      kind: 'error',
      message: 'Verification did not produce a result.'
    };
  }

  return result;
}

/**
 * Verifies a single profile connection, updates the verification timestamp, and renders the report.
 * @param context Extension context
 * @param profile Profile to verify
 * @param options Optional progress display overrides
 */
export async function verifyProfileConnection(
  context: vscode.ExtensionContext,
  profile: EndpointProfile,
  options: VerifyProfileConnectionOptions = {}
): Promise<void> {
  const result = await runProfileVerification(context, profile, options);

  if (result.kind === 'passed') {
    await showSuccess(`Connection to "${profile.name}" verified successfully!`);
  } else if (result.kind === 'partial') {
    await showWarning(`Connection to "${profile.name}" has warnings. Check output for details.`);
  } else if (result.kind === 'failed') {
    await showError(`Connection to "${profile.name}" failed. Check output for details.`);
  } else {
    await showError(`Verification error: ${result.message}`);
  }
}

/**
 * Displays a single-profile verification report in the shared output channel.
 * @param report Verification report to render
 */
export function displayVerificationResults(report: VerificationReport): void {
  const output = getOutputChannel();

  output.appendLine('');
  output.appendLine('='.repeat(60));
  output.appendLine(`Verification Report: ${report.profileName}`);
  output.appendLine(`Base URL: ${report.baseUrl}`);
  output.appendLine(`Dialect: ${report.dialect}`);
  output.appendLine(`Timestamp: ${report.timestamp}`);
  output.appendLine(`Overall Status: ${report.overallStatus.toUpperCase()}`);
  output.appendLine('='.repeat(60));

  for (const step of report.steps) {
    const icon = step.status === 'passed'
      ? '✓'
      : step.status === 'failed'
        ? '✗'
        : step.status === 'warning'
          ? '⚠'
          : '○';
    output.appendLine(`${icon} ${step.name}: ${step.message}`);
    if (step.duration) {
      output.appendLine(`  Duration: ${step.duration}ms`);
    }
  }

  if (report.actionableErrors.length > 0) {
    output.appendLine('');
    output.appendLine('Errors:');
    report.actionableErrors.forEach((err: string) => output.appendLine(`  - ${err}`));
  }

  if (report.suggestions.length > 0) {
    output.appendLine('');
    output.appendLine('Suggestions:');
    report.suggestions.forEach((suggestion: string) => output.appendLine(`  - ${suggestion}`));
  }

  output.appendLine('='.repeat(60));
  output.show();
}