import { describe, expect, it } from 'vitest';
import {
  buildContinueConfigContent,
  parseContinueConfigContent,
} from '../../src/adapters/continue/continueConfigPatcher';
import type { EndpointProfile } from '../../src/core/profiles/profileTypes';

describe('Continue config patcher', () => {
  it('writes a shared apiKey into a YAML anthropic model entry', () => {
    const profile: EndpointProfile = {
      id: 'profile-anthropic',
      name: 'Anthropic Profile',
      profileType: 'aidome',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'anthropic.messages',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = [
      'models:',
      '  - provider: anthropic',
      '    model: claude-sonnet-4-20250514',
    ].join('\n');

    const updated = buildContinueConfigContent(
      profile,
      existing,
      '/tmp/continue/config.yaml',
      '  aid_pat_test  '
    );

    const parsed = parseContinueConfigContent(updated, '/tmp/continue/config.yaml');
    const model = parsed.models?.[0];

    expect(model).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiBase: 'https://gateway.example.com/v1',
      apiKey: 'aid_pat_test',
    });
  });

  it('writes a shared apiKey into a JSON openai model entry', () => {
    const profile: EndpointProfile = {
      id: 'profile-openai',
      name: 'OpenAI Profile',
      profileType: 'aidome',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = JSON.stringify({
      models: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
        },
      ],
    });

    const updated = buildContinueConfigContent(
      profile,
      existing,
      '/tmp/continue/config.json',
      'aid_pat_test'
    );

    const parsed = parseContinueConfigContent(updated, '/tmp/continue/config.json');
    const model = parsed.models?.[0];

    expect(model).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiBase: 'https://gateway.example.com/v1',
      apiKey: 'aid_pat_test',
    });
  });

  it('removes a stale apiKey when no shared secret is available', () => {
    const profile: EndpointProfile = {
      id: 'profile-openai',
      name: 'OpenAI Profile',
      profileType: 'aidome',
      baseUrl: 'https://gateway.example.com/v1',
      dialect: 'openai.chat_completions',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const existing = JSON.stringify({
      models: [
        {
          provider: 'openai',
          model: 'gpt-4o-mini',
          apiBase: 'https://gateway.example.com/v1',
          apiKey: 'stale-key',
        },
      ],
    });

    const updated = buildContinueConfigContent(
      profile,
      existing,
      '/tmp/continue/config.json'
    );

    const parsed = parseContinueConfigContent(updated, '/tmp/continue/config.json');
    expect(parsed.models?.[0]?.apiKey).toBeUndefined();
  });
});