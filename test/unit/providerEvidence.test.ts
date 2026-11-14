/**
 * Upstream evidence / drift validation (runtime network-independent).
 *
 * Validates that every provider descriptor's versionEvidence is structurally
 * sound and consistent with the maintained provider repository manifest
 * (maintenance/provider-repositories.json). When required evidence is missing
 * or contradictory, automatic configuration must not silently continue as
 * Tier A — the drift contract must fail closed.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { getProviderConfigDescriptors } from '../../src/core/providerConfig/descriptors';

const manifest = JSON.parse(
  readFileSync('maintenance/provider-repositories.json', 'utf-8')
) as {
  providers: Array<{ key: string; url: string; branch: string; status: string }>;
};

const manifestByKey = new Map(manifest.providers.map(provider => [provider.key, provider]));
const descriptors = getProviderConfigDescriptors();

describe('upstream evidence / drift validation', () => {
  it('has a maintained repository entry for every provider descriptor', () => {
    for (const descriptor of descriptors) {
      expect({
        providerKey: descriptor.providerKey,
        manifestEntry: manifestByKey.get(descriptor.providerKey)
      }).toEqual({
        providerKey: descriptor.providerKey,
        manifestEntry: expect.objectContaining({ key: descriptor.providerKey })
      });
    }
  });

  it('pins a full commit SHA and non-empty source paths for every descriptor', () => {
    for (const descriptor of descriptors) {
      const evidence = descriptor.versionEvidence;
      expect({
        providerKey: descriptor.providerKey,
        commit: evidence.commit
      }).toEqual({
        providerKey: descriptor.providerKey,
        commit: expect.stringMatching(/^[0-9a-f]{40}$/)
      });
      expect(evidence.sourcePaths.length).toBeGreaterThan(0);
      expect(evidence.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['high', 'medium', 'low']).toContain(evidence.confidence);
    }
  });

  it('agrees with the maintained manifest on repository and branch', () => {
    for (const descriptor of descriptors) {
      const manifestEntry = manifestByKey.get(descriptor.providerKey);
      if (!manifestEntry) {
        continue;
      }
      expect({
        providerKey: descriptor.providerKey,
        descriptorRepo: descriptor.versionEvidence.repository,
        manifestRepo: manifestEntry.url
      }).toEqual({
        providerKey: descriptor.providerKey,
        descriptorRepo: manifestEntry.url,
        manifestRepo: manifestEntry.url
      });
      expect(descriptor.versionEvidence.branch).toBe(manifestEntry.branch);
    }
  });

  it('requires fail-closed drift contracts for automatically configured providers', () => {
    for (const descriptor of descriptors) {
      if (descriptor.support !== 'automatic') {
        continue;
      }
      expect({
        providerKey: descriptor.providerKey,
        failClosed: descriptor.drift.failClosedOnMissingEvidence
      }).toEqual({
        providerKey: descriptor.providerKey,
        failClosed: true
      });
      expect(descriptor.drift.sourceSymbols.length).toBeGreaterThan(0);
    }
  });

  it('pins Copilot to the ACTIVE microsoft/vscode source, not the archived repo', () => {
    const copilot = descriptors.find(descriptor => descriptor.providerKey === 'github-copilot')!;
    expect(copilot.versionEvidence.repository).toBe('https://github.com/microsoft/vscode.git');
    expect(copilot.versionEvidence.repository).not.toContain('vscode-copilot-chat');
    expect(copilot.drift.notes.join(' ')).toContain('ACTIVE Copilot implementation in microsoft/vscode');

    const manifestEntry = manifestByKey.get('github-copilot')!;
    expect(manifestEntry.url).toBe('https://github.com/microsoft/vscode.git');
    expect(manifestEntry.status).toBe('active');
  });

  it('declares the archived-repo status for retired references', () => {
    const roo = descriptors.find(descriptor => descriptor.providerKey === 'roo-code')!;
    const manifestEntry = manifestByKey.get('roo-code')!;
    expect(manifestEntry.status).not.toBe('active');
    expect(roo.support).toBe('unsupported');
  });
});

describe('per-capability support states', () => {
  it('declares explicit per-field support for every automatically configured provider', () => {
    for (const descriptor of descriptors) {
      if (descriptor.support !== 'automatic') {
        continue;
      }
      for (const field of descriptor.fields) {
        const isCredential = field.secret === true;
        // Credential fields in automatic providers must be automatic
        // (target-persisted) or external — never silently automatic-by-default
        // when the provider stores auth elsewhere.
        if (isCredential && field.valueKind !== 'string') {
          expect({ providerKey: descriptor.providerKey, field: field.field, support: field.support })
            .toEqual({ providerKey: descriptor.providerKey, field: field.field, support: 'external' });
        }
      }
    }
  });

  it('never marks a guided/unsupported provider field as automatic', () => {
    for (const descriptor of descriptors) {
      if (descriptor.support === 'automatic') {
        continue;
      }
      for (const field of descriptor.fields) {
        expect({ providerKey: descriptor.providerKey, field: field.path, support: field.support })
          .not.toEqual({ providerKey: descriptor.providerKey, field: field.path, support: 'automatic' });
      }
    }
  });
});
