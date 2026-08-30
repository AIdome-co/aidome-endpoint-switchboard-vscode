/** Provider configuration descriptors derived from the maintained provider manifest. */

import { ProviderConfigDescriptor } from './types';

const EVIDENCE_DATE = '2026-08-29';

function evidence(
  repository: string,
  commit: string,
  confidence: 'high' | 'medium' | 'low',
  sourcePaths: string[]
): ProviderConfigDescriptor['versionEvidence'] {
  return {
    repository,
    branch: repository.endsWith('anything-llm.git') || repository.endsWith('tabnine-vscode.git') ? 'master' : 'main',
    commit,
    observedAt: EVIDENCE_DATE,
    confidence,
    sourcePaths
  };
}

const DESCRIPTORS: ProviderConfigDescriptor[] = [
  {
    providerKey: 'github-copilot',
    displayName: 'GitHub Copilot',
    dialects: [{ dialect: 'github.copilot', preferred: true }],
    targets: [{
      id: 'copilot-advanced',
      format: 'vscode-settings',
      driver: 'vscode-setting',
      settingKey: 'github.copilot.advanced',
      priority: 1
    }],
    fields: [{
      field: 'baseUrl',
      path: 'debug.overrideProxyUrl',
      valueKind: 'string',
      requiredFor: ['github.copilot'],
      preserveUnknown: true
    }],
    driver: 'vscode-setting',
    support: 'automatic',
    tier: 'B',
    secretPolicy: 'secret-storage-only',
    reload: 'restart-extension',
    discovery: {
      extensionIds: ['GitHub.copilot', 'GitHub.copilot-chat'],
      notes: ['Uses the undocumented Copilot proxy override; custom BYOK providers are extension contributions.']
    },
    verification: {
      requiredFields: ['debug.overrideProxyUrl'],
      exactUrlMatch: true,
      selectedProviderRequired: false,
      protocolRequired: false,
      notes: ['Remain Tier B because the override is an internal/legacy setting.']
    },
    drift: {
      sourceSymbols: ['ConfigKey.DebugOverrideProxyUrl', 'advanced.debug.overrideProxyUrl'],
      failClosedOnMissingEvidence: true,
      notes: ['Re-check upstream source after Copilot updates.']
    },
    versionEvidence: evidence(
      'https://github.com/microsoft/vscode-copilot-chat.git',
      '5863f5a7088958050792b5dccbe8b46c6e13eccc',
      'medium',
      ['src/extension/completions-core/vscode-node/lib/src/config.ts', 'src/platform/configuration/common/configurationService.ts']
    ),
    limitations: ['Undocumented internal setting may be removed or renamed.']
  },
  {
    providerKey: 'cline',
    displayName: 'Cline',
    dialects: [
      { dialect: 'openai.chat_completions', preferred: true },
      { dialect: 'openai.responses' },
      { dialect: 'anthropic.messages' },
      { dialect: 'google.gemini.generate_content' }
    ],
    targets: [
      { id: 'cline-provider-settings', format: 'json', driver: 'json-object', path: '<CLINE_DATA_DIR>/settings/providers.json', priority: 1 },
      { id: 'cline-global-state', format: 'json', driver: 'json-object', path: '<CLINE_DATA_DIR>/globalState.json', priority: 2 }
    ],
    fields: [
      { field: 'baseUrl', path: 'providers.openai-compatible.settings.baseUrl', valueKind: 'string', requiredFor: ['openai.chat_completions'], preserveUnknown: true },
      { field: 'provider', path: 'globalState.planModeApiProvider', valueKind: 'string', requiredFor: ['openai.chat_completions'] },
      { field: 'provider', path: 'globalState.actModeApiProvider', valueKind: 'string', requiredFor: ['openai.chat_completions'] }
    ],
    driver: 'json-object',
    support: 'automatic',
    tier: 'A',
    secretPolicy: 'external-auth-store',
    reload: 'restart-extension',
    discovery: {
      extensionIds: ['saoudrizwan.claude-dev'],
      environmentOverrides: ['CLINE_DATA_DIR', 'CLINE_DIR', 'CLINE_PROVIDER_SETTINGS_PATH'],
      notes: ['VS Code and CLI use related but different provider-store contracts.']
    },
    verification: {
      requiredFields: ['providers.openai-compatible.settings.baseUrl', 'openAiBaseUrl', 'planModeApiProvider', 'actModeApiProvider'],
      exactUrlMatch: true,
      selectedProviderRequired: true,
      protocolRequired: false,
      notes: ['Provider settings and legacy global state must remain coherent.']
    },
    drift: {
      sourceSymbols: ['resolveDataDirFromEnv', 'ProviderSettingsManager', 'openAiBaseUrl'],
      failClosedOnMissingEvidence: true,
      notes: ['Keep the coordinated two-file policy dedicated to Cline.']
    },
    versionEvidence: evidence(
      'https://github.com/cline/cline.git',
      '48d63852745460ff0fa3dfcc0457bbe2493841de',
      'high',
      ['apps/vscode/src/shared/storage/storage-context.ts', 'apps/vscode/src/sdk/cline-session-factory.ts', 'apps/cli/DEVELOPMENT.md']
    ),
    limitations: ['Provider-store and legacy-state writes must be coordinated.']
  },
  {
    providerKey: 'roo-code',
    displayName: 'Roo Code',
    dialects: [{ dialect: 'openai.chat_completions', preferred: true }],
    targets: [{ id: 'roo-retired', format: 'ui', driver: 'guided-ui', priority: 1, requiresGuidance: true }],
    fields: [{ field: 'baseUrl', path: 'provider-profile.openAiBaseUrl', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'], secret: false }],
    driver: 'guided-ui',
    support: 'unsupported',
    tier: 'C',
    secretPolicy: 'external-auth-store',
    reload: 'unknown',
    discovery: { extensionIds: ['RooVeterinaryInc.roo-cline'], notes: ['Archived/defunct upstream; do not mutate guessed VS Code settings.'] },
    verification: { requiredFields: [], exactUrlMatch: false, selectedProviderRequired: false, protocolRequired: false, notes: ['Only detect and explain the retired target.'] },
    drift: { sourceSymbols: ['ProviderSettingsManager', 'retiredProviderNames'], failClosedOnMissingEvidence: true, notes: ['A supported fork needs a new descriptor and evidence.'] },
    versionEvidence: evidence('https://github.com/RooCodeInc/Roo-Code.git', 'b867ec9145750d0ae1ff7f02d35406e9bf2a0b16', 'high', ['src/package.json', 'src/core/config/ProviderSettingsManager.ts', 'src/api/index.ts']),
    limitations: ['Roo Code is archived and its provider profiles use SecretStorage.']
  },
  {
    providerKey: 'kilo-code',
    displayName: 'Kilo Code',
    dialects: [{ dialect: 'openai.chat_completions', preferred: true }, { dialect: 'openai.responses' }],
    targets: [{ id: 'kilo-provider-map', format: 'jsonc', driver: 'jsonc-provider-map', path: 'KILO_CONFIG or KILO_CONFIG_DIR candidate', priority: 1 }],
    fields: [
      { field: 'baseUrl', path: 'provider.<providerId>.options.baseURL', valueKind: 'string', requiredFor: ['openai.chat_completions'], preserveUnknown: true },
      { field: 'model', path: 'provider.<providerId>.models', valueKind: 'object', requiredFor: ['openai.chat_completions'], preserveUnknown: true },
      { field: 'apiKey', path: 'Kilo auth store', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'], secret: true }
    ],
    driver: 'jsonc-provider-map',
    support: 'automatic',
    tier: 'A',
    secretPolicy: 'external-auth-store',
    reload: 'restart-extension',
    discovery: { extensionIds: ['kilocode.kilo-code'], environmentOverrides: ['KILO_CONFIG', 'KILO_CONFIG_DIR', 'KILO_CONFIG_CONTENT'], notes: ['Config candidates and auth are managed by Kilo-specific code.'] },
    verification: { requiredFields: ['provider.<providerId>.options.baseURL'], exactUrlMatch: true, selectedProviderRequired: true, protocolRequired: false, notes: ['Verify auth-store association and target revision.'] },
    drift: { sourceSymbols: ['config-file.ts', 'client.auth.set', 'withCustomProviderDeletions'], failClosedOnMissingEvidence: true, notes: ['Never serialize a raw profile secret into env.'] },
    versionEvidence: evidence('https://github.com/Kilo-Org/kilocode.git', '5e02825c8c5318912e39fe0ceee46793589fae3f', 'high', ['packages/kilo-vscode/src/kilo-provider/config-file.ts', 'packages/kilo-vscode/src/provider-actions.ts', 'packages/kilo-vscode/src/shared/custom-provider.ts']),
    limitations: ['Multiple config candidates and an external auth API require dedicated policy.']
  },
  {
    providerKey: 'continue',
    displayName: 'Continue.dev',
    dialects: [{ dialect: 'openai.chat_completions', preferred: true }, { dialect: 'openai.responses' }, { dialect: 'anthropic.messages' }, { dialect: 'google.gemini.generate_content' }],
    targets: [
      { id: 'continue-primary-yaml', format: 'yaml', driver: 'yaml-model-array', path: '<CONTINUE_GLOBAL_DIR>/config.yaml', priority: 1 },
      { id: 'continue-legacy-json', format: 'jsonc', driver: 'yaml-model-array', path: '<CONTINUE_GLOBAL_DIR>/config.json', priority: 2 }
    ],
    fields: [
      { field: 'provider', path: 'models[].provider', valueKind: 'array-entry', requiredFor: ['openai.chat_completions'], preserveUnknown: true },
      { field: 'baseUrl', path: 'models[].apiBase', valueKind: 'array-entry', requiredFor: ['openai.chat_completions'], preserveUnknown: true },
      { field: 'apiKey', path: 'models[].apiKey', valueKind: 'array-entry', requiredFor: ['openai.chat_completions'], secret: true, preserveUnknown: true },
      { field: 'protocol', path: 'models[].useResponsesApi', valueKind: 'array-entry', requiredFor: ['openai.responses'], preserveUnknown: true }
    ],
    driver: 'yaml-model-array',
    support: 'automatic',
    tier: 'A',
    secretPolicy: 'secret-storage-only',
    reload: 'restart-extension',
    discovery: { extensionIds: ['Continue.continue'], environmentOverrides: ['CONTINUE_GLOBAL_DIR'], notes: ['YAML is primary when present; legacy JSONC remains supported.'] },
    verification: { requiredFields: ['models[].provider', 'models[].apiBase'], exactUrlMatch: true, selectedProviderRequired: true, protocolRequired: false, notes: ['Verify the exact model entry changed by the plan.'] },
    drift: { sourceSymbols: ['getPrimaryConfigFilePath', 'resolveSerializedConfig', 'LLM.apiBase'], failClosedOnMissingEvidence: true, notes: ['Keep YAML/JSON behavior covered by fixtures.'] },
    versionEvidence: evidence('https://github.com/continuedev/continue.git', '5522c6f44ca0ac3528b37244818fbfa39b5af470', 'high', ['core/util/paths.ts', 'core/config/load.ts', 'core/config/types.ts', 'docs/customize/model-providers/top-level/openai.mdx']),
    limitations: ['Comment preservation depends on the YAML/JSONC serializer.']
  },
  {
    providerKey: 'claude-code',
    displayName: 'Claude Code',
    dialects: [{ dialect: 'anthropic.messages', preferred: true }, { dialect: 'bedrock.invoke_model' }, { dialect: 'vertex.raw_predict' }],
    targets: [{ id: 'claude-settings', format: 'json', driver: 'json-object', path: '<CLAUDE_CONFIG_DIR>/settings.json', priority: 1 }],
    fields: [
      { field: 'baseUrl', path: 'env.ANTHROPIC_BASE_URL', valueKind: 'string', requiredFor: ['anthropic.messages'], preserveUnknown: true },
      { field: 'apiKey', path: 'env.ANTHROPIC_AUTH_TOKEN', valueKind: 'string', requiredFor: ['anthropic.messages'], secret: true },
      { field: 'provider', path: 'env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY', valueKind: 'string', requiredFor: ['anthropic.messages'] }
    ],
    driver: 'json-object',
    support: 'automatic',
    tier: 'A',
    secretPolicy: 'target-persisted-at-apply',
    reload: 'restart-process',
    discovery: { extensionIds: ['anthropic.claude-code'], cliCommands: ['claude'], environmentOverrides: ['CLAUDE_CONFIG_DIR'], notes: ['Public upstream evidence is documentation/changelog-derived.'] },
    verification: { requiredFields: ['env.ANTHROPIC_BASE_URL', 'env.ANTHROPIC_AUTH_TOKEN'], exactUrlMatch: true, selectedProviderRequired: false, protocolRequired: true, notes: ['Token is written only at apply time because Claude consumes the settings contract.'] },
    drift: { sourceSymbols: ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'], failClosedOnMissingEvidence: false, notes: ['Runtime source is not present in the public checkout.'] },
    versionEvidence: evidence('https://github.com/anthropics/claude-code.git', 'f1af9b1f4b1fd4c776135381606edada82ef638e', 'medium', ['.devcontainer/devcontainer.json', 'CHANGELOG.md']),
    limitations: ['Exact runtime/version behavior must be maintained from documentation evidence.']
  },
  {
    providerKey: 'openai-codex',
    displayName: 'OpenAI Codex',
    dialects: [{ dialect: 'openai.responses', protocol: 'responses', preferred: true }],
    targets: [{ id: 'codex-config', format: 'toml', driver: 'toml-table', path: '~/.codex/config.toml', priority: 1 }],
    fields: [
      { field: 'provider', path: 'model_provider', valueKind: 'string', requiredFor: ['openai.responses'] },
      { field: 'baseUrl', path: 'model_providers.<name>.base_url', valueKind: 'string', requiredFor: ['openai.responses'], preserveUnknown: true },
      { field: 'protocol', path: 'model_providers.<name>.wire_api', valueKind: 'string', requiredFor: ['openai.responses'] },
      { field: 'apiKey', path: 'model_providers.<name>.env_key', valueKind: 'string', requiredFor: ['openai.responses'], secret: true }
    ],
    driver: 'toml-table',
    support: 'automatic',
    tier: 'A',
    secretPolicy: 'secret-storage-only',
    reload: 'restart-process',
    discovery: { cliCommands: ['codex'], notes: ['User-defined providers are under model_providers, not providers.'] },
    verification: { requiredFields: ['model_provider', 'model_providers.<name>.base_url', 'model_providers.<name>.wire_api'], exactUrlMatch: true, selectedProviderRequired: true, protocolRequired: true, notes: ['Reject legacy providers table and chat wire API.'] },
    drift: { sourceSymbols: ['ConfigToml.model_providers', 'ModelProviderInfo.wire_api', 'WireApi::Responses'], failClosedOnMissingEvidence: true, notes: ['Keep the schema pinned to the Rust implementation.'] },
    versionEvidence: evidence('https://github.com/openai/codex.git', 'f5636bb733c4653a6b91413fed1aaf8842374f2e', 'high', ['codex-rs/config/src/config_toml.rs', 'codex-rs/model-provider-info/src/lib.rs', 'codex-rs/model-provider/src/provider.rs']),
    limitations: ['Process environment authentication remains guided unless Switchboard owns process launch.']
  },
  {
    providerKey: 'gemini-cli',
    displayName: 'Gemini CLI',
    dialects: [{ dialect: 'google.gemini.generate_content', preferred: true }],
    targets: [{ id: 'gemini-gateway-env', format: 'environment', driver: 'environment-binding', environmentVariables: ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY'], priority: 1, requiresGuidance: true }],
    fields: [
      { field: 'baseUrl', path: 'GOOGLE_GEMINI_BASE_URL', valueKind: 'env-binding', requiredFor: ['google.gemini.generate_content'] },
      { field: 'apiKey', path: 'GEMINI_API_KEY', valueKind: 'env-binding', requiredFor: ['google.gemini.generate_content'], secret: true }
    ],
    driver: 'environment-binding',
    support: 'guided',
    tier: 'C',
    secretPolicy: 'secret-storage-only',
    reload: 'restart-process',
    discovery: { cliCommands: ['gemini'], environmentOverrides: ['GOOGLE_GEMINI_BASE_URL'], notes: ['Switchboard cannot change a running CLI parent environment.'] },
    verification: { requiredFields: ['GOOGLE_GEMINI_BASE_URL'], exactUrlMatch: true, selectedProviderRequired: false, protocolRequired: true, notes: ['Automatic support requires a Switchboard-owned launcher.'] },
    drift: { sourceSymbols: ['AuthType.GATEWAY', 'GOOGLE_GEMINI_BASE_URL', 'createContentGeneratorConfig'], failClosedOnMissingEvidence: true, notes: ['Keep process ownership explicit.'] },
    versionEvidence: evidence('https://github.com/google-gemini/gemini-cli.git', '0bd1d439751478771c45d3d0895a6a9760554bf4', 'high', ['packages/core/src/core/contentGenerator.ts', 'packages/cli/src/config/auth.ts', 'docs/reference/configuration.md']),
    limitations: ['Environment guidance cannot prove persistent CLI configuration.']
  },
  {
    providerKey: 'codegpt',
    displayName: 'CodeGPT',
    dialects: [{ dialect: 'openai.chat_completions', preferred: true }],
    targets: [{ id: 'codegpt-ui', format: 'ui', driver: 'guided-ui', priority: 1, requiresGuidance: true }],
    fields: [
      { field: 'baseUrl', path: 'Manage my AI Models', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'] },
      { field: 'apiKey', path: 'Manage my AI Models', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'], secret: true }
    ],
    driver: 'guided-ui',
    support: 'guided',
    tier: 'B',
    secretPolicy: 'external-auth-store',
    reload: 'restart-extension',
    discovery: { extensionIds: ['DanielSanMedium.dscodegpt'], notes: ['Legacy public source does not prove current marketplace UI schema.'] },
    verification: { requiredFields: [], exactUrlMatch: false, selectedProviderRequired: true, protocolRequired: false, notes: ['Do not mutate arbitrary discovered settings.'] },
    drift: { sourceSymbols: ['package.json codegpt.apiKey', 'src/extension.ts'], failClosedOnMissingEvidence: true, notes: ['Current UI behavior requires separately captured evidence.'] },
    versionEvidence: evidence('https://github.com/timkmecl/codegpt.git', 'ffd460a5831c27839c50d62e68e1ab85b1dd41c0', 'low', ['package.json', 'src/extension.ts']),
    limitations: ['Current marketplace model-management behavior is not represented by the legacy public checkout.']
  },
  {
    providerKey: 'anythingllm',
    displayName: 'AnythingLLM',
    dialects: [{ dialect: 'openai.chat_completions', preferred: true }],
    targets: [{ id: 'anythingllm-ui', format: 'ui', driver: 'guided-ui', priority: 1, requiresGuidance: true }],
    fields: [
      { field: 'baseUrl', path: 'GenericOpenAiBasePath', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'] },
      { field: 'model', path: 'GenericOpenAiModelPref', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'] },
      { field: 'apiKey', path: 'GenericOpenAiApiKey', valueKind: 'ui-only', requiredFor: ['openai.chat_completions'], secret: true }
    ],
    driver: 'guided-ui',
    support: 'guided',
    tier: 'B',
    secretPolicy: 'external-auth-store',
    reload: 'restart-application',
    discovery: { notes: ['Desktop/server application; no local VS Code config target.'] },
    verification: { requiredFields: [], exactUrlMatch: false, selectedProviderRequired: true, protocolRequired: false, notes: ['Separate app detection from endpoint configuration verification.'] },
    drift: { sourceSymbols: ['GenericOpenAiOptions', 'GenericOpenAiBasePath', 'GenericOpenAiModelPref'], failClosedOnMissingEvidence: true, notes: ['Guidance should use the app UI or deployment environment.'] },
    versionEvidence: evidence('https://github.com/Mintplex-Labs/anything-llm.git', 'bc71392bea50f70a37da373375206e8d8e9df589', 'high', ['server/models/systemSettings.js', 'frontend/src/components/LLMSelection/GenericOpenAiOptions/index.jsx', 'server/utils/AiProviders/genericOpenAi/index.js']),
    limitations: ['Configuration is external to the VS Code extension.']
  },
  {
    providerKey: 'tabnine',
    displayName: 'Tabnine',
    dialects: [{ dialect: 'tabnine.proprietary', preferred: true }],
    targets: [{ id: 'tabnine-enterprise', format: 'ui', driver: 'guided-ui', settingKey: 'tabnineSelfHostedUpdater.serverUrl', priority: 1, requiresGuidance: true }],
    fields: [{ field: 'baseUrl', path: 'tabnineSelfHostedUpdater.serverUrl', valueKind: 'ui-only', requiredFor: ['tabnine.proprietary'] }],
    driver: 'guided-ui',
    support: 'unsupported',
    tier: 'C',
    secretPolicy: 'none',
    reload: 'restart-extension',
    discovery: { extensionIds: ['TabNine.tabnine-vscode'], notes: ['Enterprise server URL is not an OpenAI endpoint.'] },
    verification: { requiredFields: [], exactUrlMatch: false, selectedProviderRequired: false, protocolRequired: true, notes: ['Do not map the enterprise server URL to AIdome.'] },
    drift: { sourceSymbols: ['SELF_HOSTED_SERVER_CONFIGURATION', 'serverUrl'], failClosedOnMissingEvidence: true, notes: ['Backend protocol remains proprietary.'] },
    versionEvidence: evidence('https://github.com/codota/tabnine-vscode.git', '6312d789b34f6c0e54f47ec2d3a7ffc2056cd000', 'high', ['src/enterprise/consts.ts', 'src/enterprise/update/serverUrl.ts', 'src/enterprise/extension.ts']),
    limitations: ['Only Tabnine Enterprise infrastructure can be configured.']
  }
];

const DESCRIPTOR_MAP = new Map(DESCRIPTORS.map(descriptor => [descriptor.providerKey, descriptor]));

/** Returns all provider descriptors in manifest order. */
export function getProviderConfigDescriptors(): readonly ProviderConfigDescriptor[] {
  return DESCRIPTORS;
}

/** Returns a descriptor by manifest/provider key. */
export function getProviderConfigDescriptor(providerKey: string): ProviderConfigDescriptor | undefined {
  return DESCRIPTOR_MAP.get(providerKey);
}
