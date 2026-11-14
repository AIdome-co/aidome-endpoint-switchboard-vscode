/**
 * Idempotency tests: applying the same automatic provider configuration
 * twice must produce no further semantic change on the second run.
 */

import { describe, it, expect } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { parseDocument } from 'yaml';
import { renderConfigFileContent } from '../../src/core/providerConfig';
import { buildCodexConfigContent } from '../../src/adapters/codex/codexConfigPatcher';
import { buildClaudeCodeSettingsContent } from '../../src/adapters/claudeCode/claudeCodeConfigPatcher';
import { buildKiloConfigContent } from '../../src/adapters/kilocode/kiloConfigPatcher';
import { buildContinueConfigContent } from '../../src/adapters/continue/continueConfigPatcher';

const BASE = 'https://gateway.example.com/v1';

function expectSameOutput(first: string, second: string): void {
  expect(second).toBe(first);
}

describe('idempotency — apply twice produces no further change', () => {
  it('Continue (YAML)', () => {
    const existing = 'models:\n  - name: AIdome Gateway\n    title: AIdome Gateway\n    provider: openai\n    apiBase: https://stale.example.com/v1\ncustom: true\n';
    const first = buildContinueConfigContent(BASE, existing, 'yaml');
    const second = buildContinueConfigContent(BASE, first, 'yaml');
    expectSameOutput(first, second);

    const parsed = parseDocument(second).toJSON() as Record<string, unknown>;
    expect(parsed.custom).toBe(true);
    expect((parsed.models as Array<Record<string, unknown>>)).toHaveLength(1);
  });

  it('Continue (legacy JSONC)', () => {
    const existing = '{"models":[{"name":"AIdome Gateway","title":"AIdome Gateway","provider":"openai","apiBase":"https://stale.example.com/v1"}],"custom":true}';
    const first = buildContinueConfigContent(BASE, existing, 'jsonc');
    const second = buildContinueConfigContent(BASE, first, 'jsonc');
    expectSameOutput(first, second);
  });

  it('Codex (TOML)', () => {
    const existing = 'model = "gateway-model"\n\n[model_providers.other]\nbase_url = "https://other.example/v1"\n';
    const first = buildCodexConfigContent(BASE, existing, 'gateway-model');
    const second = buildCodexConfigContent(BASE, first, 'gateway-model');
    expectSameOutput(first, second);

    const parsed = parseToml(second) as Record<string, unknown>;
    expect(parsed.model).toBe('gateway-model');
    expect((parsed.model_providers as Record<string, unknown>).other).toBeDefined();
  });

  it('Claude Code (settings.json)', () => {
    const existing = '{"env":{"ANTHROPIC_BASE_URL":"https://old.example.com/v1","EXISTING":"kept"},"other":true}';
    const first = buildClaudeCodeSettingsContent(BASE, existing);
    const second = buildClaudeCodeSettingsContent(BASE, first);
    expectSameOutput(first, second);
    expect(second).toContain('EXISTING');
  });

  it('Kilo (JSONC)', () => {
    const existing = '{"provider":{"other":{"name":"Other","options":{"baseURL":"https://other.example/v1"}}}}';
    const first = buildKiloConfigContent(BASE, existing);
    const second = buildKiloConfigContent(BASE, first);
    expectSameOutput(first, second);
    expect(second).toContain('Other');
  });

  it('generic JSON object driver', () => {
    const opts = {
      driver: 'json-object' as const,
      format: 'json' as const,
      patches: [
        { path: ['gateway', 'baseUrl'], source: 'baseUrl' as const },
        { path: ['gateway', 'flavor'], source: undefined, value: 'custom', setWhenMissing: true }
      ]
    };
    const first = renderConfigFileContent({ baseUrl: BASE, existingContent: '{"unrelated":1}', format: 'json', options: opts });
    const second = renderConfigFileContent({ baseUrl: BASE, existingContent: first, format: 'json', options: opts });
    expectSameOutput(first, second);
  });
});
