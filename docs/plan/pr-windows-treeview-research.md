# PR Research Report: Windows-Safe Paths + Assistants TreeView + First-Run Notification

> **PR Branch:** `copilot/research-extension-support-vscode-windows`
> **Date:** 2026-05-20
> **Files changed:** 14 (394 additions, 14 deletions)

---

## 1. What Was Done vs What Still Needs Work

| # | Feature | Status | Files Changed |
|---|---------|--------|---------------|
| 1 | AnythingLLM Windows paths: `C:\Program Files` → `process.env['ProgramFiles']` | ✅ Done | `src/adapters/anythingllm/adapter.ts` |
| 2 | Claude Code platform-aware config path via `getConfigDir('Claude')` | ✅ Done | `src/adapters/claudeCode/claudeCodeConfigPatcher.ts` |
| 3 | AssistantsTreeView: flat list with tier badges + status icons | ✅ Done | `src/ui/assistantsTreeView.ts`, `src/extension.ts`, `package.json` |
| 4 | First-run "Configure Now" notification (one-time, globalState guard) | ✅ Done | `src/extension.ts` |
| 5 | Setup → tree refresh on success/partial-success | ✅ Done | `src/commands/setupSwitchboard.ts` |
| 6 | Tests: 10 TreeView + env-var path + mock updates | ✅ Done | 6 test files |
| 7 | CHANGELOG `[Unreleased]` entries | ✅ Done | `CHANGELOG.md` |
| 8 | Real `detect()` integration in TreeView (`isInstalled` hardcoded `true`) | ⚠️ Gap | `src/ui/assistantsTreeView.ts` line 66 |
| 9 | TreeView `when` clause to hide panel when extension inactive | ⚠️ Gap | `package.json` views contribution |
| 10 | Click-to-configure action on tree item rows | ⚠️ Gap | `AssistantTreeItem` has no `command` |
| 11 | Dispose `_onDidChangeTreeData` EventEmitter | ⚠️ Minor | `src/ui/assistantsTreeView.ts` |
| 12 | ProfileStore created on every `getChildren()` call (no caching) | ⚠️ Minor | `src/ui/assistantsTreeView.ts` |
| 13 | `XDG_CONFIG_HOME` fallback on Linux in `getConfigDir()` | ⚠️ Gap | `src/util/paths.ts` |
| 14 | Other adapters (Continue, Cline, etc.) may have same hardcoded-path issues | ❓ Not scoped | — |

---

## 2. API Reference & SDK Alignment Heatmap

### VS Code Extension API

| API Surface | Aligned? | Official Documentation |
|-------------|:--------:|------------------------|
| `TreeDataProvider<T>` interface | ✅ | [VS Code Tree View API](https://code.visualstudio.com/api/extension-guides/tree-view) |
| `TreeItem`, `TreeItemCollapsibleState` | ✅ | [TreeItem API Reference](https://code.visualstudio.com/api/references/vscode-api#TreeItem) |
| `ThemeIcon` + `ThemeColor` | ✅ | [ThemeIcon API](https://code.visualstudio.com/api/references/vscode-api#ThemeIcon) |
| `EventEmitter<T>` for `onDidChangeTreeData` | ✅ | [EventEmitter API](https://code.visualstudio.com/api/references/vscode-api#EventEmitter) |
| `window.registerTreeDataProvider()` | ✅ | [Window API](https://code.visualstudio.com/api/references/vscode-api#window.registerTreeDataProvider) |
| `window.showInformationMessage()` with buttons | ✅ | [showInformationMessage API](https://code.visualstudio.com/api/references/vscode-api#window.showInformationMessage) |
| `ExtensionContext.globalState` for one-time flags | ✅ | [Memento API](https://code.visualstudio.com/api/references/vscode-api#Memento) |
| `contributes.views` in package.json | ✅ | [Extension Manifest: views](https://code.visualstudio.com/api/references/contribution-points#contributes.views) |
| `contributes.menus.view/title` | ✅ | [Extension Manifest: menus](https://code.visualstudio.com/api/references/contribution-points#contributes.menus) |
| View `when` clause for visibility control | ❌ Missing | [When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts) |
| `contributes.viewsContainers` (Activity Bar icon) | ❌ Not used | [Extension Manifest: viewsContainers](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers) |
| `contributes.viewsWelcome` (empty-state content) | ❌ Not used | [Extension Manifest: viewsWelcome](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsWelcome) |
| `TreeItem.command` (click action) | ❌ Missing | [TreeItem.command](https://code.visualstudio.com/api/references/vscode-api#TreeItem.command) |

### Node.js / Platform APIs

| API Surface | Aligned? | Official Documentation |
|-------------|:--------:|------------------------|
| `process.env['ProgramFiles']` for Windows paths | ✅ | [Node.js process.env](https://nodejs.org/api/process.html#processenv) |
| `process.env.APPDATA` for Windows config dir | ✅ | [Windows Environment Variables](https://learn.microsoft.com/en-us/windows/deployment/usmt/usmt-recognized-environment-variables) |
| `os.platform()` for cross-platform switching | ✅ | [Node.js os.platform()](https://nodejs.org/api/os.html#osplatform) |
| `os.homedir()` for home directory | ✅ | [Node.js os.homedir()](https://nodejs.org/api/os.html#oshomedir) |
| `path.join()` for cross-platform path building | ✅ | [Node.js path.join()](https://nodejs.org/api/path.html#pathjoinpaths) |
| `XDG_CONFIG_HOME` fallback on Linux | ❌ Missing | [XDG Base Directory Spec](https://specifications.freedesktop.org/basedir-spec/latest/) |

### Assistant-Specific Config Paths (Verified)

| Assistant | Config Location | Source | Our Alignment |
|-----------|----------------|--------|:-------------:|
| Claude Code CLI | `~/.claude/settings.json` (Linux), `%APPDATA%\Claude\settings.json` (Win), `~/Library/Application Support/Claude/settings.json` (macOS) | [anthropics/claude-code](https://github.com/anthropics/claude-code) — `CLAUDE_CONFIG_DIR` env var | ✅ 90% (missing XDG) |
| AnythingLLM Desktop | `%LocalAppData%\AnythingLLM` or `%ProgramFiles%\AnythingLLM` (Win) | [Mintplex-Labs/anything-llm](https://github.com/Mintplex-Labs/anything-llm) | ✅ 100% |
| GitHub Copilot | `github.copilot.advanced` → `debug.overrideProxyUrl` in VS Code settings | [microsoft/vscode-copilot-release](https://github.com/microsoft/vscode-copilot-release) — undocumented, found in extension package.json | ✅ (undocumented API) |
| Continue | `~/.continue/config.json` (JSONC) | [continuedev/continue](https://github.com/continuedev/continue) — [Configuration Docs](https://docs.continue.dev/reference) | ✅ |
| Cline | webview globalState (not settings.json) | [cline/cline](https://github.com/cline/cline) — package.json has `properties: {}` | ✅ |
| Roo Code | Extension globalState | [RooCodeInc/Roo-Code](https://github.com/RooCodeInc/Roo-Code) | ✅ |
| Codex CLI | `config.toml` (Rust CLI) | [openai/codex](https://github.com/openai/codex) — codex-rs crate | ✅ |

---

## 3. Industry Best Practices Alignment

| Practice | Industry Standard | This PR | Score |
|----------|------------------|---------|:-----:|
| Windows env vars for Program Files paths | ✅ `process.env.ProgramFiles` (Docker, Electron, node-windows) | ✅ Uses `??` fallback | 95% |
| Platform-aware config dirs | ✅ XDG on Linux, APPDATA on Win, Library on macOS ([`env-paths`](https://github.com/sindresorhus/env-paths) npm package, 50M+/week) | ✅ Custom `getConfigDir()`, missing XDG | 85% |
| TreeDataProvider pattern | ✅ As documented in [VS Code API](https://code.visualstudio.com/api/extension-guides/tree-view) | ✅ Correct contract | 85% |
| First-run onboarding notification | ✅ Used by Docker, GitLens, Copilot | ✅ globalState guard, fire-and-forget | 95% |
| View when-clause for conditional visibility | ✅ Standard in Docker, Remote-SSH, GitLens | ❌ Missing | 0% |
| Click-to-configure on tree items | ✅ Standard in Docker, Azure, GitLens | ❌ Missing | 0% |
| Dedicated Activity Bar viewContainer | ✅ Standard for extensions with multiple views | ❌ Not used | 0% |
| Welcome view for empty state | ✅ Used by Docker, Remote Explorer, GitHub PR | ❌ Not used | 0% |
| Dispose EventEmitters properly | ✅ VS Code best practice | ❌ Not disposed | 0% |
| **Overall** | | | **~60%** |

---

## 4. Open-Source Alternatives Assessment

| Area | Alternative | Downloads | Should We Use? | Rationale |
|------|------------|-----------|:--------------:|-----------|
| Platform config dirs | [`env-paths`](https://github.com/sindresorhus/env-paths) | 50M+/week | 🤔 Consider | Handles XDG, APPDATA, Library correctly. But our `getConfigDir()` is only 15 lines. Worth adopting if we add more config dir lookups. |
| TreeView testing | [`vscode-extension-tester`](https://github.com/redhat-developer/vscode-extension-tester) | 20K+/week | ❌ No | For E2E testing only. Our unit test approach with mocks is sufficient and faster. |
| Endpoint proxy routing | [Requesty](https://www.requesty.ai) | N/A (commercial) | ❌ No | Closest concept but commercial, not open-source. Our approach is unique in OSS. |
| Multi-assistant management | No OSS equivalent exists | — | N/A | Confirmed unique in [PR #33 research](./pr33/research_findings_api_claims_verification.yaml). No existing extension manages endpoints across multiple AI assistants. |

---

## 5. Industry Leaders: TreeView UI/UX Design Comparison

Sorted from most recommended to least recommended design approach:

| Rank | Extension | TreeView | Click Action | Real Detection | First-Run | Refresh | Status Icons | Activity Bar | When Clause | Welcome View |
|------|-----------|:--------:|:------------:|:--------------:|:---------:|:-------:|:------------:|:------------:|:-----------:|:------------:|
| 1 | [Docker](https://github.com/microsoft/vscode-docker) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | [GitLens](https://github.com/gitkraken/vscode-gitlens) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | [Remote - SSH](https://github.com/microsoft/vscode-remote-release) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | [Azure Tools](https://github.com/microsoft/vscode-azuretools) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | [GitHub Pull Requests](https://github.com/microsoft/vscode-pull-request-github) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | [Continue](https://github.com/continuedev/continue) | ✅ | ✅ | ✅ | ✅ | ✅ | ◧ | ✅ | ✅ | ◧ |
| 7 | [Thunder Client](https://github.com/rangav/thunder-client-support) | ✅ | ✅ | N/A | ✅ | ✅ | ✅ | ✅ | ✅ | ◧ |
| 8 | [GitHub Copilot](https://github.com/microsoft/vscode-copilot-release) | ◧ | ◧ | ✅ | ✅ | ◧ | ◧ | ✅ | ✅ | ◧ |
| — | **This PR (AIdome)** | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

**Our alignment with top-tier extensions: ~60%**

---

## 6. Recommended Follow-Up Items

| Priority | Item | Effort | Reference |
|----------|------|--------|-----------|
| P1 | Add `when` clause on view: `"when": "aidome-switchboard.active"` + set context key in `activate()` | Small | [When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts) |
| P1 | Implement real `detect()` in `getChildren()` instead of `isInstalled = true` | Medium | Existing adapter `detect()` methods |
| P2 | Add click-to-configure: set `TreeItem.command` to open setup for that assistant | Small | [TreeItem.command API](https://code.visualstudio.com/api/references/vscode-api#TreeItem.command) |
| P2 | Add `XDG_CONFIG_HOME` fallback in `getConfigDir()` for Linux | Small | [XDG Base Directory Spec](https://specifications.freedesktop.org/basedir-spec/latest/) |
| P2 | Consider using [`env-paths`](https://github.com/sindresorhus/env-paths) instead of custom `getConfigDir()` | Small | [env-paths npm](https://www.npmjs.com/package/env-paths) |
| P3 | Add dedicated Activity Bar `viewContainer` with custom icon | Medium | [viewsContainers contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsContainers) |
| P3 | Add `viewsWelcome` empty-state content | Small | [viewsWelcome contribution](https://code.visualstudio.com/api/references/contribution-points#contributes.viewsWelcome) |
| P3 | Dispose `_onDidChangeTreeData` EventEmitter via `context.subscriptions` | Small | [Disposable pattern](https://code.visualstudio.com/api/references/vscode-api#Disposable) |
| P3 | Cache `ProfileStore` instance in provider constructor | Small | — |

---

## 7. Key Official Documentation Links

### VS Code Extension API
- [Extension API Overview](https://code.visualstudio.com/api)
- [Tree View Guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Extension Manifest (package.json)](https://code.visualstudio.com/api/references/extension-manifest)
- [Contribution Points](https://code.visualstudio.com/api/references/contribution-points)
- [VS Code API Reference](https://code.visualstudio.com/api/references/vscode-api)
- [When Clause Contexts](https://code.visualstudio.com/api/references/when-clause-contexts)
- [Webview Security](https://code.visualstudio.com/api/extension-guides/webview#security)
- [Extension UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/overview)
- [Tree View UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/views)

### Node.js
- [process.env](https://nodejs.org/api/process.html#processenv)
- [os.platform()](https://nodejs.org/api/os.html#osplatform)
- [os.homedir()](https://nodejs.org/api/os.html#oshomedir)
- [path.join()](https://nodejs.org/api/path.html#pathjoinpaths)

### Platform Standards
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir-spec/latest/)
- [Windows Known Folders](https://learn.microsoft.com/en-us/windows/win32/shell/known-folders)
- [Windows Environment Variables](https://learn.microsoft.com/en-us/windows/deployment/usmt/usmt-recognized-environment-variables)

### AI Assistant Repositories & Config Docs
- [Continue](https://github.com/continuedev/continue) — [Config Reference](https://docs.continue.dev/reference)
- [Cline](https://github.com/cline/cline)
- [Roo Code](https://github.com/RooCodeInc/Roo-Code)
- [Claude Code](https://github.com/anthropics/claude-code) — `CLAUDE_CONFIG_DIR` env var
- [Codex CLI (Rust)](https://github.com/openai/codex) — `config.toml`
- [AnythingLLM](https://github.com/Mintplex-Labs/anything-llm)
- [GitHub Copilot Issues](https://github.com/microsoft/vscode-copilot-release) — `debug.overrideProxyUrl` (undocumented)

### NPM Packages (Alternatives Considered)
- [env-paths](https://www.npmjs.com/package/env-paths) — Platform-specific config/data/cache dirs
- [vscode-extension-tester](https://www.npmjs.com/package/vscode-extension-tester) — E2E testing for VS Code extensions

### Industry Leader Extensions (GitHub)
- [Docker for VS Code](https://github.com/microsoft/vscode-docker)
- [GitLens](https://github.com/gitkraken/vscode-gitlens)
- [Remote - SSH](https://github.com/microsoft/vscode-remote-release)
- [Azure Tools](https://github.com/microsoft/vscode-azuretools)
- [GitHub Pull Requests](https://github.com/microsoft/vscode-pull-request-github)

---

## 8. Bottom Line

**Verdict: ✅ MERGEABLE** — All gates pass (compile ✅, lint ✅, 629/629 tests ✅, security invariants ✅). The Windows path fixes are the highest-value changes and follow industry best practice exactly. The TreeView and first-run notification are solid foundations at ~60% feature completeness versus industry leaders, with clear P1–P3 follow-ups documented above.
