/**
 * Adapter for CodeGPT assistant.
 *
 * CodeGPT stores its local/OpenAI-compatible provider in its own SQLite
 * connection table (~/.codegpt/db.sqlite), not in contributed VS Code
 * settings. This adapter writes the connection row exactly as CodeGPT's own
 * "Manage my AI Models" UI does, so the gateway models appear in the CodeGPT
 * panel without manual setup.
 */

import { EndpointProfile } from '../../core/profiles/profileTypes';
import { Plan, createPlan, addStep } from '../../core/orchestration/planBuilder';
import { VerificationResult } from '../AssistantAdapter';
import { BaseExtensionAdapter } from '../BaseExtensionAdapter';
import { validateUrl, validateInputUrl } from '../../core/profiles/profileValidator';
import { getProviderConfigDescriptor } from '../../core/providerConfig/descriptors';
import * as fs from 'fs/promises';
import {
  readCodeGptConnection,
  resolveCodeGptHome,
  normalizeStorageBaseUrl,
  writeCodeGptConnection,
  writeCodeGptConnectionViaSidecar,
  ensureCodeGptLocalFlavor,
  resolveDbPath,
  resolveSettingsPath,
  checkpointCodeGptDb,
  backupCodeGptDb,
} from './codegptStorage';
import { registerAssistantStorageWriter } from '../../core/orchestration/assistantStorageWriters';

const DESCRIPTOR = getProviderConfigDescriptor('codegpt');

// Register the storage writer so the generic `write-assistant-storage`
// applier action can dispatch to CodeGPT without importing provider modules
// from core (dependency-direction rule).
//
// Write strategy: merge the WAL and back up the DB file first (so rollback
// restores a consistent pre-write state), then prefer CodeGPT's own sidecar
// API; fall back to a direct SQLite write when the sidecar is not running.
registerAssistantStorageWriter('codegpt', async (step, apiKey) => {
  const data = (step.data ?? {}) as Record<string, unknown>;
  const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl : undefined;
  if (!baseUrl) {
    throw new Error('write-assistant-storage requires a baseUrl in step data');
  }
  const homeDir = typeof data.homeDir === 'string' ? data.homeDir : undefined;

  const dbPath = resolveDbPath(homeDir);
  const settingsPath = resolveSettingsPath(homeDir);
  const dbExisted = await fs.access(dbPath).then(() => true, () => false);

  await checkpointCodeGptDb(homeDir);
  const backupPath = await backupCodeGptDb(homeDir);

  const viaSidecar = await writeCodeGptConnectionViaSidecar(baseUrl, apiKey, homeDir);
  if (!viaSidecar) {
    await writeCodeGptConnection(baseUrl, apiKey, homeDir, { skipBackup: true });
  }

  // The flavor setting is REQUIRED state: a failed write must fail the whole
  // step so the applier rolls the DB write back (Codex 4648050961). The
  // settings.json mutation is tracked for rollback too (Codex 4648050971).
  const settingsExisted = await fs.access(settingsPath).then(() => true, () => false);
  try {
    const flavor = await ensureCodeGptLocalFlavor(homeDir);
    return {
      backupPath,
      target: dbPath,
      createdFile: !dbExisted,
      extraRollbacks: flavor.changed
        ? [{ target: settingsPath, backupPath: flavor.backupPath, createdFile: !settingsExisted }]
        : []
    };
  } catch (error) {
    throw new Error(
      `CodeGPT flavor setting could not be written; rolling back the database write (${error instanceof Error ? error.message : String(error)})`
    );
  }
});

/** CodeGPT assistant adapter. */
export class CodeGptAdapter extends BaseExtensionAdapter {
  protected readonly extensionId = 'DanielSanMedium.dscodegpt';

  async buildPlan(profile: EndpointProfile): Promise<Plan> {
    if (!validateUrl(profile.baseUrl)) {
      throw new Error('CodeGPT endpoint URL is invalid or uses an unsupported scheme');
    }

    let plan = createPlan(profile.id, ['codegpt']);

    plan = addStep(plan, {
      action: 'write-assistant-storage',
      description: 'Configure CodeGPT local provider (custom_link + api key)',
      assistantKey: 'codegpt',
      targetPath: resolveCodeGptHome(),
      data: {
        baseUrl: normalizeStorageBaseUrl(profile.baseUrl),
        authRef: profile.authRef,
      },
      reversible: true,
    });

    return plan;
  }

  protected async verifyConfiguration(): Promise<VerificationResult> {
    const extension = await this.detect();
    if (!extension) {
      return {
        success: false,
        message: 'CodeGPT extension is not installed',
        details: { extension: false }
      };
    }

    // The authoritative store is CodeGPT's own SQLite database, not VS Code
    // contributed settings. Read the real custom_link / apikey so verification
    // reflects what CodeGPT will actually use.
    const stored = await readCodeGptConnection();
    const storedBaseUrl = stored?.customLink;

    if (!storedBaseUrl) {
      return {
        success: false,
        message: 'CodeGPT local provider is not configured in its storage',
        details: {
          extension: true,
          tier: DESCRIPTOR?.tier ?? 'B',
          configurationStatus: 'manual-configuration-required',
          note: 'CodeGPT stores its local provider in ~/.codegpt/db.sqlite; run the setup to write it'
        }
      };
    }

    // The stored custom_link reflects the (already-validated) profile base URL,
    // which may legitimately be a remote http endpoint. Use the lenient parser
    // (http/https only, any host) rather than validateUrl (https/localhost only)
    // so a correctly-stored gateway URL isn't flagged as invalid.
    const storedValid = validateInputUrl(storedBaseUrl);
    return {
      success: storedValid,
      message: storedValid
        ? 'CodeGPT configuration verified (local provider stored in CodeGPT storage)'
        : 'CodeGPT stored base URL is invalid',
      details: {
        extension: true,
        tier: DESCRIPTOR?.tier ?? 'B',
        storedCustomLink: storedBaseUrl,
        apiKeyConfigured: !!stored?.apikey,
        configurationStatus: storedValid ? 'endpoint-configured' : 'invalid-storage-value'
      }
    };
  }

  getDisplayName(): string {
    return 'CodeGPT';
  }

  getTier(): 'A' | 'B' | 'C' {
    return DESCRIPTOR?.tier ?? 'B';
  }
}
