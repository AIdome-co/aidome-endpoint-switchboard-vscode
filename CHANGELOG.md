# Changelog

All notable changes to the "LLM Endpoint Switchboard (by AIdome)" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed
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
