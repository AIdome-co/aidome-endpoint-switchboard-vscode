# LLM Endpoint Switchboard — GA Readiness Report

> **Last updated:** 2026-05-20
> **Current version:** 1.3.1
> **Extension ID:** aidome.aidome-endpoint-switchboard

---

## Executive Summary

The LLM Endpoint Switchboard VS Code extension configures AI coding assistants to route through enterprise-approved LLM endpoints via the AIdome gateway. As of v1.3.1, the extension supports 11 AI assistants across three automation tiers, with a mature adapter architecture, comprehensive test suite (600+ tests across 43 test files), and automated CI/CD pipelines.

This document tracks everything completed to date and everything remaining before General Availability (GA).

---

## Table of Contents

1. [What Has Been Done](#1-what-has-been-done)
2. [Current Assistant Support Matrix](#2-current-assistant-support-matrix)
3. [Architecture and Code Quality](#3-architecture-and-code-quality)
4. [Security Posture](#4-security-posture)
5. [Test Coverage](#5-test-coverage)
6. [CI/CD and Release Infrastructure](#6-cicd-and-release-infrastructure)
7. [Documentation](#7-documentation)
8. [What Remains To Do](#8-what-remains-to-do)
9. [Claude Code — Detailed Status](#9-claude-code--detailed-status)
10. [Industry Comparison and Competitive Position](#10-industry-comparison-and-competitive-position)
11. [Risk Register](#11-risk-register)
12. [Version History Milestones](#12-version-history-milestones)
13. [References and Citations](#13-references-and-citations)

---

## 1. What Has Been Done

### 1.1 Core Engine (Complete)

| Capability | Status | Version Introduced |
|---|:---:|---|
| Detection engine — scans for 11 AI assistants (extensions + CLIs) | Done | 0.1.0 |
| Profile management — create, edit, delete endpoint profiles | Done | 0.1.0 |
| Encrypted auth storage via vscode.SecretStorage | Done | 0.1.0 |
| Dialect engine — 8 API protocol types with auto-detection | Done | 0.1.0 |
| AIdome discovery client — capabilities, models, providers | Done | 0.1.0 |
| Compatibility engine — assistant-dialect validation with suggestions | Done | 0.1.0 |
| Orchestration — plan builder, applier with backup, verifier, diagnostics | Done | 0.1.0 |
| Lazy adapter loading via dynamic import() | Done | 0.5.0 |
| Automatic rollback on apply() failures | Done | 0.5.0 |
| Corrupted registry fallback to hardcoded minimal registry | Done | 0.5.0 |
| Corrupted profile state handling with reset notification | Done | 0.5.0 |
| Configurable network timeout (HTTP_TIMEOUT_MS, default 10s) | Done | 0.5.0 |
| Concurrent wizard prevention (mutex flag) | Done | 0.5.0 |
| State version migration mechanism | Done | 0.5.0 |
| File lock handling (EBUSY/EACCES) with retry logic | Done | 0.5.0 |
| Symlink resolution in backup/write operations | Done | 0.5.0 |
| TLS certificate verification toggle (tlsVerify setting) | Done | 1.0.0 |
| Standalone Activate Profile command with auto-reapply | Done | 1.3.0 |
| Profile selector with alphabetical sort and dialect detail | Done | 1.3.0 |

### 1.2 Adapter Implementations (Complete)

| # | Assistant | Adapter Key | Tier | Config Mechanism | Status |
|---:|---|---|:---:|---|:---:|
| 1 | Continue.dev | continue | A | YAML config file (~/.continue/config.yaml) | Done |
| 2 | Cline | cline | A | VS Code settings (scan contributes.configuration) | Done |
| 3 | Roo Code | roo-code | A | VS Code settings (roo-cline.*) | Done |
| 4 | Kilo Code | kilo-code | A | VS Code settings (kilocode.*) | Done |
| 5 | OpenAI Codex CLI | openai-codex | A | TOML config (~/.codex/config.toml) + env vars | Done |
| 6 | CodeGPT | codegpt | B | VS Code settings with guided fallback | Done |
| 7 | AnythingLLM | anythingllm | B | Guided configuration with clipboard actions | Done |
| 8 | **Claude Code** | **claude-code** | **B** | **~/.claude/settings.json + VS Code settings** | **Done** |
| 9 | GitHub Copilot | github-copilot | B | VS Code settings (debug.overrideProxyUrl) | Done |
| 10 | Gemini CLI | gemini-cli | C | Detection + limitation explanation | Done |
| 11 | Tabnine | tabnine | C | Detection + proprietary protocol explanation | Done |

### 1.3 Enterprise Features (Complete)

| Feature | Status | Details |
|---|:---:|---|
| 7-step verification pipeline | Done | DNS, TLS, Reachability, Health, Models, Dialect, Test Prompt |
| Full change tracking with undo | Done | Per-step rollback with AppliedStep.createdFile flag for new files |
| Granular reset | Done | Per-assistant, per-profile, or factory reset |
| Remote environment detection | Done | SSH, Dev Containers, Codespaces, WSL |
| Remote-aware warnings | Done | Localhost + remote mismatches, path discrepancies |
| Diagnostics report export | Done | JSON/Markdown with guaranteed secret redaction |
| Status bar with profile status | Done | Quick actions menu, profile activation |
| URL credential redaction in UI | Done | QuickPick display strips credentials |
| HTTP retry with exponential backoff | Done | Configurable max backoff (httpRetryBackoffMaxMs) |
| AIdome capabilities cache with TTL | Done | Configurable TTL (aidomeClientCacheTtlMs, default 60s) |
| CLI detection timeout | Done | Configurable per-subprocess (cliDetectionTimeoutMs, default 2s) |

### 1.4 UI (Complete)

| Component | Status | Details |
|---|:---:|---|
| Setup wizard (9-step flow) | Done | Detect, Profile, Apply, Verify |
| Tier badges in wizard | Done | [Auto], [Partial], [Guided] |
| Profile management CRUD | Done | QuickPick with typed generics |
| Verification results display | Done | Icons with actionable errors |
| OutputChannel logging | Done | [LEVEL] [TIMESTAMP] format, auto-redaction |
| Diagnostics webview | Done | Escaped rendering, disabled scripts, CSP hardened |
| Status bar with quick actions | Done | Profile display, activation, verification shortcuts |

---

## 2. Current Assistant Support Matrix

### 2.1 Dialect Compatibility

| Assistant | Primary Dialect | Also Supports |
|---|---|---|
| Continue.dev | openai.chat_completions | openai.responses, anthropic.messages, google.gemini.generate_content |
| Cline | openai.chat_completions | openai.responses, anthropic.messages, google.gemini.generate_content |
| Roo Code | openai.chat_completions | openai.responses, anthropic.messages, google.gemini.generate_content |
| Kilo Code | openai.chat_completions | openai.responses, anthropic.messages, google.gemini.generate_content |
| OpenAI Codex CLI | openai.responses | openai.chat_completions |
| **Claude Code** | **anthropic.messages** | **bedrock.invoke_model, vertex.raw_predict** |
| GitHub Copilot | github.copilot | — |
| CodeGPT | openai.chat_completions | openai.responses, anthropic.messages, google.gemini.generate_content |
| AnythingLLM | openai.chat_completions | openai.responses |
| Gemini CLI | google.gemini.generate_content | openai.chat_completions |
| Tabnine | tabnine.proprietary | — |

### 2.2 TLS Verification Support

| Assistant | TLS Mechanism | Setting/Env Var |
|---|---|---|
| Continue.dev | Native (per-model) | requestOptions.rejectUnauthorized in config.json |
| Cline | VS Code global | http.proxyStrictSSL |
| Roo Code | VS Code global | http.proxyStrictSSL |
| Kilo Code | VS Code global | http.proxyStrictSSL |
| OpenAI Codex CLI | Env var (custom CA only) | CODEX_CA_CERTIFICATE / SSL_CERT_FILE |
| **Claude Code** | **Env var** | **ANTHROPIC_DISABLE_TLS_VERIFY=true** |
| GitHub Copilot | VS Code global | http.proxyStrictSSL |
| CodeGPT | VS Code global | http.proxyStrictSSL |
| AnythingLLM | Env var | NODE_TLS_REJECT_UNAUTHORIZED=0 |
| Gemini CLI | None | No documented mechanism |
| Tabnine | VS Code global | http.proxyStrictSSL / NODE_EXTRA_CA_CERTS |

---

## 3. Architecture and Code Quality

### 3.1 Layer Architecture

| Layer | Directory | Responsibility | Status |
|---|---|---|:---:|
| Adapters | src/adapters/ | Per-assistant config read/write in native format | Done (13 adapters) |
| Core | src/core/ | Profiles, registry, orchestration, detection, dialects | Done |
| Commands | src/commands/ | Thin VS Code command handlers (7 commands) | Done |
| UI | src/ui/ | Wizard, notifications, output, status bar, diagnostics | Done |
| Utilities | src/util/ | Logger, file ops, HTTP, JSONC, paths, redaction, retry | Done |
| Config | src/config/ | Runtime settings resolution | Done |

### 3.2 Code Metrics

| Metric | Value |
|---|---:|
| Total TypeScript source lines | ~11,700 |
| Adapter implementations | 13 (11 named + generic scanner + index) |
| VS Code commands registered | 7 |
| Configuration properties | 4 |
| Registry-defined assistants | 11 |
| Dialect catalog entries | 8 |
| Architecture Decision Records | 4 |

### 3.3 Architecture Decision Records

| ADR | Title | Status |
|---|---|:---:|
| ADR-001 | Profiles over flat base_url | Accepted |
| ADR-002 | Dialect-first design | Accepted |
| ADR-003 | Backup before modify | Accepted |
| ADR-004 | Guided tier for unsupported assistants | Accepted |

---

## 4. Security Posture

### 4.1 Security Invariants

| Invariant | Enforced By | Status |
|---|---|:---:|
| SecretStorage for all credentials | Code review + architecture rules | Done |
| No console.log in source | ESLint no-console rule + pre-release validation test | Done |
| Redact before logging | Logger auto-redaction + second-pass in diagnostics | Done |
| Backup-before-modify | ADR-003 + adapter pattern + AppliedStep.createdFile tracking | Done |
| URL validation (scheme allowlist) | apiUrl.ts validator rejects javascript:, data:, file: | Done |
| Adapter interface only for config writes | Architecture rules + code review | Done |
| Path validation | Rejects .. traversal and null bytes | Done |
| Profile name sanitization | Alphanumeric + hyphens/underscores, max 64 chars | Done |
| Secret key namespacing | aidome-switchboard.profile.NAME.authToken | Done |
| Diagnostics webview hardened | Escaped rendering, scripts disabled, restrictive CSP | Done |
| Zero telemetry | No telemetry code present | Done |
| Config-file content redaction in change log | applier.ts redacts file content before recording | Done |

### 4.2 Security Scan Results

| Tool | Result | Last Run |
|---|---|---|
| CodeQL | 0 alerts | v1.0.0 milestone |
| ESLint security rules | Passing | Every CI run |
| Pre-release validation | Passing | Every CI run |

---

## 5. Test Coverage

### 5.1 Test Suite Overview

| Category | Files | Approximate Tests | Status |
|---|---:|---:|:---:|
| Unit — Adapters | 12 | ~350 | Done |
| Unit — Core (orchestration, profiles, detection, registry) | 6+ | ~150 | Done |
| Unit — Utilities (redaction, notifications, diagnostics, runtime settings) | 6 | ~50 | Done |
| Unit — Package/README/VSIX validation | 3 | ~20 | Done |
| Integration — Extension host + wizard flow | 2 | ~10 | Done |
| E2E — VS Code test CLI | 1+ | varies | Done |
| Pre-release validation | 1 | ~22 | Done |
| **Total** | **43** | **~600+** | **Done** |

### 5.2 Adapter Test Coverage

| Adapter | Dedicated Test File | Status |
|---|---|:---:|
| Continue.dev | continueAdapter.test.ts | Done |
| Cline | clineAdapter.test.ts | Done |
| Roo Code | roocodeAdapter.test.ts | Done |
| Kilo Code | kilocodeAdapter.test.ts | Done |
| OpenAI Codex CLI | codexAdapter.test.ts + codexConfigPatcher.test.ts | Done |
| CodeGPT | codegptAdapter.test.ts | Done |
| AnythingLLM | anythingllmAdapter.test.ts | Done |
| **Claude Code** | **claudeCodeAdapter.test.ts + claudeCodeConfigPatcher.test.ts + claudeCodePlanApplier.test.ts** | **Done** |
| GitHub Copilot | githubCopilotAdapter.test.ts | Done |
| Gemini CLI | geminiCliAdapter.test.ts | Done |
| Tabnine | tabnineAdapter.test.ts | Done |

---

## 6. CI/CD and Release Infrastructure

### 6.1 Workflows

| Workflow | File | Trigger | Status |
|---|---|---|:---:|
| CI (lint + compile + test + package) | ci.yml | Push / PR | Done |
| PR Auto-Labeler | pr-auto-labeler.yml | PR events | Done |
| Prepare Release | prepare-release.yml | Manual dispatch | Done |
| Release (publish to Marketplace) | release.yml | Tag push | Done |

### 6.2 Release Process

| Step | Mechanism | Status |
|---|---|:---:|
| Changelog — [Unreleased] pattern | Keep a Changelog convention | Done |
| Version bump + changelog promotion | prepare-release.yml workflow | Done |
| VSIX packaging | vsce package via npm run package | Done |
| Marketplace publishing | release.yml with vsce publish | Done |
| GitHub Release creation | Automated via workflow | Done |
| .vscodeignore — ships node_modules (no bundler) | Fixed in v1.3.1 | Done |

---

## 7. Documentation

### 7.1 Documentation Status

| Document | Location | Status |
|---|---|:---:|
| README with architecture diagram | README.md | Done |
| Changelog (Keep a Changelog format) | CHANGELOG.md | Done |
| Admin deployment guide | docs/admin-guide.md | Done |
| Enterprise installation guide | docs/enterprise-install.md | Done |
| ADR-001 through ADR-004 | docs/adr/ | Done |
| Claude Code gateway plan | docs/plan/pr39-claude-code-gateway-plan.md | Done |
| Milestone 5 summary | MILESTONE5-SUMMARY.md | Done (archived) |
| Agent instructions (AGENTS.md, CLAUDE.md) | Root | Done |
| Copilot instructions hub | .github/copilot-instructions.md | Done |
| TypeScript source rules | .github/instructions/typescript-extension.instructions.md | Done |
| Testing conventions | .github/instructions/testing.instructions.md | Done |
| Architecture reference | .github/references/architecture.md | Done |
| Security rules reference | .github/references/security-rules.md | Done |
| Coding guidelines reference | .github/references/coding-guidelines.md | Done |
| Skills (adapter-dev, packaging, CI debugging, CodeQL, etc.) | .github/skills/ | Done |

---

## 8. What Remains To Do

### 8.1 High Priority (GA Blockers)

| # | Task | Category | Rationale | Status |
|---:|---|---|---|:---:|
| 1 | Bundler integration (esbuild/webpack) | Packaging | Currently ships node_modules in VSIX; increases package size and attack surface. Industry standard is to bundle. | Not started |
| 2 | Full JSDoc on all public APIs | Code Quality | Partial coverage exists; complete JSDoc improves onboarding and API documentation generation. | Partial |
| 3 | Multi-root workspace test coverage | Testing | Code handles multi-root but no dedicated tests exist. | Not started |
| 4 | Localization / l10n framework | UX | All strings are hardcoded English. VS Code supports vscode.l10n for localization. | Not started |

### 8.2 Medium Priority (Post-GA Enhancements)

| # | Task | Category | Rationale | Status |
|---:|---|---|---|:---:|
| 5 | Claude Code — richer setup UX | UX | No dedicated provider picker, credential input, or connection test specific to Claude Code. Current UX at 60% vs. industry best practices. | Not started |
| 6 | Claude Code — Tier A promotion investigation | Adapter | Tier B because credential injection cannot be fully automated without violating SecretStorage invariant. Investigate apiKeyHelper automation. | Not started |
| 7 | Walkthrough contribution (contributes.walkthroughs) | UX | VS Code walkthroughs improve first-run experience. 5/10 industry competitors have them. | Not started |
| 8 | Telemetry opt-in framework | Enterprise | Enterprise customers may want usage analytics. Currently zero telemetry. | Not started |
| 9 | Adapter for Windsurf/Codeium | Adapter | Listed in industry analysis but not yet in the registry or adapter directory. | Not started |
| 10 | Adapter for Amazon Q Developer | Adapter | Locked to AWS IAM but enterprise customers may request guidance integration. | Not started |
| 11 | Adapter for JetBrains AI Assistant (VS Code preview) | Adapter | VS Code extension still in preview; monitor for stability. | Not started |
| 12 | Adapter for Cursor | Adapter | Standalone IDE — out of scope for VS Code extension, but could provide informational tier. | Not started |
| 13 | WebSocket / streaming verification | Verification | Current 7-step verification is HTTP-only. Some assistants use streaming connections. | Not started |

### 8.3 Low Priority (Nice to Have)

| # | Task | Category | Rationale | Status |
|---:|---|---|---|:---:|
| 14 | Visual Studio extension (separate product) | New Product | Only 3/10 assistants support Visual Studio; requires full C# rewrite. Not feasible as port. | Not started |
| 15 | JetBrains plugin (separate product) | New Product | 7/10 assistants have JetBrains support; larger addressable market than Visual Studio. | Not started |
| 16 | Dedicated diagnostics panel (beyond webview) | UX | TreeView-based diagnostics with live status per-assistant. | Not started |
| 17 | Per-assistant cost/token tracking integration | UX | Only Cline and Claude Code expose this; low cross-assistant applicability. | Not started |
| 18 | Open VSX publishing | Distribution | Reach VS Code forks (VSCodium, Gitpod, etc.). | Not started |
| 19 | Configuration profiles import/export | Enterprise | Allow admins to distribute pre-configured profiles as JSON files. | Not started |
| 20 | Extension settings sync support | UX | Ensure profiles and settings survive VS Code Settings Sync. | Not started |

---

## 9. Claude Code — Detailed Status

### 9.1 Implementation Status

| Aspect | Status | Details |
|---|:---:|---|
| Adapter (src/adapters/claudeCode/adapter.ts) | Done | Plan generation: config-file edit, VS Code setting, guided auth, verification |
| Config patcher (claudeCodeConfigPatcher.ts) | Done | Writes env.ANTHROPIC_BASE_URL and CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY to ~/.claude/settings.json |
| VS Code setting integration | Done | Sets claudeCode.disableLoginPrompt = true for third-party setups |
| Detection | Done | Checks anthropic.claude-code extension + claude CLI on PATH |
| Backup-before-modify | Done | Existing files backed up; createdFile flag tracks new files for rollback |
| URL validation | Done | Endpoint URLs validated against scheme allowlist |
| Secret handling | Done | No plaintext credentials written; guides ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY / apiKeyHelper |
| Config path resolution | Done | Respects CLAUDE_CONFIG_DIR override |
| Registry metadata | Done | Tier B, Anthropic Messages dialect, 4 official doc sources |
| Unit tests | Done | 3 test files: adapter, config patcher, plan applier |
| Documentation | Done | README, admin guide, changelog, registry notes |

### 9.2 Claude Code Upgrade History

| Version | Tier | What Changed |
|---|:---:|---|
| 0.1.0 | C | Initial: detection + guided steps only |
| 1.1.0 | B | PR #39: Automated ~/.claude/settings.json patching, VS Code login suppression, gateway model discovery |
| 1.3.0 | B | Test fixes for Vitest v4 / ES2022 compatibility |

### 9.3 Claude Code — Known Gaps

| Gap | Impact | Mitigation Path |
|---|---|---|
| No custom base URL in standard Claude Code product UI | Users must set ANTHROPIC_BASE_URL via settings file or env var | AIdome adapter handles this automatically |
| apiKeyHelper not auto-configured | Credential injection remains manual | Investigate helper script generation in follow-up |
| No dedicated Claude Code setup UX in AIdome | Generic wizard flow; no provider picker or connection test specific to Claude | Design Claude-specific wizard screens |
| OpenAI Chat Completions endpoints not natively supported | Gateway must translate to Anthropic Messages format | Document requirement; LiteLLM Anthropic pass-through is a known solution |

---

## 10. Industry Comparison and Competitive Position

### 10.1 Endpoint Routing Feasibility per Assistant

| Assistant | Custom Base URL? | AIdome Adapter | Routing Mechanism |
|---|:---:|:---:|---|
| GitHub Copilot | Yes | Done (Tier B) | settings.json proxy URL override |
| **Claude Code** | **Partial** | **Done (Tier B)** | **ANTHROPIC_BASE_URL in ~/.claude/settings.json** |
| Continue | Yes | Done (Tier A) | JSONC config.yaml model provider apiBase |
| Cline | Yes | Done (Tier A) | VS Code settings apiUrl |
| Roo Code | Yes | Done (Tier A) | VS Code settings openAiBaseUrl |
| Kilo Code | Yes | Done (Tier A) | VS Code settings openaiBaseUrl |
| OpenAI Codex CLI | Yes | Done (Tier A) | TOML config providers.NAME.base_url |
| CodeGPT | Yes | Done (Tier B) | VS Code settings with guided fallback |
| AnythingLLM | Yes | Done (Tier B) | Guided Generic OpenAI provider setup |
| Gemini CLI | No | Done (Tier C) | No base URL override — info only |
| Tabnine | No | Done (Tier C) | Proprietary protocol — info only |
| Windsurf/Codeium | Partial | Not started | YAML config — not yet implemented |
| Amazon Q | No | Not started | AWS IAM only |
| JetBrains AI | No | Not started | JetBrains-managed — no custom endpoint |
| Cursor | Yes | Not started | Standalone IDE — out of scope |

### 10.2 UX Pattern Coverage vs. Industry

| UX Pattern | AIdome Has It? | Industry Adoption (of 10 leaders) |
|---|:---:|---:|
| Chat panel / sidebar | N/A (config tool, not assistant) | 100% |
| VS Code extension | Yes | 90% |
| Diff preview before apply | No (config changes, not code) | 90% |
| Agentic multi-file editing | N/A | 80% |
| Model picker / selector | Yes (via AIdome discovery) | 80% |
| Custom base URL / endpoint | Yes (core feature) | 60% |
| Enterprise SSO / org admin | Partial (profiles, no SSO) | 50% |
| Onboarding wizard | Yes (9-step wizard) | 50% |
| Human approval gate | Yes (backup-before-modify) | 30% |
| Config stored as editable file | Yes (assistant-native formats) | 30% |
| Token/cost tracking | No | 20% |
| Security scanning | No | 10% |

---

## 11. Risk Register

| # | Risk | Severity | Likelihood | Mitigation |
|---:|---|:---:|:---:|---|
| 1 | GitHub Copilot debug.overrideProxyUrl removed in future update | High | Medium | Document as undocumented setting; monitor Copilot releases; degrade gracefully to Tier C |
| 2 | Claude Code ANTHROPIC_BASE_URL behavior changes | Medium | Low | Pin to documented behavior; version-guard in adapter |
| 3 | Cline/Roo Code settings keys change between releases | Medium | Medium | Runtime contributes.configuration scanning mitigates |
| 4 | VSIX size bloat without bundler | Low | High | Ship with node_modules works but is non-standard; bundler integration is a GA priority |
| 5 | LiteLLM supply chain risk for Claude Code gateway users | High | Low | Document advisory (PyPI v1.82.7/1.82.8); recommend pinned versions and credential rotation |
| 6 | Missing Windsurf/Codeium adapter limits market coverage | Medium | High | Implement adapter — medium complexity (YAML config) |
| 7 | No l10n limits international adoption | Low | Medium | VS Code vscode.l10n framework available; implement pre-GA or shortly after |

---

## 12. Version History Milestones

| Version | Date | Key Changes |
|---|---|---|
| 0.1.0 | 2026-02-09 | Initial release: 11 assistants, 6 dialects, core engine, security hardening |
| 0.2.0 | 2026-03-23 | GitHub Copilot upgraded from Tier C to Tier B (proxy override) |
| 0.3.0 | 2026-04-24 | E2E test harness with multi-OS CI matrix |
| 0.4.0 | 2026-04-24 | Internal improvements |
| 0.5.0 | 2026-04-24 | Milestone 5: error resilience, lazy loading, security hardening, accessibility |
| 0.6.0 | 2026-04-24 | Diagnostics webview hardening, placeholder test cleanup |
| 0.7.0 | 2026-04-24 | Guided steps fixes, defensive plan applier |
| 0.8.0 | 2026-04-24 | Changelog hygiene for automated releases |
| 1.0.0 | 2026-04-24 | GA candidate: TLS verification toggle, registry TLS metadata |
| 1.1.0 | 2026-05-14 | Claude Code upgraded to Tier B: ~/.claude/settings.json patching, gateway model discovery, endpoint verification fixes |
| 1.2.0 | 2026-05-17 | Internal improvements |
| 1.3.0 | 2026-05-20 | Activate Profile command, profile selector UX, Control Center reverted |
| 1.3.1 | 2026-05-20 | Fix MODULE_NOT_FOUND crash for VSIX installs, skip unregistered settings gracefully |

---

## 13. References and Citations

### 13.1 Project References

| Document | Path |
|---|---|
| Extension manifest | package.json |
| Changelog | CHANGELOG.md |
| Assistant registry | src/core/registry/assistants.registry.json |
| Architecture reference | .github/references/architecture.md |
| Security rules | .github/references/security-rules.md |
| Claude Code gateway plan | docs/plan/pr39-claude-code-gateway-plan.md |
| Milestone 5 summary | MILESTONE5-SUMMARY.md |
| ADR-001 through ADR-004 | docs/adr/ |

### 13.2 Claude Code Official Documentation

| Purpose | URL |
|---|---|
| Claude Code overview | https://docs.anthropic.com/en/docs/claude-code/overview |
| Claude Code LLM gateway | https://code.claude.com/docs/en/llm-gateway |
| Claude Code VS Code extension | https://code.claude.com/docs/en/vs-code |
| Claude Code third-party providers | https://code.claude.com/docs/en/vs-code#use-third-party-providers |
| Claude Code settings | https://code.claude.com/docs/en/settings |
| Claude Code JSON schema | https://json.schemastore.org/claude-code-settings.json |
| Claude Code repository | https://github.com/anthropics/claude-code |

### 13.3 Assistant Marketplace Links

| Assistant | URL |
|---|---|
| GitHub Copilot | https://marketplace.visualstudio.com/items?itemName=GitHub.copilot |
| Claude Code | https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code |
| Continue | https://marketplace.visualstudio.com/items?itemName=Continue.continue |
| Cline | https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev |
| Roo Code | https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline |
| Kilo Code | https://marketplace.visualstudio.com/items?itemName=kilocode.kilo-code |
| CodeGPT | https://marketplace.visualstudio.com/items?itemName=CodeGPT.codegpt |
| Tabnine | https://marketplace.visualstudio.com/items?itemName=TabNine.tabnine-vscode |
| Amazon Q Developer | https://marketplace.visualstudio.com/items?itemName=AmazonWebServices.amazon-q-vscode |
| JetBrains AI Assistant | https://marketplace.visualstudio.com/items?itemName=JetBrains.JetBrains-AI-Assistant |

### 13.4 VS Code Extension Development

| Purpose | URL |
|---|---|
| VS Code Extension API | https://code.visualstudio.com/api |
| VS Code SecretStorage API | https://code.visualstudio.com/api/references/vscode-api#SecretStorage |
| VS Code Settings UX guidelines | https://code.visualstudio.com/api/ux-guidelines/settings |
| VS Code Walkthrough UX guidelines | https://code.visualstudio.com/api/ux-guidelines/walkthroughs |
| VS Code Webview security | https://code.visualstudio.com/api/extension-guides/webview |

### 13.5 Gateway and Protocol References

| Purpose | URL |
|---|---|
| LiteLLM documentation | https://docs.litellm.ai/ |
| Anthropic Messages API | https://docs.anthropic.com/en/api/messages |
| OpenAI Chat Completions API | https://platform.openai.com/docs/api-reference/chat |
| OpenAI Responses API | https://platform.openai.com/docs/api-reference/responses |
| Amazon Bedrock InvokeModel | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html |
| Google Vertex AI rawPredict | https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.endpoints/rawPredict |

---

*This document is maintained alongside the extension codebase. Update it when adapters, features, or infrastructure change.*
