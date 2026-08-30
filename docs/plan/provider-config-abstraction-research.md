# Provider configuration abstraction research

Status: research and architecture only. No refactor, commit, or push was performed.

## Executive recommendation

**GO WITH CHANGES.** Introduce a typed provider configuration descriptor and a small set of reusable, capability-oriented drivers, but do not replace the adapters with a single “write base URL” abstraction. The abstraction should own target discovery, typed field binding, safe planning, backup-before-write, secret resolution, and verification. Provider-specific adapters should remain as thin policy/translation modules wherever the upstream application has a private state store, a process-environment contract, a nonstandard protocol, or version-dependent UI.

The first migration wave should be:

- Continue, after adding JSONC/YAML-aware file selection and model-array binding.
- GitHub Copilot, as a narrow object-setting/proxy-override descriptor with an explicit Tier B warning.
- AnythingLLM, as guided-only UI today; it has a clear Generic OpenAI contract but no supported local config target in the desktop application.

The following should not be forced through a generic file driver in the first wave:

- Cline: two coordinated files plus a newer provider store and CLI-specific path override.
- Kilo Code: config discovery is broad and authentication is maintained through Kilo’s auth API/state, not the env literal currently emitted by Switchboard.
- Roo Code: the referenced upstream is archived/defunct and current provider profiles are stored in VS Code SecretStorage.
- Claude Code: shared settings plus process-facing environment variables and a runtime not present in the public upstream checkout.
- OpenAI Codex: TOML schema drift makes the current adapter materially wrong; it needs a dedicated migration first.
- Gemini CLI: a custom endpoint is possible through process environment variables, but the existing plan applier cannot configure the CLI’s parent process.
- CodeGPT and Tabnine: current public evidence is either legacy or proprietary and does not justify automated endpoint mutation.

The existing adapter interface remains useful at the orchestration boundary. The proposed descriptor should be an internal configuration capability used by adapters, not a replacement for AssistantAdapter.

## Scope, method, and evidence policy

The source of truth for provider scope is maintenance/provider-repositories.json: 11 providers. I ran:

~~~
python3 maintenance/sync_provider_refs.py --json
~~~

The synchronization completed successfully for all 11 repositories. The synchronizer fetched each upstream remote and recorded the current upstream head in /home/aidome-dev/pub-refs/switchboard-provider-manifest.json. Source claims below use those upstream heads, not the possibly stale local maintenance checkout. Some local maintenance branches were behind the fetched upstream head; no provider checkout was modified to conduct this research.

### Synchronized upstream commits

| Provider | Upstream commit used | Manifest status | Evidence confidence caveat |
|---|---|---|---|
| GitHub Copilot | 5863f5a7088958050792b5dccbe8b46c6e13eccc | archived-reference | Official public source, but the repository describes Copilot Chat internals rather than the installed extension contract. |
| Cline | 48d63852745460ff0fa3dfcc0457bbe2493841de | active | Strong source evidence; VS Code, CLI, and shared core have different storage paths/contracts. |
| Roo Code | b867ec9145750d0ae1ff7f02d35406e9bf2a0b16 | archived-reference | Strong historical source evidence; current registry claims are not safe for a maintained adapter. |
| Kilo Code | 5e02825c8c5318912e39fe0ceee46793589fae3f | active | Strong source evidence; the local maintenance checkout was stale, so the fetched upstream head was used. |
| Continue.dev | 5522c6f44ca0ac3528b37244818fbfa39b5af470 | active | Strong source evidence; JSON and YAML configuration are both first-class in current code. |
| Claude Code | f1af9b1f4b1fd4c776135381606edada82ef638e | active | Medium confidence for runtime semantics: this public checkout contains documentation/changelog evidence but not the Claude Code runtime implementation. |
| OpenAI Codex | f5636bb733c4653a6b91413fed1aaf8842374f2e | active | Strong source evidence; current TOML schema differs from Switchboard’s adapter. |
| Gemini CLI | 0bd1d439751478771c45d3d0895a6a9760554bf4 | active | Strong source evidence for environment/auth behavior. |
| CodeGPT | ffd460a5831c27839c50d62e68e1ab85b1dd41c0 | legacy-reference | Strong evidence for this old public repository, weak evidence for current CodeGPT marketplace behavior. |
| AnythingLLM | bc71392bea50f70a37da373375206e8d8e9df589 | active | Strong source evidence for desktop/server configuration and Generic OpenAI fields. |
| Tabnine | 6312d789b34f6c0e54f47ec2d3a7ffc2056cd000 | legacy-reference | Strong client evidence; backend protocol remains proprietary. |

Evidence confidence means confidence that the cited upstream code currently implements the stated behavior, not confidence that every installed marketplace version is identical.

## Current Switchboard architecture and abstraction boundary

The current flow is Detection -> Plan -> Apply -> Verify. AssistantAdapter owns that lifecycle; BaseExtensionAdapter centralizes extension detection and logging; PlanApplier executes a fixed action union in core/orchestration/planBuilder.ts:

~~~
set-vscode-setting | edit-config-file | set-env-var | backup-file
                  | verify-endpoint | show-guided-steps
~~~

This is the right safety boundary, but the current implementation leaks provider policy into orchestration:

- PlanApplier.resolveConfigFileContent() dispatches on assistant keys for Continue, Codex, Kilo, and Claude.
- VscodeSettingsAdapter discovers any key matching (baseurl|base_url|apibase|endpoint|customproviderendpoint) and writes a scalar profile URL, even when the setting is an object or a provider-specific control with different semantics.
- PlanApplier.applyEnvVar() can only display a shell command; it cannot change the environment of an already-running VS Code host or CLI parent process.
- ProfileSecrets correctly uses SecretStorage, but some provider patchers accept raw secrets and can serialize them into config. That is only acceptable when the target application’s documented contract requires a persisted token, and the secret must be resolved at apply time, never stored in a plan or descriptor.

The proposed boundary is:

~~~
AssistantAdapter policy
  -> ProviderConfigDescriptor + target resolver
  -> typed driver (settings / JSONC / YAML / TOML / environment / guided)
  -> Plan steps
  -> existing PlanApplier safety and rollback
~~~

The descriptor describes what a provider means and where it can be safely changed. It must not describe a generic “base URL key” without dialect, selection, auth, reload, and verification semantics.

## Proposed typed model

The following is an architectural shape, not implementation work in this research task. Names are illustrative and should be reconciled with the existing plan types during implementation.

~~~
type ProviderSupport = 'automatic' | 'guided' | 'unsupported';
type ConfigFormat = 'vscode-settings' | 'json' | 'jsonc' | 'yaml' | 'toml' | 'environment' | 'ui';
type SecretPolicy = 'secret-storage-only' | 'target-persisted-at-apply' | 'external-auth-store' | 'none';
type ReloadPolicy = 'live' | 'restart-extension' | 'restart-application' | 'restart-process' | 'unknown';

interface ProviderConfigDescriptor {
  providerKey: string;
  versionEvidence: VersionEvidence;
  dialects: DialectBinding[];
  targets: ConfigTargetDescriptor[];
  fields: ConfigFieldBinding[];
  driver: ConfigDriverKind;
  support: ProviderSupport;
  tier: 'A' | 'B' | 'C';
  secretPolicy: SecretPolicy;
  reload: ReloadPolicy;
  discovery: DiscoveryContract;
  verification: VerificationContract;
  drift: DriftContract;
  limitations: string[];
}

interface ConfigFieldBinding {
  field: 'baseUrl' | 'apiKey' | 'model' | 'provider' | 'protocol' | 'headers' | 'tls';
  path: string | PathExpression;
  valueKind: 'string' | 'object' | 'array-entry' | 'env-binding' | 'ui-only';
  requiredFor: string[];
  secret?: boolean;
  preserveUnknown?: boolean;
}
~~~

Required descriptor rules:

1. providerKey, dialect, and protocol are explicit. openai.chat_completions, openai.responses, anthropic.messages, and google.gemini.generate_content are not interchangeable.
2. Targets are ordered alternatives with a resolver. A target may be a VS Code setting, a user file, a workspace file, an environment binding, a private auth store, or guided UI. The resolver records the selected target and the evidence used.
3. Field bindings are typed. A scalar string, an object merge, an array entry, a TOML table, and an environment variable are different drivers.
4. The descriptor contains no secret value. It may contain a secret reference and a secretPolicy; SecretStorage is read only during apply, and plan/change-log/diagnostic output uses redaction.
5. A descriptor can declare an unsupported field. For example, Gemini’s endpoint field is supported by upstream only through a process environment binding; because Switchboard cannot establish that process environment, the descriptor must produce guided output rather than a false automatic step.
6. Verification compares the intended profile to the resolved target. Presence-only verification is insufficient; it must check URL validity, selected provider, protocol, model binding where required, and secret presence without exposing the secret.
7. Unknown fields and providers are preserved by default. Deletion requires an explicit provider-specific rule, such as Kilo’s null-sentinel behavior for deep-merge updates.

### Reusable drivers

| Driver | Safe use | Required behavior |
|---|---|---|
| vscode-setting | A registered scalar or object setting with known schema | Read effective value, update correct scope, merge object fields, validate contributed type, verify exact binding. |
| jsonc-path | JSON/JSONC object, selected by a provider-owned path | Preserve comments where possible, preserve unrelated keys, create a timestamped backup before existing-file writes, atomic write, typed path verification. |
| yaml-model-array | Continue-style model/provider arrays | Detect primary YAML versus legacy JSON, preserve comments/other models, find by stable identity, upsert without overwriting unrelated models, verify chosen model. |
| toml-table | Codex-style named tables | Emit the upstream table name and enum values, preserve profiles/unknown fields, reject stale schema aliases, verify selected table and wire protocol. |
| environment-binding | A provider explicitly reads a named environment variable | Produce a guided/restart plan unless the target process is launched by Switchboard; never imply that process.env in the extension changes an existing CLI. |
| external-auth-store | Kilo/Cline/Roo-like private credential/profile systems | Adapter-owned API integration or guided UI; generic file writing is not allowed to guess the store schema. |
| guided-ui | Desktop app, private UI, proprietary protocol, unsupported version | Show exact provider UI path, endpoint, dialect/protocol, model and secret instructions; verify only what can be observed safely. |

Do not create a universal recursive JSON setter. Path expressions should support explicit object paths, keyed maps, and constrained array selectors with schema/type checks. A discovered key is evidence for a candidate target, not authorization to mutate every matching key.

## Provider-by-provider findings

### 1. GitHub Copilot — narrow Tier B proxy descriptor

Current adapter/registry: src/adapters/githubCopilot/adapter.ts writes the github.copilot.advanced object and sets debug.overrideProxyUrl. The registry calls this an undocumented internal proxy override and assigns Tier B. The adapter verifies only that the override is truthy, not that it equals the active profile URL.

Upstream evidence: at 5863f5a..., src/extension/completions-core/vscode-node/lib/src/config.ts, ConfigKey.DebugOverrideProxyUrl maps to internal.completionsUrl; the same file defines the legacy advanced.debug.overrideProxyUrl setting. src/platform/configuration/common/configurationService.ts maps the public VS Code configuration to Copilot’s internal key. package.json contributes languageModelChatProviders, proving custom providers are extension contributions rather than user settings.

Short proof/confidence: the object path and legacy override are directly present in source: high for the setting path, medium for long-term compatibility because it is explicitly internal/legacy. The current adapter’s object spread is structurally appropriate; its broad claim that all traffic is routed and its presence-only verification require a documented risk warning and exact-value verification.

Descriptor: vscode-setting object merge at github.copilot.advanced.debug.overrideProxyUrl; dialect github.copilot; preferred gateway front door is an explicit proxy contract, not OpenAI semantics. Secret remains in SecretStorage only. Tier B, reload live or restart-extension pending verification. No generic BYOK model field.

Recommendation: migrate only the safe object merge and exact verification. Keep the provider-specific warning and a drift check for ConfigKey.DebugOverrideProxyUrl / advanced.debug.overrideProxyUrl.

### 2. Cline — dedicated coordinated-store adapter

Current adapter/registry: the current Cline patcher writes <dataDir>/settings/providers.json and <dataDir>/globalState.json, selecting openai-compatible in the provider store and openai in legacy state. This is much closer to current behavior than the generic settings adapter, but it assumes one VS Code data contract and does not model the CLI’s provider-store override or newer protocol fields.

Upstream evidence: at 48d6385..., apps/vscode/src/shared/storage/storage-context.ts, resolveDataDirFromEnv, resolves CLINE_DATA_DIR, then CLINE_DIR/data, then ~/.cline/data; the same module documents globalState.json, secrets.json, and provider storage. apps/cli/DEVELOPMENT.md documents <CLINE_DATA_DIR>/settings/providers.json and the CLI-only CLINE_PROVIDER_SETTINGS_PATH. apps/vscode/src/sdk/cline-session-factory.ts resolves provider keys and base URLs from provider settings, with legacy state fallback. apps/vscode/src/shared/storage/state-keys.ts preserves the legacy openAiBaseUrl and mode-provider fields.

Short proof/confidence: there are explicit path resolvers, provider-store reads, and legacy fallback code: high for the multi-file shape; medium for one descriptor spanning VS Code and CLI because their override rules differ. Provider settings also support protocol choices in the current CLI documentation, so dialect cannot be reduced to openai.chat_completions.

Descriptor: json object driver for VS Code provider settings plus a separate legacy-state binding, target resolution from CLINE_DATA_DIR/CLINE_DIR, and an optional CLI path target only when the installed mode is known. Secret policy target-persisted-at-apply only through Cline’s documented provider store; otherwise guided. Atomic coordinated transaction: back up each existing file before either write and verify both selected provider and URL.

Recommendation: keep a dedicated Cline adapter, but make it consume reusable JSON object/transaction primitives. Do not convert it into VscodeSettingsAdapter or a single generic file descriptor.

### 3. Roo Code — do not automate archived target

Current adapter/registry: src/adapters/roocode/adapter.ts writes roo-cline.apiProvider and roo-cline.openAiBaseUrl via VS Code settings and reports Tier A. The registry itself records that Roo Code shut down on May 15, 2026.

Upstream evidence: at b867ec9..., src/package.json has no contributed roo-cline.apiProvider or roo-cline.openAiBaseUrl settings. packages/types/src/provider-settings.ts defines provider profile fields such as apiProvider, modelId, and openAiBaseUrl. src/core/config/ProviderSettingsManager.ts uses context.secrets.get/store for profile data and secrets, with a roo_cline_config_ key prefix. src/api/index.ts contains retired-provider handling.

Short proof/confidence: the claimed VS Code setting keys are absent from the archived source while the profile manager is SecretStorage-backed: high for drift/incorrect current adapter behavior; high that the archived target must not be treated as a maintained automation target.

Descriptor: unsupported/guided, Tier C for the registered provider; no generic settings write, no attempt to edit VS Code SecretStorage on behalf of an archived extension. If a supported community fork is added later, it requires a new manifest entry and independent evidence.

Recommendation: correct the registry/adapter policy in a future maintenance change, but do not migrate Roo into the abstraction.

### 4. Kilo Code — external auth store plus discovered config targets

Current adapter/registry: src/adapters/kilocode/kiloConfigPatcher.ts assumes ~/.config/kilo/kilo.jsonc, writes provider["aidome-gateway"], and, if given a secret, serializes a literal OPENAI_API_KEY=<secret> into env. The registry says VS Code settings are hints, but the adapter is already doing file mutation and returns Tier A.

Upstream evidence: at 5e02825..., packages/kilo-vscode/src/kilo-provider/config-file.ts resolves modern and legacy global/project candidates, including KILO_CONFIG, KILO_CONFIG_DIR, and KILO_CONFIG_CONTENT. packages/core/src/v1/config/provider.ts defines provider records with npm, env, options.baseURL, and model maps. packages/kilo-vscode/src/shared/custom-provider.ts validates a custom provider and explicitly handles auth changes; packages/kilo-vscode/src/provider-actions.ts strips provider keys from webview data, resolves stored keys by matching base URL, and connects through client.auth.set. config-bindings.ts protects writes against stale config revisions. withCustomProviderDeletions uses null sentinels because updates deep-merge.

Short proof/confidence: the current path is only one of several candidates, auth is handled by an API/state layer, and deep-merge deletion needs special semantics: high. Serializing a raw secret into env is contrary to the repository’s SecretStorage boundary and does not match the current Kilo auth flow.

Descriptor: a Kilo-specific target resolver and JSONC driver may represent the provider map/base URL, but auth is external-auth-store; the generic driver must never write a literal secret. Model discovery is an optional endpoint probe, not a required plan-time mutation. Verification must include the selected config target, provider ID, base URL, auth-store association, and stale-revision handling.

Recommendation: keep a Kilo-specific adapter and replace only its safe file mechanics later. First fix the security/schema drift; do not migrate its current patcher into a generic provider descriptor as-is.

### 5. Continue.dev — best first file-driver candidate, with format branching

Current adapter/registry: src/adapters/continue/continueConfigPatcher.ts always parses ~/.continue/config.json, updates the first matching or provider: openai model, and appends a hard-coded gpt-4 model otherwise. It does not handle current YAML primary configuration, JSONC comments, environment substitutions, model protocol flags, or embeddings.

Upstream evidence: at 5522c6f..., core/util/paths.ts defines CONTINUE_GLOBAL_DIR, getConfigJsonPath, getConfigYamlPath, and getPrimaryConfigFilePath; YAML is selected as primary when present. core/config/load.ts parses JSONC, substitutes environment values from process/config env, and loads models. core/config/types.ts defines apiBase, apiKey, useLegacyCompletionsEndpoint, useResponsesApi, headers, and request options. docs/customize/model-providers/top-level/openai.mdx documents YAML provider, model, apiKey, and apiBase for OpenAI-compatible endpoints. core/llm/llms/OpenAI.ts builds chat/completions/responses URLs from these fields.

Short proof/confidence: current upstream has an explicit primary-file resolver and typed model fields: high. The current adapter’s JSON-only behavior is confirmed drift: high.

Descriptor: yaml-model-array plus a legacy JSONC target resolver. Bind models[] (or the current YAML model list) by stable provider/model identity; set provider, apiBase, and the selected protocol flag as required by the gateway. Bind apiKey through Continue’s supported environment indirection where possible. Preserve unrelated models and comments, back up the selected primary file, and verify the selected model rather than any model with any URL.

Recommendation: first migration candidate after the driver has fixture coverage for YAML, JSONC, env substitution, multiple models, and primary-file selection. Keep a Continue policy adapter for which model/dialect is selected.

### 6. Claude Code — dedicated environment-backed settings adapter

Current adapter/registry: src/adapters/claudeCode/adapter.ts and claudeCodeConfigPatcher.ts write shared settings.json, preserve unrelated values, set ANTHROPIC_BASE_URL, gateway discovery, and token fields, clear stale ANTHROPIC_API_KEY, and set claudeCode.disableLoginPrompt. The apply path resolves the profile secret late, which is the correct direction. The registry claims runtime version details and TLS env behavior that need ongoing upstream validation.

Upstream evidence: at f1af9b1..., the public repository contains documentation/changelog evidence rather than the closed runtime implementation. .devcontainer/devcontainer.json references CLAUDE_CONFIG_DIR; CHANGELOG.md documents CLAUDE_CONFIG_DIR, third-party ANTHROPIC_BASE_URL/token use, and opt-in CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY; changelog material states custom gateway model discovery behavior. This is not equivalent to a runtime source guarantee.

Short proof/confidence: medium for the settings/env contract and low-to-medium for exact version gates or TLS flags because runtime source is absent. The current patcher’s preservation/backup approach is sound, but the descriptor must label claims as documentation-derived and avoid assuming every CLI/extension version consumes the same file.

Descriptor: json object driver for the resolved CLAUDE_CONFIG_DIR/settings.json plus environment-binding fields consumed by Claude Code; secret policy target-persisted-at-apply only because Claude requires the token in its settings/env contract. Never place the token in descriptor, plan, change log, diagnostics, or logs. Require restart/reload guidance and exact verification of URL/discovery flag; do not claim OpenAI compatibility unless the gateway translates to Anthropic Messages, Bedrock, or Vertex semantics.

Recommendation: keep dedicated policy and patcher. Reuse safe JSON/backup primitives only after runtime/documentation drift checks are automated.

### 7. OpenAI Codex — dedicated TOML migration required before abstraction

Current adapter/registry: src/adapters/codex/codexConfigPatcher.ts writes [providers.aidome], base_url, wire_api = responses, selects model_provider, and defaults the model to gpt-4. The registry also documents providers.<name> and OPENAI_BASE_URL.

Upstream evidence: at f5636bb7..., codex-rs/config/src/config_toml.rs defines model and model_provider, and user-defined provider entries under model_providers, not providers. codex-rs/model-provider-info/src/lib.rs defines provider base_url, env_key, headers, auth, and wire_api; its wire API parser accepts responses and rejects chat. codex-rs/profile_toml.rs also binds profiles to model_provider. Runtime provider construction in codex-rs/model-provider/src/provider.rs consumes the provider info/base URL.

Short proof/confidence: wrong table name and stale field claims are directly visible in current source: high. The current verifier, which checks for a provider table and a base_url string, can report a false positive against an unusable config: high.

Descriptor: toml-table with model_providers.<name>, model_provider, model, base_url, and wire_api = responses. Authentication should bind to a provider env_key or guided process environment; do not write api_key unless the upstream schema explicitly requires target-persisted credentials and the security review approves it. Custom CA is an environment binding (CODEX_CA_CERTIFICATE/SSL_CERT_FILE) and there is no documented disable-TLS switch.

Recommendation: do not migrate the current patcher. Correct the Codex schema in a dedicated change, add schema-accurate fixture tests and exact verification, then consider reusing the generic TOML driver.

### 8. Gemini CLI — environment binding, guided in current host model

Current adapter/registry: src/adapters/geminiCli/adapter.ts detects gemini and emits guided-only steps; the registry says there is no general base URL override.

Upstream evidence: at 0bd1d439..., packages/core/src/core/contentGenerator.ts maps GOOGLE_GEMINI_BASE_URL to gateway auth, accepts config.baseUrl, validates the URL, and selects the gateway base URL. packages/cli/src/config/auth.ts resolves Gemini credentials from environment/keychain. docs/reference/configuration.md documents GOOGLE_GEMINI_BASE_URL and GOOGLE_VERTEX_BASE_URL, including HTTPS/local-host constraints. Settings schema is strict and does not provide a general arbitrary endpoint field.

Short proof/confidence: upstream does support a custom endpoint, but through a process environment contract: high. Switchboard’s set-env-var action only displays a command and cannot affect a running CLI’s parent environment: high.

Descriptor: environment-binding for GOOGLE_GEMINI_BASE_URL (and the matching credential binding) with guided support in the current extension host. If a future Switchboard launcher owns the Gemini process, this can become automatic for that launcher only. Dialect remains google.gemini.generate_content/gateway, not OpenAI chat by declaration.

Recommendation: update the research/registry claim eventually, but keep current user-facing behavior guided until process launching is in scope.

### 9. CodeGPT — legacy evidence, guided only

Current adapter/registry: src/adapters/codegpt/adapter.ts dynamically scans contributed settings for base URL/provider-like keys and may write discovered values, then falls back to the model-management UI. The registry claims current BYOK/local-provider behavior while acknowledging the public checkout is legacy.

Upstream evidence: at ffd460a..., package.json contributes codegpt.apiKey, codegpt.model, token, and temperature settings, but no custom endpoint/base URL setting. src/extension.ts reads the API key/model and uses the OpenAI SDK/completions path. The README describes the old GPT3/ChatGPT extension.

Short proof/confidence: high for the legacy checkout; low for current marketplace behavior. The dynamic scanner cannot establish that a discovered setting controls CodeGPT’s active model-management provider or that its value accepts an AIdome endpoint.

Descriptor: guided-ui, Tier B/C pending a maintained primary source. Do not write arbitrary discovered keys. If a current installed extension exposes a documented, typed endpoint field, treat it as a separately evidenced version-specific target and verify provider selection plus URL.

Recommendation: keep guided behavior and add drift evidence; do not abstract the current scanner into a reusable mutation rule.

### 10. AnythingLLM — guided desktop provider with strong endpoint semantics

Current adapter/registry: src/adapters/anythingllm/adapter.ts detects desktop paths and emits UI guidance for Generic OpenAI/OpenAI Compatible. It is correctly guided-only for the VS Code extension because AnythingLLM is an external desktop/server application. Its verification currently returns success even when only a detection result is available, which should be interpreted as “detected/guidance available,” not “endpoint configured.”

Upstream evidence: at bc71392..., server/.env.example and docker/.env.example define LLM_PROVIDER=generic-openai, GENERIC_OPEN_AI_BASE_PATH, model preference, API key, and custom headers. server/models/systemSettings.js exposes the same fields. frontend/src/components/LLMSelection/GenericOpenAiOptions/index.jsx presents Base Path, API key, and model selection; frontend/src/pages/GeneralSettings/LLMPreference/index.jsx marks base path as required/connection config. server/utils/AiProviders/genericOpenAi/index.js constructs an OpenAI-compatible client with the configured base path and custom headers.

Short proof/confidence: high for Generic OpenAI field semantics and the desktop/server UI/config split. There is no evidence in the scoped upstream checkout that the VS Code extension should edit a local AnythingLLM config file.

Descriptor: guided-ui with explicit fields base URL, model, API key, and optional custom headers; secret is entered into AnythingLLM’s own UI or deployment secret mechanism. Tier B. Verification should report “app detected / endpoint not observable” separately from a successful connection test.

Recommendation: keep the current guided adapter, improve its status wording, and reuse descriptor metadata for consistent guidance. Do not invent a local file target.

### 11. Tabnine — proprietary protocol, enterprise-server guidance only

Current adapter/registry: src/adapters/tabnine/adapter.ts detects the extension and reports Tier C; it correctly says an OpenAI-compatible endpoint cannot be selected directly.

Upstream evidence: at 6312d789..., src/enterprise/consts.ts defines tabnineSelfHostedUpdater.serverUrl; src/enterprise/update/serverUrl.ts reads and validates that VS Code setting; src/enterprise/extension.ts passes the server URL to the self-hosted updater/CLI. src/proxyProvider.ts and package.json show VS Code proxy support. These settings configure Tabnine Enterprise/update infrastructure, not an OpenAI API dialect.

Short proof/confidence: high for the client’s enterprise server URL and proxy behavior; not established for the private backend protocol. No evidence supports rewriting it to AIdome’s OpenAI/Anthropic/Gemini endpoint.

Descriptor: unsupported for direct endpoint switching; guided enterprise-server explanation only. Do not map tabnineSelfHostedUpdater.serverUrl to the AIdome base URL. TLS/proxy guidance remains a separate infrastructure concern.

Recommendation: keep guided Tier C. The current adapter’s scope is appropriate.

## Taxonomy and abstraction fit

| Pattern | Providers | Reusable? | Boundary |
|---|---|---:|---|
| Registered VS Code scalar/object setting | Copilot (object, private/legacy) | Partial | Only with explicit schema/path and exact verification; not regex discovery. |
| Coordinated JSON provider store + legacy state | Cline | Low/partial | Reuse transaction and JSON mechanics; retain provider policy. |
| VS Code SecretStorage/private profile manager | Roo Code | No for current target | Adapter must not impersonate another extension’s SecretStorage namespace. |
| Discovered JSONC config + external auth API | Kilo | Partial | Reuse JSONC/path/revision mechanics; retain Kilo auth/model policy. |
| Primary YAML/legacy JSONC model array | Continue | Yes, first candidate | Reusable format/path/array driver plus Continue dialect policy. |
| Shared settings JSON + process environment | Claude Code | Partial | Reuse safe JSON patching; retain env/version/reload policy. |
| Named TOML provider table + wire enum | Codex | Yes after schema correction | Generic TOML driver can work after exact upstream schema is encoded. |
| Process environment gateway switch | Gemini CLI | Partial | Reusable guided environment binding; automatic only for a Switchboard-owned launcher. |
| Version-dependent/legacy UI | CodeGPT | No current evidence | Guided unless installed contribution schema is independently verified. |
| External desktop/server UI | AnythingLLM | Guidance metadata only | No local file mutation target established. |
| Proprietary enterprise protocol | Tabnine | No | Explain enterprise server boundary; no dialect substitution. |

This taxonomy yields roughly four reusable drivers, but only two providers (Continue and, after correction, Codex) are strong candidates for a full driver migration. The rest benefit from shared safety primitives and descriptor metadata without losing their dedicated policy adapters.

## SecretStorage, backups, validation, and rollback requirements

The abstraction must preserve the existing security rules rather than weaken them:

- Profile metadata stays in globalState; profile credentials stay in vscode.SecretStorage.
- A descriptor may carry authRef, never the resolved secret. Resolve it only during apply, and only in memory long enough to perform the target-specific operation.
- Plans, change logs, diagnostics, errors, and logger context must contain redacted values. Avoid putting a secret in newValue, data, or a guided command. A shell command containing a token is a secret leak.
- For target-persisted credentials (notably Claude settings, and possibly provider stores with an upstream requirement), make the exception explicit in SecretPolicy, back up first, write atomically, and verify only presence/association—not content.
- For external-auth-store providers (Kilo/Roo/Cline variants), a generic file driver must reject secret fields rather than silently serializing them.
- Validate endpoint schemes with the existing allowlist. Treat http only according to the existing local/insecure policy; reject javascript:, data:, file:, embedded credentials, and unsafe profile names.
- Resolve paths from provider-owned environment contracts. Do not write ~/.config/... merely because it is a common path when upstream has a candidate list or an override variable.
- Existing files require a timestamped backup before modification. Multi-file providers need a transaction record that can restore every file if a later write fails.
- Preserve unknown keys, unrelated providers, comments where the parser supports it, and user-selected models. A default model such as gpt-4 must not be invented unless the provider contract explicitly requires it.
- Verification must use the same target resolver and binding as planning, compare the configured URL to the profile, confirm selected provider/protocol, and classify “app detected but configuration not observable” separately from success.

## Evidence and drift automation

The provider manifest is a good starting point, but the evidence should become machine-checkable without making network access a runtime dependency.

### Evidence record

For each descriptor, keep a reviewable record with:

~~~
provider key
repository URL + branch
synchronized upstream commit
source path
symbol or JSON/TOML/YAML key
short proof statement
confidence
observed-at date
manifest status
~~~

This research document is the initial human-readable record. A future generated evidence artifact should be written outside production adapter code and should fail closed when a required symbol disappears.

### CI/maintenance checks

1. Run maintenance/sync_provider_refs.py --json on a scheduled maintenance job.
2. For each descriptor, run repository-local probes at the synchronized commit: file existence, symbol/key presence, setting contribution, and schema enum checks. Do not use broad substring matches as proof.
3. Compare the observed evidence hash/commit with the descriptor’s pinned evidence. Open a maintenance warning when source moves, a required key disappears, a file becomes archived, or the installed extension contribution differs from the descriptor.
4. Keep a compatibility matrix for tested versions. A descriptor should say “unknown/guided” when a version is outside the tested range instead of guessing.
5. Add a pre-release validation that every automatic target has: a URL binding, a dialect/protocol binding, a secret policy, a backup policy, an exact verifier, and a documented reload policy.
6. Add fixtures for each driver with malformed input, unknown fields, comments, multiple providers/models, missing files, unsafe URLs, and rollback after a second-file failure.
7. Keep upstream source as primary evidence. Marketplace/docs links can supplement user-facing instructions but cannot override a contradictory synchronized source result without an explicit confidence downgrade.

## Migration and test strategy

### Phase 0: contract and safety tests

- Define descriptor schemas and discriminated driver inputs.
- Test that no secret can appear in serialized descriptors, plans, change logs, diagnostics, or logger output.
- Test URL/path/profile validation and backup-before-modify behavior.
- Test transaction rollback for one-file and multi-file targets.
- Test unsupported fields produce guided steps rather than guessed writes.

### Phase 1: migrate Continue

- Add JSONC and YAML parsing/serialization fixtures.
- Test primary-file resolution (config.yaml versus legacy config.json), global directory overrides, model selection, protocol flags, env substitutions, and preservation of other models.
- Make verification select the exact model/provider entry that the plan changed.
- Keep the old Continue adapter behind the same AssistantAdapter boundary until parity tests pass.

### Phase 2: correct and migrate Codex

- Add fixtures using model_providers, model_provider, base_url, wire_api, env_key, and profile selection.
- Prove that wire_api = responses is emitted and that chat is not silently substituted.
- Test missing/invalid tables and ensure the verifier rejects the old providers shape.
- Keep API-key persistence out of the generic TOML driver.

### Phase 3: narrow settings and guided metadata

- Copilot: object merge and exact override verification.
- AnythingLLM: guidance metadata and “detected versus configured” verification semantics.
- Gemini: environment binding guidance with explicit restart/process ownership.
- CodeGPT: retain guided-only unless a current installed contribution schema is captured.
- Tabnine/Roo: retain unsupported/archived guidance.

### Phase 4: provider-specific hard cases

- Cline coordinated file transaction and version-aware provider/legacy state behavior.
- Kilo candidate path/revision binding and external auth API integration, never literal secret-in-env.
- Claude settings/env behavior with documentation-derived confidence and version checks.

For every migration, compare generated plans before applying them, run adapter unit tests, run verifier tests against fixtures, and perform a manual Extension Development Host smoke test for the actual installed extension version. Because this task is research-only, no implementation or test execution was performed here.

## Registry and current-code drift to resolve

The following claims should be treated as maintenance findings before an abstraction refactor:

- Roo Code’s Tier A VS Code-setting target is contradicted by archived source and SecretStorage-backed profiles.
- Kilo’s current config path/auth behavior is broader than the adapter and the adapter’s literal secret serialization is unsafe.
- Continue’s current YAML primary configuration is absent from the adapter.
- Codex uses model_providers, not providers; the current adapter and registry hints are stale.
- Gemini CLI supports gateway base URLs through environment variables, but Switchboard cannot apply them automatically in its current process model.
- CodeGPT’s public source proves only legacy settings; current model-management claims need separate installed-extension evidence.
- Claude runtime/version/TLS claims are documentation-derived because the synchronized public checkout lacks runtime source.
- AnythingLLM’s detection-success verifier does not prove endpoint configuration.
- Copilot verification must compare the configured override to the active profile, and the internal setting must remain Tier B.

## Final counts and decision

| Measure | Count |
|---|---:|
| Providers in manifest researched | 11 |
| Reusable driver families justified | 4–5 |
| Strong first-wave full migrations | 2 (Continue, corrected Codex) |
| Narrow reusable settings/guidance migrations | 3 (Copilot, Gemini binding, AnythingLLM metadata) |
| Keep dedicated provider policy | 3 (Cline, Kilo, Claude) |
| Guided/unsupported or legacy-only | 3 (Roo Code, CodeGPT, Tabnine) |
| Current adapters/registry with material drift findings | 8+; see section above |

The right architecture is therefore **GO WITH CHANGES**: abstract repeated mechanics and evidence contracts, preserve dedicated adapters for provider semantics, and gate automatic support on current upstream evidence plus exact verification. A universal base-URL writer would produce false confidence and, in Kilo/SecretStorage cases, create security defects.
