# PR 39 Plan: Claude Code Gateway Configuration

## Source Context

| Source | Link | Key context |
|---|---|---|
| Issue #38 | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/issues/38 | Claude Code now officially supports third-party providers and LLM gateway routing, so the adapter should move beyond Tier C guided-only behavior. |
| PR #39 | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/pull/39 | Upgrades Claude Code to Tier B automation using shared CLI/VS Code settings in `~/.claude/settings.json`. |
| Base branch | `origin/main` at `bb4d56482ca701d40f10f3888f9238e67f75acf8` | Previous implementation treated Claude Code as guided-only and suggested proxy-based routing. |
| Current PR head reviewed | `3d1933a` | Current PR code was reviewed against main and validated locally. |

## Original Issue Goal

Claude Code was originally implemented as Tier C because no documented base URL override was known. Issue #38 states that Claude Code now documents third-party provider and LLM gateway support, so the extension should:

- Research Claude Code third-party provider and gateway configuration.
- Update the Claude Code registry metadata from Tier C to Tier A or B depending on automation feasibility.
- Rewrite the adapter to produce automated configuration steps.
- Add a config patcher following the existing adapter pattern.
- Verify the extension ID and CLI handling.
- Add unit tests and update documentation.

## PR Implementation Summary

| Area | Implemented in this PR | Files |
|---|---|---|
| Claude Code settings patcher | Adds a patcher for `~/.claude/settings.json`; writes `env.ANTHROPIC_BASE_URL` and `env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`. | `src/adapters/claudeCode/claudeCodeConfigPatcher.ts` |
| Adapter plan generation | Builds config-file edit, VS Code setting, guided auth, and verification steps. | `src/adapters/claudeCode/adapter.ts` |
| VS Code extension setting | Sets `claudeCode.disableLoginPrompt` for third-party provider setups. | `src/adapters/claudeCode/adapter.ts` |
| Verification | Checks Claude Code installation and presence of `ANTHROPIC_BASE_URL` in settings. | `src/adapters/claudeCode/adapter.ts` |
| Security | Validates endpoint URLs, avoids writing auth tokens/API keys, backs up existing config, and redacts config-file contents from the global change log. | `src/adapters/claudeCode/claudeCodeConfigPatcher.ts`, `src/core/orchestration/applier.ts` |
| Registry metadata | Updates Claude Code tier, sources, configuration hints, dialect, and notes. | `src/core/registry/assistants.registry.json` |
| Documentation | Updates supported assistant table, Claude Code gateway note, TLS notes, and changelog. | `README.md`, `docs/admin-guide.md`, `CHANGELOG.md` |
| Tests | Adds unit coverage for patching, planning, applying, verification, and redaction regressions. | `test/unit/claudeCodeAdapter.test.ts`, `test/unit/claudeCodeConfigPatcher.test.ts`, `test/unit/core/applier.test.ts` |

## Current Diff Footprint

| File | Status | Purpose |
|---|---|---|
| `CHANGELOG.md` | Modified | Adds an Unreleased entry for Claude Code Tier B gateway automation. |
| `README.md` | Modified | Updates Claude Code support tier and gateway routing guidance. |
| `docs/admin-guide.md` | Modified | Clarifies Claude Code TLS override is separate from gateway routing. |
| `src/adapters/claudeCode/adapter.ts` | Modified | Replaces guided-only behavior with automated plan steps and verification. |
| `src/adapters/claudeCode/claudeCodeConfigPatcher.ts` | Added | Builds Claude Code settings JSON safely from an endpoint profile. |
| `src/core/orchestration/applier.ts` | Modified | Redacts config-file content in global change-log recording. |
| `src/core/registry/assistants.registry.json` | Modified | Updates Claude Code registry metadata and documentation links. |
| `test/unit/claudeCodeAdapter.test.ts` | Modified | Updates adapter behavior expectations. |
| `test/unit/claudeCodeConfigPatcher.test.ts` | Added | Covers settings patching and security constraints. |
| `test/unit/core/applier.test.ts` | Modified | Covers config content redaction behavior. |

## Findings From Review Comment 4433742460

| Area | What PR did | Alignment | Still needed / risk |
|---|---|---:|---|
| Claude docs | Uses `~/.claude/settings.json`, `env.ANTHROPIC_BASE_URL`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, and `claudeCode.disableLoginPrompt`. | 90% | Add note or version guard: gateway model discovery requires Claude Code v2.1.129+ and only works for Anthropic Messages gateways. |
| Protocol support | Correctly targets Anthropic Messages gateway routing. | 90% | OpenAI-compatible `/v1/chat/completions` is not directly supported by Claude Code; a gateway must translate or expose Anthropic Messages, Bedrock, or Vertex APIs. |
| Adapter scope | Keeps Claude-specific logic in `src/adapters/claudeCode` plus registry metadata. | 85% | Minor architecture debt: adapter imports core validator/types; this follows existing patterns but is not ideal layering. |
| Apply path | Builds config-file, VS Code setting, guided auth, and verify steps. | 45% | `verify-endpoint` should not break executable application flow; production-path coverage should confirm Claude plans apply correctly. |
| Security | Does not write plaintext auth tokens; validates URLs; redacts config-file change-log content. | 75% | Rollback for newly-created `~/.claude/settings.json` should delete the created file or restore a recorded pre-create state. |
| Backup/undo | Existing files are backed up before edit. | 70% | Backup responsibility is duplicated/noisy; new-file rollback needs explicit semantics. |
| Tests | Adds patcher, adapter, and applier tests; local suite passed. | 80% | Add production-path test applying a Claude plan through `PlanApplier` or switchboard orchestration. |
| Docs | README, admin TLS note, registry, and changelog updated. | 85% | Clarify Anthropic-compatible gateway requirement and model discovery constraints. |
| UI/UX | No new UI; uses existing wizard and guided-step flow. | 55% | Industry leaders usually include provider picker, secure credential input, connection test, status, and actionable diagnostics. |

## ASCII Architecture Flow

```text
Setup Wizard
   |
   v
ClaudeCodeAdapter.buildPlan(profile)
   |
   |-- backup-file? existing ~/.claude/settings.json
   |
   |-- edit-config-file
   |      target: ~/.claude/settings.json
   |      env.ANTHROPIC_BASE_URL = profile.baseUrl
   |      env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY = "1"
   |
   |-- set-vscode-setting
   |      claudeCode.disableLoginPrompt = true
   |
   |-- show-guided-steps
   |      credentials stay outside plaintext config
   |      suggested auth: ANTHROPIC_AUTH_TOKEN,
   |                      ANTHROPIC_API_KEY,
   |                      or apiKeyHelper
   |
   `-- verify-endpoint / verify configuration
          confirm Claude Code has ANTHROPIC_BASE_URL configured
```

## Heatmap

```text
Official Claude docs alignment      █████████░ 90%
Gateway/protocol correctness        ████████░░ 80%
Security / secrets                  ███████░░░ 75%
Rollback / undo                     ██████░░░░ 60%
Production apply reliability        ████░░░░░░ 45%
Tests                               ████████░░ 80%
UX completeness                     █████░░░░░ 55%
Overall PR aim alignment            ███████░░░ 72%
```

## Official Documentation Alignment

| Reference area | Aligned behavior | Caveat |
|---|---|---|
| Claude Code LLM gateway docs | `ANTHROPIC_BASE_URL` is the documented gateway base URL override. Anthropic Messages gateway model discovery is enabled by `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`. | Discovery requires Claude Code v2.1.129+ and only applies to Anthropic Messages format, not Bedrock or Vertex pass-through endpoints. |
| Claude Code settings docs | `~/.claude/settings.json` is the documented user settings file; `env` settings apply to sessions; `apiKeyHelper` is documented. | The PR guides `apiKeyHelper` rather than writing it automatically, which is appropriate because auth remains outside plaintext config. |
| Claude Code VS Code docs | `disableLoginPrompt` is documented for third-party provider setups. | The full VS Code key is `claudeCode.disableLoginPrompt`, consistent with VS Code configuration namespace conventions. |
| Claude Code gateway requirements | Claude Code supports Anthropic Messages, Bedrock InvokeModel, and Vertex rawPredict gateway formats. | Direct OpenAI Chat Completions endpoints are not listed as a supported Claude Code API format. |
| LiteLLM gateway pattern | LiteLLM can expose an Anthropic-format endpoint that fronts multiple providers. | Users must configure the gateway to present an Anthropic-compatible API surface to Claude Code. |

## Backend / Frontend Mapping

| Layer | PR behavior | Best-practice status | Follow-up |
|---|---|---|---|
| Backend / adapter | Writes shared Claude Code user settings and avoids plaintext credentials. | Mostly aligned. | Improve rollback/new-file semantics and production apply-path coverage. |
| Backend / orchestration | Uses plan steps and generic applier flow. | Partially aligned. | Ensure verification steps are either executable no-ops, handled explicitly, or performed outside the write transaction. |
| Backend / validation | Validates endpoint URL before generating settings. | Aligned. | Maintain scheme allowlist and reject unsupported schemes. |
| Backend / logging | Redacts config-file content in change log. | Aligned. | Continue avoiding raw endpoint/token output in logs and diagnostics. |
| Frontend / UX | Uses existing setup wizard and guided instructions. | Partially aligned. | Consider future Claude-specific UX: provider type, gateway compatibility warning, auth method choice, test connection, and status diagnostics. |

## Recommended Remaining Work Before Merge

| Priority | Task | Reason | Suggested validation |
|---:|---|---|---|
| P0 | Fix production apply behavior for `verify-endpoint` steps. | Prevent a Claude plan from failing after earlier config writes. | Unit/integration test that applies a Claude Code plan through production `PlanApplier` or switchboard path. |
| P0 | Fix rollback semantics for newly-created Claude Code settings files. | ADR-003 requires recoverable backup/rollback behavior; created files should not be left behind after rollback. | Unit test for create-file then rollback/delete behavior. |
| P1 | Normalize backup responsibility. | Avoid duplicate backups or non-fatal backup failures before modification. | Existing-file apply test should show exactly one recoverable backup path or documented behavior. |
| P1 | Clarify documentation around Anthropic-compatible gateways. | Avoid user assumption that raw OpenAI Chat Completions endpoints work directly with Claude Code. | README/registry doc test, if present. |
| P1 | Add note for model discovery constraints. | Official docs constrain discovery to Claude Code v2.1.129+, Anthropic Messages format, and models prefixed `claude` or `anthropic`. | Unit/docs test if applicable. |
| P2 | Consider richer Claude Code setup UX. | Industry UX usually includes validation, provider selection, and actionable diagnostics. | Manual Extension Development Host verification. |

## Validation and CI Notes

| Check | Result | Notes |
|---|---|---|
| Local `npm install` | Passed | Reported existing audit advisories after dependency install. |
| Local `npm run compile` | Passed | TypeScript compile and resource copy succeeded. |
| Local `npm run lint` | Passed | ESLint completed successfully. |
| Local `npm test` | Passed | 37 test files and 589 tests passed. |
| Local `npm audit --audit-level=high` | Failed | Existing dependency advisories were reported; dependency files were not changed by this PR. |
| GitHub Actions latest completed branch run | Success for dynamic Copilot run `25755541047` | CI workflow run `25750531108` was `action_required` with zero jobs, not a build/test failure log. |

## Useful References and URLs

### GitHub Issue and PR

| Purpose | URL |
|---|---|
| Issue #38: Feature request and acceptance criteria | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/issues/38 |
| PR #39: Claude Code adapter upgrade | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/pull/39 |
| Base adapter before PR | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/blob/bb4d56482ca701d40f10f3888f9238e67f75acf8/src/adapters/claudeCode/adapter.ts |
| Base registry before PR | https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/blob/bb4d56482ca701d40f10f3888f9238e67f75acf8/src/core/registry/assistants.registry.json |

### Claude Code Official Documentation

| Purpose | URL |
|---|---|
| Claude Code LLM gateway configuration | https://code.claude.com/docs/en/llm-gateway |
| Claude Code VS Code extension docs | https://code.claude.com/docs/en/vs-code |
| Claude Code third-party providers in VS Code | https://code.claude.com/docs/en/vs-code#use-third-party-providers |
| Claude Code settings | https://code.claude.com/docs/en/settings |
| Claude Code environment variables | https://code.claude.com/docs/en/env-vars |
| Claude Code model configuration | https://code.claude.com/docs/en/model-config |
| Claude Code third-party integrations overview | https://code.claude.com/docs/en/third-party-integrations |
| Claude Code network configuration | https://code.claude.com/docs/en/network-config |
| Claude Code permissions / managed settings | https://code.claude.com/docs/en/permissions |
| Claude Code MCP configuration | https://code.claude.com/docs/en/mcp |
| Claude Code documentation index for LLMs | https://code.claude.com/docs/llms.txt |

### Claude Code Public Schemas and Repositories

| Purpose | URL |
|---|---|
| Claude Code settings JSON schema | https://json.schemastore.org/claude-code-settings.json |
| Anthropic Claude Code public repository | https://github.com/anthropics/claude-code |
| Claude Code MDM examples | https://github.com/anthropics/claude-code/tree/main/examples/mdm |
| Claude Code changelog | https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md |

### Gateway and Provider References

| Purpose | URL |
|---|---|
| LiteLLM repository | https://github.com/BerriAI/litellm |
| LiteLLM documentation | https://docs.litellm.ai/ |
| LiteLLM Anthropic unified endpoint | https://docs.litellm.ai/docs/anthropic_unified |
| LiteLLM Anthropic pass-through endpoint | https://docs.litellm.ai/docs/pass_through/anthropic_completion |
| LiteLLM Bedrock pass-through endpoint | https://docs.litellm.ai/docs/pass_through/bedrock |
| LiteLLM PyPI compromise advisory issue | https://github.com/BerriAI/litellm/issues/24518 |
| Anthropic Messages API reference | https://docs.anthropic.com/en/api/messages |
| Anthropic Models API reference | https://docs.anthropic.com/en/api/models |
| Amazon Bedrock InvokeModel API | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html |
| Amazon Bedrock InvokeModelWithResponseStream API | https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html |
| Google Vertex AI rawPredict API | https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.endpoints/rawPredict |
| Google Vertex AI streamRawPredict API | https://cloud.google.com/vertex-ai/docs/reference/rest/v1/projects.locations.endpoints/streamRawPredict |
| OpenAI Chat Completions API reference | https://platform.openai.com/docs/api-reference/chat |
| OpenAI Responses API reference | https://platform.openai.com/docs/api-reference/responses |

### VS Code Extension and Configuration References

| Purpose | URL |
|---|---|
| VS Code Extension API | https://code.visualstudio.com/api |
| VS Code configuration API | https://code.visualstudio.com/api/references/vscode-api#WorkspaceConfiguration |
| VS Code SecretStorage API | https://code.visualstudio.com/api/references/vscode-api#SecretStorage |
| VS Code Webview API security guidance | https://code.visualstudio.com/api/extension-guides/webview |
| VS Code Marketplace Claude Code extension | https://marketplace.visualstudio.com/items?itemName=Anthropic.claude-code |
| Open VSX Claude Code extension | https://open-vsx.org/extension/Anthropic/claude-code |

### Comparable AI Coding Assistant References

| Tool | URL |
|---|---|
| Continue documentation | https://continue.dev/docs |
| Continue repository | https://github.com/continuedev/continue |
| Cline repository | https://github.com/cline/cline |
| Roo Code repository | https://github.com/RooCodeInc/Roo-Code |
| Kilo Code repository | https://github.com/Kilo-Org/kilocode |
| OpenAI Codex repository | https://github.com/openai/codex |
| GitHub Copilot documentation | https://docs.github.com/en/copilot |
| GitHub Copilot network settings | https://docs.github.com/en/copilot/managing-copilot/configure-personal-settings/configuring-network-settings-for-github-copilot |

### Useful Open-Source Libraries for Future Consideration

| Library | URL | Why it may be useful |
|---|---|---|
| `write-file-atomic` | https://github.com/npm/write-file-atomic | Battle-tested atomic file writes. |
| `fs-extra` | https://github.com/jprichardson/node-fs-extra | Higher-level filesystem and JSON utilities. |
| `jsonc-parser` | https://github.com/microsoft/node-jsonc-parser | JSONC parsing and modification while preserving formatting. |
| `jsonfile` | https://github.com/jprichardson/node-jsonfile | Lightweight JSON file read/write helpers. |
| `configstore` | https://github.com/yeoman/configstore | User-level JSON config management pattern reference. |

## Bottom Line

The PR direction is valid: Claude Code gateway routing through `ANTHROPIC_BASE_URL` in `~/.claude/settings.json` is officially documented, and keeping credentials out of plaintext config aligns with repository security rules. The PR should not be considered ready to merge until production apply behavior for verification steps and rollback behavior for newly-created Claude Code settings files are corrected and covered by tests.
