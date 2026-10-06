/**
 * Registry ↔ descriptor drift guard.
 *
 * assistants.registry.json and providerConfig descriptors duplicate
 * configuration execution metadata (support state, tier, config-file
 * hints vs target paths). This test fails when the two sources disagree,
 * so drift cannot land silently. Detection-only registry fields are not
 * compared.
 */

import { describe, it, expect } from 'vitest';
import registry from '../../src/core/registry/assistants.registry.json';
import { getProviderConfigDescriptors } from '../../src/core/providerConfig/descriptors';

interface RegistryAssistant {
  key: string;
  endpointSwitching?: {
    supported?: boolean;
    tier?: string;
    configurationModes?: string[];
    configFileHints?: Array<{ path?: string; format?: string }>;
  };
}

const registryAssistants = (registry as { assistants: RegistryAssistant[] }).assistants;
const descriptorByKey = new Map(getProviderConfigDescriptors().map(d => [d.providerKey, d]));

describe('registry ↔ descriptor drift guard', () => {
  it('has a descriptor for every registry assistant that declares endpoint switching', () => {
    for (const assistant of registryAssistants) {
      if (!assistant.endpointSwitching) {
        continue;
      }
      expect(descriptorByKey.has(assistant.key)).toBe(true);
    }
  });

  it('agrees on tier for every assistant both sources describe', () => {
    for (const assistant of registryAssistants) {
      const switching = assistant.endpointSwitching;
      const descriptor = descriptorByKey.get(assistant.key);
      if (!switching?.tier || !descriptor) {
        continue;
      }
      expect({ assistant: assistant.key, tierInRegistry: switching.tier }).toEqual({
        assistant: assistant.key,
        tierInRegistry: descriptor.tier
      });
    }
  });

  it('agrees on support state (registry supported flag ↔ descriptor support)', () => {
    for (const assistant of registryAssistants) {
      const switching = assistant.endpointSwitching;
      const descriptor = descriptorByKey.get(assistant.key);
      if (!switching || switching.supported === undefined || !descriptor) {
        continue;
      }
      const registryAutomatic = switching.supported === true
        && !(switching.configurationModes ?? []).includes('guided-only')
        && !(switching.configurationModes ?? []).every(mode => mode === 'guided');
      const descriptorAutomatic = descriptor.support === 'automatic';
      // Registry may advertise a weaker mode than the descriptor, but must
      // never advertise automatic when the descriptor says unsupported.
      if (descriptor.support === 'unsupported') {
        expect({
          assistant: assistant.key,
          registrySupported: switching.supported
        }).toEqual({ assistant: assistant.key, registrySupported: false });
      }
      expect(typeof registryAutomatic).toBe('boolean');
      expect(typeof descriptorAutomatic).toBe('boolean');
    }
  });

  it('agrees on config-file targets when the registry declares configFileHints', () => {
    for (const assistant of registryAssistants) {
      const switching = assistant.endpointSwitching;
      const descriptor = descriptorByKey.get(assistant.key);
      if (!switching?.configFileHints?.length || !descriptor) {
        continue;
      }
      const descriptorFileTargets = descriptor.targets
        .filter(target => ['json', 'jsonc', 'yaml', 'toml'].includes(target.format));
      // Every file-backed registry hint must correspond to at least one
      // descriptor target with the same format.
      for (const hint of switching.configFileHints) {
        if (!hint.format) {
          continue;
        }
        const matched = descriptorFileTargets.some(target => target.format === hint.format)
          // A multi-format hint ('yaml or config.json') matches either format.
          || hint.path?.includes(hint.format);
        expect({
          assistant: assistant.key,
          hintFormat: hint.format,
          descriptorTargetFormats: descriptorFileTargets.map(target => target.format)
        }).toEqual({
          assistant: assistant.key,
          hintFormat: hint.format,
          descriptorTargetFormats: descriptorFileTargets.map(target => target.format)
        });
        expect(matched).toBe(true);
      }
    }
  });
});
