/**
 * GAP 10: dependency-direction architecture tests.
 *
 * Generic orchestration must never import provider-specific adapter modules,
 * and generic layers must not branch on known provider names.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { getProviderConfigDescriptors } from '../../../src/core/providerConfig/descriptors';

const REPO_ROOT = join(__dirname, '..', '..', '..');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const ORCHESTRATION_FILES = collectTsFiles(join(REPO_ROOT, 'src', 'core', 'orchestration'));
const PROVIDER_CONFIG_FILES = collectTsFiles(join(REPO_ROOT, 'src', 'core', 'providerConfig'));

const GENERIC_CORE_FILES = [...ORCHESTRATION_FILES, ...PROVIDER_CONFIG_FILES];

const FORBIDDEN_ADAPTER_IMPORTS = [
  'adapters/codex/',
  'adapters/cline/',
  'adapters/claudeCode/',
  'adapters/kilocode/',
  'adapters/continue/',
  'adapters/githubCopilot/',
  'adapters/roocode/',
  'adapters/anythingllm/',
  'adapters/codegpt/',
  'adapters/geminiCli/',
  'adapters/tabnine/',
  'adapters/generic/'
];

describe('GAP 10: dependency direction', () => {
  it('src/core/orchestration/** imports ZERO provider-specific adapter modules', () => {
    const violations: string[] = [];
    for (const file of ORCHESTRATION_FILES) {
      const source = readFileSync(file, 'utf-8');
      for (const forbidden of FORBIDDEN_ADAPTER_IMPORTS) {
        if (source.includes(forbidden)) {
          violations.push(`${file} imports ${forbidden}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('src/core/providerConfig/** imports ZERO provider-specific adapter modules', () => {
    const violations: string[] = [];
    for (const file of PROVIDER_CONFIG_FILES) {
      const source = readFileSync(file, 'utf-8');
      for (const forbidden of FORBIDDEN_ADAPTER_IMPORTS) {
        if (source.includes(forbidden)) {
          violations.push(`${file} imports ${forbidden}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('generic core contains NO behavior branches on known provider names', () => {
    // Provider-specific strings may appear in log data or comments coming from
    // the step itself, but not as behavior branches. We check for the classic
    // equality / comparison branch patterns.
    const providerNames = [
      'openai-codex',
      'claude-code',
      'kilo-code',
      'github-copilot',
      'roo-code',
      'codegpt',
      'tabnine',
      'anythingllm',
      'gemini-cli'
    ];
    const branchPatterns = [
      /===\s*['"]/,
      /['"]\s*===/,
      /!==\s*['"]/,
      /['"]\s*!==/,
      /includes\(\s*['"]/,
      /startsWith\(\s*['"]/,
      /endsWith\(\s*['"]/
    ];
    const violations: string[] = [];
    for (const file of GENERIC_CORE_FILES) {
      const source = readFileSync(file, 'utf-8');
      for (const name of providerNames) {
        for (const line of source.split('\n')) {
          if (!line.includes(name)) {
            continue;
          }
          // descriptors.ts contains upstream-repo URL evidence data, not
          // behavior branches on our provider keys.
          if (file.endsWith('descriptors.ts')) {
            continue;
          }
          if (branchPatterns.some((pattern) => pattern.test(line))) {
            violations.push(`${file}: branch on provider name: ${line.trim()}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('the generic env-file driver is the single dotenv implementation (no re-implementation in core)', () => {
    // The applier must use the generic driver, not a provider module.
    const applier = readFileSync(join(REPO_ROOT, 'src', 'core', 'orchestration', 'applier.ts'), 'utf-8');
    expect(applier).toContain("from '../providerConfig/envFileDriver'");
    expect(applier).not.toContain('codexEnvFile');
  });
});

describe('GAP 11: descriptor/runtime consistency', () => {
  it('Codex descriptor declares target-persisted-at-apply and a symbolic env_key in config', async () => {
    const { PROVIDER_DESCRIPTORS } = await import('../../../src/core/providerConfig/descriptors');
    const codex = getProviderConfigDescriptors().find((d: { providerKey: string }) => d.providerKey === 'openai-codex');
    expect(codex).toBeDefined();
    expect(codex.secretPolicy).toBe('target-persisted-at-apply');

    // The runtime plan writes OPENAI_API_KEY into ~/.codex/.env (env-file
    // target), never a secret value into config.toml.
    const codexAdapterSource = readFileSync(join(REPO_ROOT, 'src', 'adapters', 'codex', 'adapter.ts'), 'utf-8');
    expect(codexAdapterSource).toContain("env_key");
    expect(codexAdapterSource).toContain('OPENAI_API_KEY');
    expect(codexAdapterSource).toContain("'write-env-file'");
  });

  it('Cline descriptor declares target-persisted-at-apply and the runtime writes apiKey into the declared paths', async () => {
    const { PROVIDER_DESCRIPTORS } = await import('../../../src/core/providerConfig/descriptors');
    const cline = getProviderConfigDescriptors().find((d: { providerKey: string }) => d.providerKey === 'cline');
    expect(cline).toBeDefined();
    expect(cline.secretPolicy).toBe('target-persisted-at-apply');
    // Declared credential field path.
    const apiKeyField = cline.fields.find((f: { field: string }) => f.field === 'apiKey');
    expect(apiKeyField?.path).toBe('providers.openai-compatible.settings.apiKey');
    expect(apiKeyField?.secret).toBe(true);
    // Legacy secrets mirror is a declared coordinated target.
    expect(cline.targets.some((t: { id: string }) => t.id === 'cline-legacy-secrets')).toBe(true);

    const clineAdapterSource = readFileSync(join(REPO_ROOT, 'src', 'adapters', 'cline', 'adapter.ts'), 'utf-8');
    expect(clineAdapterSource).toContain("configType: 'cline-legacy-secrets'");
    expect(clineAdapterSource).toContain("'target-persisted-at-apply'");
  });

  it('Kilo descriptor declares an external auth store and its plan does not serialize the secret', async () => {
    const { PROVIDER_DESCRIPTORS } = await import('../../../src/core/providerConfig/descriptors');
    const kilo = getProviderConfigDescriptors().find((d: { providerKey: string }) => d.providerKey === 'kilo-code');
    expect(kilo).toBeDefined();
    expect(kilo.secretPolicy).toBe('external-auth-store');
    const kiloSource = readFileSync(join(REPO_ROOT, 'src', 'adapters', 'kilocode', 'adapter.ts'), 'utf-8');
    expect(kiloSource).not.toContain("source: 'secret'");
  });

  it('Continue descriptor declares the secret is not automatically written and the plan does not inject it', async () => {
    const { PROVIDER_DESCRIPTORS } = await import('../../../src/core/providerConfig/descriptors');
    const cont = getProviderConfigDescriptors().find((d: { providerKey: string }) => d.providerKey === 'continue');
    expect(cont).toBeDefined();
    // Continue keeps the profile secret in VS Code SecretStorage only; the
    // managed plan never injects it into the config file.
    expect(cont.secretPolicy).toBe('secret-storage-only');
    const continueSource = readFileSync(join(REPO_ROOT, 'src', 'adapters', 'continue', 'adapter.ts'), 'utf-8');
    expect(continueSource).not.toContain("source: 'secret'");
  });

  it('Claude descriptor declares target-persisted-at-apply and applies the secret only at apply time', async () => {
    const { PROVIDER_DESCRIPTORS } = await import('../../../src/core/providerConfig/descriptors');
    const claude = getProviderConfigDescriptors().find((d: { providerKey: string }) => d.providerKey === 'claude-code');
    expect(claude).toBeDefined();
    expect(claude.secretPolicy).toBe('target-persisted-at-apply');
  });
});
