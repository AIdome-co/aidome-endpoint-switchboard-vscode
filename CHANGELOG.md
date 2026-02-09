# Changelog

All notable changes to the "LLM Endpoint Switchboard (by AIdome)" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
