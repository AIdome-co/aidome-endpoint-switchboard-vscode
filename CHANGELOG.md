# Changelog

All notable changes to the "LLM Endpoint Switchboard (by AIdome)" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]
- Codex round-6 fixes on PR #118: the setup wizard re-checks guided eligibility once the profile is known — a Tier C assistant that was actionable dialect-agnostically but is unsupported for the selected profile (e.g. Gemini CLI with an `openai.chat_completions` profile while Roo Code was also selected) is dropped from the plan with an explanatory warning instead of being guided into an `unsupported` outcome; and the Roo Code descriptor now binds Responses-dialect base-URL guidance to Roo's native `provider-profile.openAiNativeBaseUrl` field (upstream `src/api/providers/openai-native.ts` initializes the OpenAI client from `openAiNativeBaseUrl`), with `openAiBaseUrl` remaining the OpenAI Compatible/chat field.
- Codex round-5 fix on PR #118: Gemini CLI's `getGuidedSetupStatus()` now mirrors the adapter's own URL constraint — a `google.gemini.generate_content` profile whose base URL is plain HTTP on a non-loopback host (or unparseable) is classified `unsupported` in guided eligibility instead of being offered as completable guided setup, and the corresponding explain-and-stop plan step (`gemini-cli-requires-https-base-url`) declares `configurationStatus: 'unsupported'` so the applier no longer reports `guided-required` for a profile the adapter cannot configure.
- Codex round-3 fixes on PR #118: unsupported Roo dialect plans (e.g. `anthropic.messages`) now declare `configurationStatus: 'unsupported'` in their guidance step, so the applier classifies Roo Code as unsupported instead of promising guided-required follow-up on a profile that cannot complete the setup; and the setup wizard no longer promises "guided manual setup will be offered next" when the only detected Tier C assistants are unsupported — the warning distinguishes actionable guided detection from unsupported one. Added a guided-setup-status regression test (adapter coverage gate back to 100% statements/branches/functions/lines).
- Tier C (guided-setup-only) assistants are now reachable from the setup wizard and the profile assignment flow (Codex round-1 review on PR #118): the wizard no longer returns early when only Tier C assistants are detected, and Tier C candidates stay selectable in both `setupSwitchboard` and `assignProfileAssistants` QuickPicks — labeled "guided setup only — endpoint routing is configured manually" — so their `show-guided-steps` plans (the only setup surface they support) are actually offered instead of telling Roo-only users to install a Tier A assistant. Codex round-2 refinements: guided eligibility covers Tier C CLIs too (Gemini CLI is now offered), and only ACTIONABLE guided plans are offered — a new `AssistantAdapter.getGuidedSetupStatus()` capability ('actionable' for Roo Code and Gemini CLI, 'unsupported' for Tabnine) keeps unsupported informational guidance (e.g. Tabnine) out of both pickers instead of promising setup that does not exist.
- Tabnine (Tier C, manual) now surfaces its guided setup in the product instead of hiding it: detection accepts both marketplace IDs (`TabNine.tabnine-vscode` and the "Tabnine for Enterprise" `TabNine.tabnine-vscode-self-hosted-updater`), and Tier C assistants whose registry entry declares the `guided` configuration mode (Tabnine) are selectable in the Setup and Assign wizards — the Setup early-return warning no longer fires when only guided Tier C assistants are detected — so the Admin Console → Self-Managed Models instructions and the manual-verification outcome actually reach the user. Unguided Tier C assistants keep the previous "not switchable" behavior.
- UI-kind assistant detection over Remote SSH: assistants whose manifests prefer the UI side (`extensionKind: ["ui", "workspace"]`, e.g. Continue.dev) run in the LOCAL extension host when a remote workspace is open, making them invisible to detection (`vscode.extensions.all` in the remote host) even though they are installed on the remote machine — and their config files (`~/.continue`) live on the client, not where the Switchboard writes. Detection now falls back to an on-disk scan of the remote extensions directories (all declared + resolved IDs) and reports such assistants with an explicit `activationGap`; the setup/attach wizards explain the gap and copy a ready-to-paste `remote.extensionKind` override into the user's LOCAL clipboard (extension placement is decided client-side before workspace settings load, so only the client's user settings are effective — microsoft/vscode#309379), and the gap assistant is excluded from the switchable list until the override is applied. No-op outside remote sessions.

- Fixed: Continue.dev model entries were written without the required `model` field, so Continue silently dropped the managed entry and the chat model picker stayed empty. The adapter now discovers the gateway model list and the configuration driver writes one managed entry per model (each with `model`, `title` = model id and the shared `apiKey`), reconciling previously managed entries whose model is no longer offered. User-authored entries are never touched; behavior without model discovery is unchanged.

- Continue.dev activation is now FULLY automatic (Tier A end-to-end): the profile's saved gateway token is persisted into the Switchboard-managed model entry's `apiKey` field in Continue's OWN config file (`~/.continue/config.yaml`, or the legacy `config.json` — the vendor's only credential mechanism, same sanctioned vendor-store class as Claude Code's `env.ANTHROPIC_AUTH_TOKEN`). The profile secret stays in VS Code SecretStorage until apply time and never appears in plans, logs, or change history. Credential semantics are clear-not-replay: only the `AIdome Gateway` entry is touched (a credential-less profile switch CLEARS its `apiKey` — a previous profile's token never survives), unrelated user model entries keep their own credentials, whitespace-only secrets are treated as missing, verification now requires the `apiKey` on the managed entry (a missing key is an authentication gap, not a configured state), and the applier warns with an actionable message when a missing secret triggered the clear. Governance/architecture tests updated to encode the new per-field support contract.
- Kilo Code profile setup now writes the profile PAT into Kilo's own credential store (`<XDG_DATA_HOME|~/.local/share>/kilo/auth.json`, the file Kilo reconciles into its credential database on every backend startup) instead of leaving authentication fully guided, and RECONCILES the `aidome-gateway` model list with an AUTHENTICATED gateway discovery probe (the unauthenticated probe 401s on AIdome, which previously left the config without models): on every setup/activation the written model map becomes exactly the gateway's current list — newly served models are added, models no longer served are removed, entries still served keep their full existing metadata — while an empty probe (discovery failure/outage) never rewrites the config. Merge-write semantics for credentials: only the `aidome-gateway` entry is touched (a credential-less profile switch CLEARS it — a previous profile's token is never replayed), other integrations' credentials are preserved, backup-before-modify with fail-closed guards (no mutation without a recoverable backup, no wholesale replacement of an unparsable file, failed writes restore the pre-write content, confirmed no-ops create no backup), self-restore of the committed auth write when the model re-render fails, and full rollback tracking. The plan declares a Kilo reload requirement because the backend imports `auth.json` only at process startup. General applier hardening riding the same feature: `write-assistant-storage` results now carry `createdFile`/`extraRollbacks`/`authRequired` into the applied step (rollback can actually restore every mutated target), report `secretResolved` truthfully, and support writer-reported no-ops with a writer-scoped authentication-gap outcome — a missing credential yields `guided-required` instead of a false `configured` ONLY for writers whose vendor contract requires a credential (Kilo), while credential-less-capable writers (CodeGPT) keep their configured outcome.
- Cline activation now survives a running Cline instance: adapters can declare extensions that snapshot file-backed configuration in memory (`AssistantAdapter.getReloadExtensionIds?`), and after a successful apply the Switchboard offers a window reload so Cline re-reads the applied `globalState.json`/`providers.json` from disk instead of clobbering them with stale in-memory state (verified against upstream Cline `ClineFileStorage`, which reads its config files once in the constructor and writes the whole snapshot back on every state change). The Cline plan also selects the gateway as `lastUsedProvider` in providers.json so the SDK provider-store fallback resolves to the applied profile when globalState holds no provider.
- Fixed a P1 PlanApplier control-flow bug: the no-op credential-gap classification (write-env-file with no saved credential) used a `break` that exited the entire multi-assistant loop, silently skipping every later assistant while plan success stayed true and leaving later assistants without outcome entries (downstream activation could then treat them as applied). The classification is now if/else — the current assistant gets `guided-required` (credential gap) or `deferred` (true no-guidance no-op) and the loop continues; later assistants are processed, mutated, or failed exactly as before.
- `write-env-file` mutation metadata is now truthful in every missing-credential path: stale managed-key removal sets `managedValueRemoved=true` AND `mutationApplied=true` (a real, rollbackable mutation); a managed key already absent is a confirmed no-op (`mutationApplied=false`); `preserve` behavior is an explicit no-op; a missing-credential return never claims `createdFile=true` (set only when the successful write actually creates the file); stale-key rollback restores from backup. The applier treats a confirmed credential no-op as `guided-required` (authentication is genuinely incomplete) while true no-guidance no-ops remain `deferred`; reassignment restore candidates exclude no-op env writes and include real stale-key removals.

- Reassignment mutation evidence is sourced from the applied-step change-log record (`ApplierResult.changeLogEntry.steps[].mutationApplied`), not `PlanStep.completed`: a skipped no-op (e.g. `set-vscode-setting` on an unregistered setting) executes with `completed: true` but writes nothing, so it is no longer misclassified as a mutated assistant and wrongly restored on abort (which previously produced false "restoration was incomplete" warnings). Legacy applied steps without the flag still count as mutations; guidance-only/unsupported/deferred assistants without a real mutation are never restore candidates. Reassignment transaction tests now script the production `ApplierResult` shape and cover the deferred no-op, guided-required-with-mutation, `write-env-file` mutation, guided-only, unsupported, incomplete-restoration, hard restore failure, and successful-restoration mapping cases, plus a real-`PlanApplier` integration sequence (gateway-b write → abort → gateway-a restored) and a real skipped no-op recording `mutationApplied: false`.
- Transactional reassignment restores every assistant that actually mutated toward the target — including `guided-required` assistants whose configuration was written before a credential gap (they carry real mutation evidence from the applied steps, independent of status). When a hard failure aborts the reassignment, the restore set is `mutatedAssistantKeys` (configured + mutated-incomplete), not only fully configured assistants; restoration counts as complete ONLY when every restore candidate ends `configured` (a guided/deferred/failed restore reports "automatic restoration was incomplete — manual recovery may be required" and never claims the original profile was restored); guidance-only, unsupported, and deferred no-ops are never restored (no state to roll back); target mappings from the aborted attempt are removed only after successful restoration.
- Manage Profiles classifies assistant outcomes by status, not the `success` compatibility flag: only `failed` is a hard automatic-apply failure (abort/restore path unchanged); `guided-required` / `unsupported` / `deferred` reassignments move the mapping to the target (whose provider configuration already points there — no source-mapping/target-configuration mismatch) with a truthful incomplete-configuration warning; absent outcomes fail closed; Edit-Profile reapply reports incomplete categories as a warning, and hard failures keep listing incomplete statuses rather than flattening them. Setup shows an error (still listing every category) when nothing is configured but a hard failure exists; the assignment all-failed error path no longer drops guided/unsupported/deferred/unplanned categories. Manage-Profiles test mocks use the current status model and their `buildAutomatedReapplyPlan` mock now mirrors production semantics including `write-env-file`.
- Command-layer outcome reporting is truthful in every path: setup computes assistant outcome categories once (configured / guided-required / unsupported / deferred / failed) and applies them identically regardless of plan-execution success, so a deferred-only setup no longer claims "Configuration failed", a configured+deferred setup no longer silently omits the deferred assistants, and pure success is shown only when every assistant outcome is `configured`; assignment flows track guided/unsupported/deferred separately, never report success for an assignment in which zero assistants were actually assigned, and never emit a fake "Detached 0 assistant(s)" summary (detach/assign+detach/fallback-reapply behavior unchanged).
- Codex now resolves the profile credential through `profile.authRef ?? profile.name` (the SecretStorage lookup identity), so profiles whose display name differs from their secret reference no longer falsely report a missing credential (and could strip a valid key). Review-response fixes: assistant statuses survive partially failed plans in setup/activation messaging (guided/unsupported/deferred are never collapsed into "failed"); a skipped no-op mutation without any guidance step reports `deferred` instead of the misleading `guided-required`; `write-env-file` maps to applied mode `env`; and rollback skips steps marked `mutationApplied=false` so no-op writes no longer produce spurious revert errors (real mutations still roll back, and the Codex stale-key removal stays transactional).
- Profile-switch credential safety: `write-env-file` supports a declared `missingSecretBehavior` (`preserve` | `remove-managed-key` | `fail`). Codex declares `remove-managed-key`, so switching to a profile without a saved credential removes ONLY the managed `OPENAI_API_KEY` from `~/.codex/.env` (unrelated variables and comments preserved, backup-before-modify, atomic write) — a previous profile's token can no longer survive a profile switch. Skipped VS Code setting writes (unregistered settings) mark the step `mutationApplied=false` and can no longer produce a `configured` outcome or a mapping; Roo Code and Tabnine declare explicit `configurationStatus: 'unsupported'` (and Tabnine verification no longer reports success merely because the extension is installed); setup and profile-activation results are derived from per-assistant statuses (guidance-only plans never show "Successfully configured 0"); mappings persist only for assistants whose final outcome is `configured`.
- Outcome semantics: a successfully executed plan step no longer implies the assistant was configured. `PlanApplier.assistantResults` now carries a typed status (`configured` / `guided-required` / `unsupported` / `failed`), where `success` is true only for `configured`. Guidance-only plans report `guided-required`, optional guidance shown AFTER a successful mutation keeps `configured`, unsupported providers never report configured, a `write-env-file` that finds no saved credential reports `guided-required` (existing env files untouched), and setup/assignment/activation flows count unique configured assistants instead of steps. `write-env-file` is classified as a real automatic mutation everywhere (mapping persistence, automated reapply — Codex profile switching now moves both `config.toml` and the `.env` credential), requires an explicit `secretPolicy` at apply entry, and persists at most one mapping per assistant.
- Abstraction cleanup in the provider execution layer, with zero provider-behavior change: the dotenv mechanics moved from the Codex adapter into a generic `src/core/providerConfig/envFileDriver.ts` (`patchEnvFile`/`parseDotEnv`/`buildDotEnvContent`) — PlanApplier now imports no provider modules and `~/.codex/.env` behavior is byte-identical; adapters no longer emit duplicate executable `backup-file` steps ahead of `edit-config-file` (the applier owns backup-before-write; adapters mark `backupRequired` preview metadata — exactly one backup per file mutation); Kilo and Cline verification now require an EXACT match with the assigned profile base URL and fail closed when the expected profile is unknown (Kilo verifies the parsed JSONC provider map instead of substring matching); the Cline descriptor now truthfully declares `target-persisted-at-apply` credential persistence (apiKey into `providers.openai-compatible.settings.apiKey` plus the `secrets.json` mirror) and the legacy secrets mirror is a declared coordinated target; new architecture tests enforce the dependency direction (no provider imports or provider-name branches in core) and descriptor/runtime consistency.
- Aligned `validateUrl` with `validateInputUrl`: any parseable http/https URL (including plain-http self-hosted gateways like `http://<ip>:8100/v1`) is accepted everywhere, fixing `Failed to build plan for cline/openai-codex` and `Configuration driver received an invalid endpoint URL` failures that occurred only for plain-HTTP profiles. Dangerous schemes (javascript:, data:, file:, ftp:) remain rejected.
- Failed the apply closed on driver-less `edit-config-file` steps that declare configuration metadata (baseUrl/configPath/format/provider name …): the applier previously fell back to writing `step.newValue` verbatim, which once replaced the entire `~/.codex/config.toml` with the bare base URL. True legacy raw-value steps (no step data) are still supported.
- Logger errors are now serialized with name/message/stack and null/undefined args are dropped, so failures no longer log as useless `[{}, null]` / `[null, null]` lines; `Plan failed` entries include per-step id/assistant/error.
- Fixed provider execution routing: OpenAI-compatible endpoints now receive a normalized `/v1` base, Cline model catalogs and active model state are synchronized from gateway discovery, Codex targets the active Snap config and model, verification sends dialect-correct prompts with discovered models and validates Responses SSE event envelopes, and unsupported Copilot legacy settings produce explicit Custom Endpoint guidance instead of a false success.
- Added an abstraction layer that resolves VS Code extension IDs for assistant detection from the market: `MarketplaceClient` queries the VS Code gallery API and `ExtensionIdResolver` validates declared registry IDs, falling back to resolving the canonical ID by display name when a declared ID is stale (so e.g. a wrong `CodeGPT.codegpt` no longer silently breaks detection). Added cached, parallel fallback detection and `npm run validate:registry`, a strict live-network CI gate that fails when any declared extension ID cannot be verified.
- Added evidence-backed provider configuration descriptors and reusable JSON/JSONC, YAML, TOML, and typed VS Code-setting drivers; migrated Continue, Codex, Copilot, Claude Code, and Kilo execution paths and made CodeGPT, Roo Code, Gemini CLI, AnythingLLM, and Tabnine fail-safe guided/unsupported where automation is not verifiable.

- Auto-configure the CodeGPT local/OpenAI-compatible provider by writing its own storage (`~/.codegpt/db.sqlite` `connection` table + `settings.json` `local-server-flavor-*`), exactly as CodeGPT's "Manage my AI Models" UI does, so models appear in the CodeGPT panel without manual setup. Verification now reads the real stored `custom_link` instead of VS Code settings (which CodeGPT does not contribute), so it reflects what CodeGPT will actually use. Adds a `write-assistant-storage` plan step (backed up before write, rolled back on failure). Requires Node 20+ (`node:sqlite`).
- Updated Tabnine Enterprise guidance and status reporting for manual configuration (the guided steps now point admins at the Tabnine Admin Console → Models → Self-Managed Models OpenAI-compatible endpoint wizard, scoping the routing claim to Chat/Agent since code completions keep Tabnine's universal model; verification reports manual-verification-required because the extension cannot read server-side admin configuration), and aligned the GA-readiness documentation and the README quick-reference with the manual (non-auto-verified) Tier C setup.
- Made the maintenance controller self-heal stale PR worktrees: a leftover worktree from an interrupted run that holds uncommitted changes (the failure surfaced as "PR #N worktree is not clean", which previously recurred on every run until a human manually reset it) is now automatically reset to the remote PR branch head and cleaned, since automation-owned PR worktrees live under `pub-refs/` and never touch the user checkout.
- Added a memory-headroom gate to the maintenance controller: when the shared host is memory-starved (available RAM below a threshold or free swap nearly exhausted — the condition that previously wedged a live VS Code Server session while E2E validation was running), the controller now defers the heavy `test:e2e` validation step instead of stacking another full VS Code instance on a thrashing box. The step is recorded as a non-passing environment deferral (not a code failure), keeping the PR safely below 100% until a later run has headroom. Add regression tests for the pressure gate and deferral.
- Corrected the Codex CLI configuration file name in `docs/platform-support.md` from `config.yaml` to `config.toml` to match `~/.codex/config.toml` written by the Codex adapter and the upstream `openai/codex` reference (and the existing `README.md`) documentation.
- Improved resilience and observability of the maintenance loop: (1) the controller now retries transient GitHub gates — `mergeStateStatus`/`mergeable` `UNKNOWN` and secondary/first-party rate-limit messages — with bounded backoff instead of mis-flagging a healthy PR as failed; (2) added an opt-in `AUTO_UN_DRAFT_PRS` setting (off by default) that safely marks a non-conflicting CLEAN draft PR ready for review (never auto-merges); (3) added a concise per-run Telegram digest summarizing every in-scope PR and the discovery outcome, so the loop is no longer silent between milestones.
- Fixed controller E2E validation on headless hosts: the `test:e2e` step (which launches a real VS Code window via `vscode-test`) now runs under `xvfb-run -a` when no `DISPLAY` is set. Previously it crashed with "Missing X server"/SIGSEGV, so the controller reported "controller validation did not pass" on every PR and could not certify 100% locally even when GitHub CI was green. Adds regression tests for the xvfb wrap (and its absence when a display is present).
- Refined maintenance run status handling: a `discovery-deferred` run is only reported as incomplete (non-zero exit) when actionable PR work is still waiting. A discovery deferred purely for a budget edge with no PR work pending is a successful completion (exit `0`), so Hermes no longer spuriously flags the scheduled job as `error`; discovery remains due for the next run.
- Fixed the Switchboard maintenance scheduler starvation bug: existing in-scope PRs now always converge before repository-wide discovery, and discovery is budgeted independently (bounded 300s session, safe minimum-budget threshold that reserves a PR convergence cycle). When budget or unfinished PR work prevents discovery, the controller records `discovery-deferred`, never reports it as a successful completion, and exits non-zero so Hermes marks the scheduled run incomplete. Discovery is limited to one session per run, at most one new Issue/PR, and `Fixes #<issue-number>` linking.
- Hardened Cline endpoint diagnostics to redact URL query credentials and expanded native configuration validation/error-path coverage to 100% statements and lines.
- Fixed Cline Tier A endpoint switching to write Cline's native `settings/providers.json` and `globalState.json` provider state, preserve unrelated providers/settings, verify both native paths, and retain backup-based rollback. Validated against upstream `cline/cline` commit `8bbdde2a5c1f972864fe1b954f639c21fac61a40` (`desktop-v0.0.13-2-g8bbdde2a5`, Cline VS Code `v4.1.10`); inspected `apps/vscode/package.json`, `apps/vscode/src/sdk/provider-migration.ts`, `apps/vscode/src/sdk/model-catalog/store.ts`, `apps/vscode/src/sdk/cline-session-factory.ts`, `sdk/packages/core/src/services/storage/provider-settings-manager.ts`, and `sdk/packages/shared/src/storage/paths.ts`. The CLI documentation exposes `CLINE_PROVIDER_SETTINGS_PATH`, but the current VS Code host explicitly uses `<CLINE_DATA_DIR>/settings/providers.json`, so the adapter follows the VS Code source. References: [OpenAI Compatible configuration](https://docs.cline.bot/provider-config/openai-compatible), [Cline provider storage guidance](https://github.com/cline/cline/blob/main/apps/cli/DEVELOPMENT.md), [upstream package schema](https://github.com/cline/cline/blob/main/apps/vscode/package.json), and [upstream provider settings manager](https://github.com/cline/cline/blob/main/sdk/packages/core/src/services/storage/provider-settings-manager.ts).
- Added the documented Hermes-based daily and weekly maintenance workflow, provider reference manifest, safe `pub-refs` synchronization utility, and VSIX exclusions for maintenance/runtime artifacts.
- Updated Hermes maintenance to run twice daily at 12:00 and 19:00 Asia/Jerusalem, deliver actionable results to Telegram, bootstrap validation dependencies, and enforce the dedicated worktree at runtime.
- Hardened maintenance convergence with a deterministic PR gate, bounded Codex/reviewer comment fix loop, provider-reference refreshes for new gaps, timeout-safe upstream synchronization, and a dedicated verified Hermes worktree.
- Expanded maintenance PR scope to process existing `fix/*` branches and review Dependabot branches read-only.
- Corrected Gemini CLI routing guidance to support the upstream `GOOGLE_GEMINI_BASE_URL` and `GOOGLE_VERTEX_BASE_URL` environment-variable overrides.
- Upgraded CI and release workflows to Node.js 24.19.0 LTS.
- Patched transitive development dependencies for known security advisories and locked the safe `diff` and `serialize-javascript` versions.
- Updated the VS Code extension test runner to resolve current macOS app executables and pinned CI to Node.js 22, restoring Extension Development Host tests after VS Code removed the legacy `Electron` executable path.
- Fixed Continue and Codex adapter plans writing the endpoint URL over the entire configuration file instead of applying the existing JSON/TOML config patchers.
- Corrected Roo Code support against its archived 3.54.0 source: endpoint routing is now Tier C guided setup because provider profiles live in Roo Code's private SecretStorage rather than writable VS Code settings; verification no longer reports a false automatic success.
- Added unit tests covering Kilo Code adapter model-discovery branch (`discoverModels` returning slugs) and the no-models/no-config guided-steps path; restores 100% branch coverage required by the Kilo adapter coverage gate.
- Made `kiloConfigPatcher.test.ts` runner-portable by replacing the single platform-agnostic `.toContain('.config/kilo/kilo.jsonc')` assertion with explicit per-branch tests for `getKiloConfigPath()` (win32 with/without APPDATA, darwin, linux with/without XDG_CONFIG_HOME) using `vi.mock('os')`; fixes macOS and Windows CI failures without affecting the implementation.
- Bumped eslint, @typescript-eslint/parser, @typescript-eslint/eslint-plugin, and @stylistic/eslint-plugin to latest major versions (resolves peer dependency conflicts from dependabot PRs #45, #54, #55).

- Improved setup, verification, troubleshooting, administrator, and enterprise documentation with accurate command names, rollout prerequisites, configuration surfaces, and support escalation guidance.
- Improved error handling: silent `catch {}` blocks now log best-effort warnings via Logger for filesystem operations, config parsing, backup restoration, health-check probes, and dialect validation.
- Exported `isFileNotFoundError` from `fsSafe` utility and removed duplicate definition in applier.
- Added aggregated mapping-failure warning in Switchboard `applyPlan` so persistence issues are surfaced to the output channel.
- Hardened new diagnostics so logger failures cannot change safe filesystem or malformed-config fallback behavior, and kept dialect-validation skip output generic.
- Hardened shared adapter error handling for non-Error throwables and preserved fallback setting-key behavior when VS Code setting discovery fails.
- Extracted `BaseExtensionAdapter` and `VscodeSettingsAdapter` shared base classes, eliminating duplicated detect/apply/verify/error-handling boilerplate across all assistant adapters.
- Added unit tests for 9 previously untested or under-tested modules (http, statusBar, settingsScanner, continue/paths, detectCLIs, detectExtensions, authSchemes, dialectRules, profileSecrets) — 111 new tests.
- Fixed `redactUrl()` and `sanitizeUrl()` to strip embedded credentials (`user:pass@host`) from URLs before logging or display.
- Added `redactUrl()` to AIdome API endpoint debug logs so base URLs are never logged with sensitive fragments.
- Enforced `validateProfileName()` during profile creation to reject names with special characters.
- Patched `minimatch`, `qs`, and `tmp` devDependency vulnerabilities via `npm audit fix`.

## [1.4.5] - 2026-06-04

## [1.4.4] - 2026-06-04

## [1.4.3] - 2026-06-04

- Added the AIdome logo as the extension's root marketplace icon and the activity-bar/view icon, and renamed the custom view to `Assistants`.
- Added the same profile-creation `Auto-detect` dialect option to the Setup Wizard, clarifying that it defaults to `openai.chat_completions` and does not probe the endpoint.
- Unified the Setup Wizard and Manage Profiles create-profile flows so both collect profile type, optional tenant, and conditional authentication in the same order.
- Fixed Setup Wizard profile verification to test only the selected profile, and clarified nested profile-creation progress titles inside the wizard.
- Made passive success, warning, error, and info notifications non-blocking across profile-management and diagnostics flows, while keeping confirmation/action prompts blocking.
- Fixed Manage Profiles `Set Active Profile` to keep its notice passive while deferring the menu reopen by one task, preserving live profile-switch feedback without re-blocking other profile flows.
- Added a per-profile `Show Models & Providers` action in Manage Profiles so inventory can be fetched for the selected profile without switching the active profile first.
- Reordered profile actions in Manage Profiles to keep `Delete Profile` as the final action in the per-profile menu.
- Fixed verifier false negatives on split-DNS or internal hosts by switching the DNS precheck to the OS resolver path, and preserved warning states in legacy verification summaries and UI renderers.

## [1.4.2] - 2026-05-25

- Promoted Claude Code to Tier A because profile activation now rewrites its shared gateway settings and Anthropic auth token automatically; the remaining restart guidance is advisory only.
- Fixed Claude Code gateway setup for the VS Code panel by switching gateway auth rewrites from `ANTHROPIC_API_KEY` to `ANTHROPIC_AUTH_TOKEN`, and by clearing stale API-key settings that could force Claude Code back onto the wrong auth path.
- Clarified and worked around an upstream Anthropic Claude Code panel/login bug where custom `ANTHROPIC_API_KEY` gateway credentials could still trigger login loops, 401 errors, or incorrect first-party auth state in the native VS Code panel. CLI and direct API-key flows may still work, but the panel now uses the more reliable bearer-token path when the gateway supports it.

## [1.4.1] - 2026-05-24

- Fixed the Assistants TreeView to mark only assistants assigned to the active profile as configured, and stopped persisting Claude Code API keys into plaintext `settings.json` during gateway updates.
- Updated Cline registry entry `kind` from `vscode-extension` to `multi-ide` to reflect multi-IDE support (VS Code, Cursor, Windsurf, JetBrains, Zed, Neovim)
- Fixed Continue.dev registry/adapter mismatch: registry `configFileHints` now correctly references `config.json` (JSON format) to match the adapter implementation
- Updated Copilot registry note to clarify `debug.overrideProxyUrl` may break in future releases
- Fixed Kilo Code source URLs: replaced dead `docs.naga.ac` with current `kilo.ai/docs`
- Fixed broken source URLs for Continue, Roo Code, and Cline in the assistant registry
- Added Roo Code shutdown notice (May 15, 2026) to registry and adapter
- Added CodeGPT Marketplace 404 warning to registry notes
- Updated registry `updatedAt` to 2026-05-21

## [1.4.0] - 2026-05-20

### Added
- Assistants TreeView in Explorer panel: shows all registered assistants with Tier badge and configured/unconfigured status icon, refreshes after setup
- First-run "Configure Now" notification on activation when no endpoint profile exists (shown once per install)
- Real assistant detection integration: TreeView now uses `detectExtensions()` to show actual installation status instead of treating all assistants as installed
- Click-to-configure: clicking any assistant in the TreeView opens the Setup Wizard
- Welcome view: empty-state message with "Run Setup Wizard" link when no assistants are detected
- EventEmitter disposal: `_onDidChangeTreeData` is now properly disposed on extension deactivation (prevents memory leaks)
- `XDG_CONFIG_HOME` support: `getConfigDir()` respects the XDG Base Directory Specification on Linux

### Fixed
- AnythingLLM adapter: replace hardcoded `C:\Program Files\AnythingLLM` paths with `%ProgramFiles%`/`%ProgramFiles(x86)%` environment variable lookups for correct Windows support
- Claude Code adapter: revert config path to `~/.claude/settings.json` (used by Claude Code CLI on all platforms); the previous `getConfigDir('Claude')` incorrectly resolved to Claude Desktop paths on Windows and macOS

## [1.3.1] - 2026-05-20

### Fixed

- Fixed `MODULE_NOT_FOUND` crash for `jsonc-parser` when the extension is installed from VSIX — `.vscodeignore` was excluding `node_modules/**` but the extension uses `tsc` (no bundler), so production dependencies must ship in the package.
- Fixed `set-vscode-setting` plan steps crashing with "not a registered configuration" when a mapped assistant's extension is not installed on the target machine — the applier now logs a warning and skips the step instead of failing the entire assistant group.

## [1.3.0] - 2026-05-20

### Added

- Standalone `AIdome: Activate Profile` command (`aidome-switchboard.activateProfile`) — switch the active profile and automatically reapply automated adapter mappings. Accessible from both the command palette and the status-bar quick-actions menu.
- Profile selector now sorts alphabetically and shows dialect as detail line.
- URL credential redaction in profile QuickPick display.
- Typed QuickPick generics for status-bar actions and profile selector.

### Removed

- Reverted Control Center feature (PR #53) — the multi-page product panel, guided-steps compatibility layer, and associated UI complexity have been removed in favour of the simpler command-palette workflow.

### Fixed
- Resolved Vitest v4 / ES2022 test mock incompatibility (`Class constructors cannot be invoked without 'new'`) across `applier`, `claudeCodePlanApplier`, and `setupSwitchboard` test suites.

## [1.2.0] - 2026-05-17

## [1.1.0] - 2026-05-14

### Changed

- Upgraded Claude Code to Tier B automated gateway configuration using shared `~/.claude/settings.json` for `ANTHROPIC_BASE_URL`, plus VS Code login-prompt suppression and credential guidance.
- Fixed endpoint verification to send stored profile auth tokens during reachability and model-list checks, and normalized versioned path joins so `/v1` base URLs no longer produce duplicated `/v1/v1/...` probes.
- Improved dialect validation so the verifier probes the configured API route and flags `openai.responses` vs `openai.chat_completions` mismatches instead of reporting a false pass.
- Fixed the TLS verifier to treat an authorized TLS handshake as a pass even when Node cannot extract peer certificate metadata, avoiding false warnings on valid endpoints.

## [1.0.0] - 2026-04-24

### Added

- New `aidome-switchboard.advanced.tlsVerify` setting (default: `true`) to toggle TLS certificate verification for all extension HTTPS requests. Disable only for trusted internal endpoints with self-signed certificates. Environment override: `AIDOME_SWITCHBOARD_TLS_VERIFY`.
- Added `tlsVerification` metadata to the assistant registry documenting each assistant's TLS verification support level (`native`, `env-var`, `vscode-global`, or `none`).

## [0.8.0] - 2026-04-24

### Changed

- Maintained changelog hygiene by ensuring the `[Unreleased]` section is always present so the automated `prepare-release.yml` workflow can promote it without manual intervention.

## [0.7.0] - 2026-04-24

- Fixed TypeScript compile errors caused by adapter-specific fields (`tier`, `action`, `limitation`, `envVarName`, `optional`, `configurationType`) not being declared on `GuidedStepsData`, and by `GuidedStepsData` lacking an index signature needed for assignability to `PlanStep.data: Record<string, unknown>`.
- Fixed `show-guided-steps` plan steps failing for Kilo Code and Cline when no VS Code settings keys were auto-discovered: both adapters now supply a `steps` array with actionable manual-configuration instructions.
- Made `applyGuidedSteps` in the plan applier defensive: when the `steps` array is absent the `message` field is displayed instead of throwing, preventing plan application from crashing for any future adapter in a similar situation.

## [0.6.0] - 2026-04-24

- Clarified GitHub Copilot support to document the proxy override path only and added risk notes for Copilot, Cline, and Codex integrations that depend on undocumented or fast-moving upstream behavior.
- Removed unused generic adapter and wizard screen scaffolds, and replaced placeholder tests with concrete adapter registry and wizard flow coverage.
- Hardened the diagnostics webview by escaping rendered diagnostics data, disabling scripts, adding a restrictive Content Security Policy, and handling undefined payloads without throwing.

## [0.5.0] - 2026-04-24

---

## [0.4.0] - 2026-04-24

---

## [0.3.0] - 2026-04-24

### Added

- E2E test harness using `@vscode/test-cli` with a multi-OS CI matrix (Ubuntu, Windows, macOS)

---

## [0.2.0] - 2026-03-23

### Changed

#### GitHub Copilot — Upgraded from Tier C to Tier B

- **Proxy Override support**: `GitHubCopilotAdapter` now writes
  `github.copilot.advanced.debug.overrideProxyUrl` as a reversible VS Code setting,
  routing all Copilot REST traffic (inline completions + chat) through the configured
  gateway endpoint.
- Configuration is recorded in the change log and can be undone via
  **AIdome: Reset Switchboard**.
- `verify()` now checks whether proxy override is active and reports
  `proxyOverrideConfigured` in its result details.
- Registry updated: `endpointSwitching.supported = true`, `tier = "B"`,
  `configurationModes` set to `proxy-override`.
- ⚠️ Note: `debug.overrideProxyUrl` is an undocumented internal Copilot setting.
  It may change or be removed in future Copilot extension updates.

---

## [0.1.0] - 2026-02-09

### Added

#### Core Engine
- Detection engine: scans for 11 AI assistants (extensions + CLIs)
- Profile management: create, delete endpoint profiles with encrypted auth storage
- Dialect engine: 6 API protocol types with auto-detection and compatibility checking
- AIdome discovery client: fetches capabilities, models, providers from gateway
- Compatibility engine: validates assistant-dialect compatibility with suggestions
- Orchestration: plan builder, applier with backup, verifier, diagnostics

#### Adapters — Tier A (Full Automation)
- Continue.dev: config.json patching with YAML/JSON support
- Cline: VS Code settings auto-configuration
- Roo Code: VS Code settings auto-configuration  
- Kilo Code: VS Code settings auto-configuration
- OpenAI Codex CLI: config.toml + environment variable configuration

#### Adapters — Tier B (Partial / Guided)
- CodeGPT: auto-discovery of settings keys with guided fallback
- AnythingLLM: guided configuration with clipboard actions

#### Adapters — Tier C (Informational / Guided)
- Claude Code: guided with env var support
- GitHub Copilot: detection + limitation explanation + alternatives
- Gemini CLI: detection + limitation explanation + alternatives
- Tabnine: detection + proprietary protocol explanation + enterprise guidance

#### Generic Scanner
- Heuristic settings scanner for unknown/future extensions
- Confidence scoring (high/medium/low) for discovered settings keys
- Blocklist filtering for false positives

#### Enterprise Features
- 7-step verification pipeline (DNS → TLS → Reachability → Health → Models → Dialect → Test Prompt)
- Full change tracking with undo capability
- Granular reset: per-assistant, per-profile, or factory reset
- Remote environment detection (SSH, Dev Containers, Codespaces, WSL)
- Remote-aware warnings (localhost + remote, path mismatches)
- Diagnostics report export (JSON/Markdown) with guaranteed secret redaction
- Status bar with profile status and quick actions

#### UI
- Setup wizard with 9-step flow
- Tier badges in wizard ([Auto], [Partial], [Guided])
- Profile management CRUD via QuickPick
- Verification results with ✅/⚠️/❌ icons and actionable errors
- OutputChannel logging with automatic secret redaction

#### Security
- SecretStorage for all auth tokens (never in settings files)
- Zero telemetry
- Automatic backup before any configuration change
- Pattern-based secret redaction in all outputs
- Safe-to-share diagnostics reports

### Security
- No secrets are ever logged, stored in plain text, or included in diagnostics
- All auth tokens use VS Code's encrypted SecretStorage API
