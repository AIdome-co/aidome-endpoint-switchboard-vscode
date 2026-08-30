# Changelog

All notable changes to the "LLM Endpoint Switchboard (by AIdome)" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

- Added an abstraction layer that resolves VS Code extension IDs for assistant detection from the market: `MarketplaceClient` queries the VS Code gallery API and `ExtensionIdResolver` validates declared registry IDs, falling back to resolving the canonical ID by display name when a declared ID is stale (so e.g. a wrong `CodeGPT.codegpt` no longer silently breaks detection). Added cached, parallel fallback detection and `npm run validate:registry`, a strict live-network CI gate that fails when any declared extension ID cannot be verified.
- Updated Tabnine Enterprise guidance and status reporting for manual server URL configuration, and aligned the GA-readiness documentation with the manual (non-auto-verified) Tier C setup.
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
- Upgraded CI and release workflows to Node.js 24.19.0 LTS.
- Patched transitive development dependencies for known security advisories and locked the safe `diff` and `serialize-javascript` versions.
- Updated the VS Code extension test runner to resolve current macOS app executables and pinned CI to Node.js 22, restoring Extension Development Host tests after VS Code removed the legacy `Electron` executable path.
- Fixed Continue and Codex adapter plans writing the endpoint URL over the entire configuration file instead of applying the existing JSON/TOML config patchers.
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
- Profile management: create, edit, delete endpoint profiles with encrypted auth storage
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
