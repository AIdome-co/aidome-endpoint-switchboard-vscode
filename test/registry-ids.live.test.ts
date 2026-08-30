/**
 * LIVE-NETWORK validation gate for assistant registry extension IDs.
 *
 * Queries the VS Code marketplace for every extension ID declared in
 * assistants.registry.json and fails the build when any assistant cannot be
 * resolved to a real extension. This prevents the class of bug where a
 * hardcoded extension ID (e.g. the old `CodeGPT.codegpt`) silently stops
 * detection from working.
 *
 * This test is excluded from the fast `npm test` run; execute it explicitly
 * with `npm run validate:registry` (see vitest.validation.config.ts).
 */

import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, it, expect } from 'vitest';
import { ExtensionIdResolver } from '../src/core/detection/extensionIdResolver';
import { MarketplaceClient } from '../src/core/detection/marketplace';
import type { AssistantRegistry } from '../src/core/registry/registryTypes';

// http.ts -> runtimeSettings imports `vscode` at module load. Provide a minimal
// stub so the real (network-hitting) MarketplaceClient import chain resolves.
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: () => undefined }) },
}));

const registryPath = path.join(__dirname, '..', 'src', 'core', 'registry', 'assistants.registry.json');

describe('registry extension IDs resolve on the marketplace (live)', () => {
  it('every declared extension ID is valid or resolvable', async () => {
    const raw = readFileSync(registryPath, 'utf-8');
    const registry = JSON.parse(raw) as AssistantRegistry;

    const extensionAssistants = registry.assistants
      .filter((a) => (a.detection.vscodeExtensionIds ?? []).length > 0);

    const resolver = new ExtensionIdResolver(new MarketplaceClient({ timeoutMs: 5000, retries: 1 }));
    const report = await resolver.validateRegistry(extensionAssistants, { requireMarketplace: true });

    for (const warning of report.warnings) {
      process.stdout.write(`[validate:registry] WARN  ${warning}\n`);
    }

    process.stdout.write(
      `[validate:registry] validated ${report.resolutions.length} assistant(s): ` +
      `${report.resolutions.filter((r) => r.status === 'declared-valid').length} declared-valid, ` +
      `${report.resolutions.filter((r) => r.status === 'resolved-from-market').length} resolved-from-market, ` +
      `${report.resolutions.filter((r) => r.status === 'offline-fallback').length} offline-fallback, ` +
      `${report.resolutions.filter((r) => r.status === 'unresolvable').length} unresolvable\n`
    );

    expect(report.errors, `Unresolvable registry extension IDs:\n${report.errors.join('\n')}`).toEqual([]);
    expect(report.isValid).toBe(true);
  });
}, 30000);
