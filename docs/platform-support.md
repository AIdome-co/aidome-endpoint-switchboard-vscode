# 🌐 Platform & Assistant Support

> **LLM Endpoint Switchboard** by [AIdome](https://aidome.co) — One extension to configure them all.

Configure every AI coding assistant in your organization to route through your enterprise-approved LLM gateway endpoint, from a single pane of glass.

---

## ✅ Supported AI Assistants

The Switchboard ships with built-in adapters for the following AI coding assistants. Each adapter knows how to locate the assistant's configuration and apply your endpoint profile automatically.

| Assistant | Configuration Tier | Configuration Method | VS Code | JetBrains | CLI |
|---|---|---|---|---|---|
| **Cline** | 🟢 Tier A — Fully Automated | VS Code settings | ✅ | ✅ | — |
| **Roo Code** | 🟢 Tier A — Fully Automated | VS Code settings | ✅ | — | — |
| **Continue** | 🟢 Tier A — Fully Automated | `config.json` file edit | ✅ | ✅ | — |
| **Kilo Code** | 🟢 Tier A — Fully Automated | VS Code settings | ✅ | ✅ | ✅ |
| **Codex CLI** | 🟢 Tier A — Fully Automated | `config.yaml` file edit | ✅ | — | ✅ |
| **Claude Code** | 🟡 Tier B — Automated + Guided Auth | `~/.claude/settings.json` edit | ✅ | ✅ | ✅ |
| **GitHub Copilot** | 🟡 Tier B — Automated + Guided Auth | VS Code settings | ✅ | ✅ | ✅ |
| **CodeGPT** | 🟡 Tier B — Automated + Guided Auth | VS Code settings | ✅ | ✅ | — |
| **AnythingLLM** | 🟡 Tier B — Guided Setup | Guided steps | ⚠️ | — | — |
| **Tabnine** | 🔵 Tier C — Guided Setup | Guided steps | ✅ | ✅ | — |
| **Gemini CLI** | 🔵 Tier C — Guided Setup | Guided steps | ✅ | ✅ | ✅ |

### Configuration Tiers Explained

| Tier | What It Means |
|---|---|
| 🟢 **Tier A — Fully Automated** | The Switchboard writes the endpoint URL directly into the assistant's config. No manual steps required. |
| 🟡 **Tier B — Automated + Guided Auth** | Endpoint is written automatically, but authentication (API keys, tokens) must be configured separately for security. The Switchboard provides step-by-step guidance. |
| 🔵 **Tier C — Guided Setup** | The Switchboard detects the assistant and provides clear manual configuration instructions via the Output panel. |

---

## 🖥️ Supported IDE Platforms

### Available Now

| Platform | How to Install | Effort |
|---|---|---|
| **Visual Studio Code** | [VS Code Marketplace](https://marketplace.visualstudio.com/) | ✅ Published |
| **GitHub Codespaces** | Automatically available from VS Code Marketplace | ✅ Published |

### Available on Request

The Switchboard is built on the VS Code extension model. The same `.vsix` package can be published to additional registries or sideloaded into VS Code forks with minimal effort.

| Platform | Distribution | Compatibility |
|---|---|---|
| **Open VSX Registry** | `ovsx publish` — same `.vsix` | 🟢 Direct publish |
| ↳ VSCodium | Consumes from Open VSX | 🟢 Automatic |
| ↳ Eclipse Theia | Consumes from Open VSX | 🟢 Automatic |
| ↳ Gitpod | Consumes from Open VSX | 🟢 Automatic |
| ↳ Coder | Consumes from Open VSX | 🟢 Automatic |
| ↳ Eclipse Che | Consumes from Open VSX | 🟢 Automatic |
| **Cursor** | `.vsix` sideload or Open VSX | 🟢 VS Code fork |
| **Windsurf** | `.vsix` sideload | 🟢 VS Code fork |
| **Positron** (Posit / RStudio) | `.vsix` sideload | 🟢 VS Code fork |
| **Google Antigravity** | `.vsix` sideload or Open VSX | 🟢 VS Code fork |
| **Kiro IDE** (AWS) | `.vsix` sideload | 🟢 VS Code fork |
| **TRAE** (ByteDance) | `.vsix` sideload or Open VSX | 🟢 VS Code fork |
| **VS Code for Web** (`vscode.dev` / `github.dev`) | Requires bundler migration | 🟡 Planned |

### Expansion Available with Custom Development

| Platform | Language | Notes |
|---|---|---|
| **JetBrains IDEs** (IntelliJ, WebStorm, PyCharm, Rider, GoLand, etc.) | Kotlin / Java | Separate plugin required. 7 of 11 assistants have JetBrains support. |
| **Visual Studio** | C# / .NET | Only 1 of 11 assistants supports Visual Studio. |
| **Neovim / Vim** | Lua / VimScript | Only 2 of 11 assistants have Neovim plugins. |

---

## 🔮 Additional Assistants Available on Request

We can build adapters for the following assistants. Each adapter integrates into the existing profile-based switching workflow.

| Assistant | Platforms | Configuration | Estimated Effort |
|---|---|---|---|
| **Sourcegraph Cody** | VS Code, JetBrains | `settings.json` + auth tokens | 🟢 Low |
| **Supermaven** | VS Code, JetBrains, Neovim | VS Code settings | 🟢 Low |
| **Qodo** (formerly CodiumAI) | VS Code, JetBrains | VS Code settings | 🟢 Low |
| **Augment Code** | VS Code, JetBrains | VS Code settings | 🟡 Medium |
| **Windsurf** (plugin, not IDE) | VS Code, JetBrains, Neovim | VS Code settings | 🟡 Medium |
| **Refact.ai** | VS Code, JetBrains | Config file edit | 🟡 Medium |
| **Kiro** (AWS, replacing Amazon Q) | VS Code, Kiro IDE | Config file edit | 🟡 Medium |
| **Aider** | CLI | Environment variables | 🟢 Low |

---

## 📊 Assistant × IDE Coverage Matrix

A visual reference of which assistants are available on which platforms — independent of the Switchboard.

```
                    VS Code  OpenVSX  JetBrains  MSVS  Neovim   CLI   Forks
                   ────────  ──────  ─────────  ────  ──────  ─────  ─────
 Cline               ✅       ✅       ✅       ❌     ❌      ❌     ✅
 Roo Code            ✅       ✅       ❌       ❌     ❌      ❌     ✅
 Continue            ✅       ✅       ✅       ❌     ❌      ❌     ✅
 Kilo Code           ✅       ✅       ✅       ❌     ❌      ✅     ✅
 Codex CLI/IDE       ✅       ❌       ❌       ❌     ❌      ✅     ✅
 Claude Code         ✅       ❌       ✅       ❌     ❌      ✅     ✅
 GitHub Copilot      ✅       ❌       ✅       ✅     ✅      ✅     ❌*
 CodeGPT             ✅       ✅       ✅       ❌     ❌      ❌     ✅
 AnythingLLM         ⚠️       ❌       ❌       ❌     ❌      ❌     ⚠️
 Tabnine             ✅       ❌       ✅       ❌     ✅      ❌     ✅
 Gemini CLI          ✅       ❌       ✅       ❌     ❌      ✅     ✅
                   ────────  ──────  ─────────  ────  ──────  ─────  ─────
 TOTAL              10/11    5/11     7/11     1/11   2/11   5/11   9/11

 * GitHub Copilot is blocked on Cursor and Windsurf forks.
 ⚠️ AnythingLLM is primarily a document RAG platform with a community VS Code wrapper.
```

---

## 🏢 Enterprise Deployment Note

For organizations deploying AIdome with a centralized LLM gateway (e.g., LiteLLM, Portkey, Azure API Management, Kong AI Gateway), the Switchboard solves the **"last mile" configuration problem** — ensuring every developer's AI tools actually point at the approved gateway endpoint.

> **No other product bridges the gap between "enterprise deploys a gateway" and "every developer's tools are configured to use it."**

### How It Works

1. **IT/DevOps** deploys your LLM gateway and creates endpoint profiles
2. **Developers** install the Switchboard extension
3. **One click** switches all their AI assistants to the approved endpoint
4. **Profile switching** enables seamless movement between environments (dev / staging / production)

---

## 📬 Request Support for a Platform or Assistant

If your organization needs support for a platform or assistant not listed above, please [open an issue](https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/issues/new) or contact us at [support@aidome.co](mailto:support@aidome.co).

---

## 📐 Detailed Reference

### VS Code Fork Ecosystem — All Reachable with One `.vsix`

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    TIER 1: Same .vsix — Zero to Low Effort                  │
├──────────────────────┬────────┬──────────────────────────────────────────────┤
│ Platform             │ Effort │ Notes                                        │
├──────────────────────┼────────┼──────────────────────────────────────────────┤
│ ✅ VS Code Mktpl     │ DONE   │ Already published                            │
│ ✅ Open VSX Registry │ LOW    │ Same .vsix, publish via ovsx CLI             │
│   → VSCodium         │ ZERO   │ Consumes from Open VSX                       │
│   → Eclipse Theia    │ ZERO   │ Consumes from Open VSX                       │
│   → Gitpod           │ ZERO   │ Consumes from Open VSX                       │
│   → Coder            │ ZERO   │ Consumes from Open VSX                       │
│   → Eclipse Che      │ ZERO   │ Consumes from Open VSX                       │
│ ✅ Cursor            │ LOW    │ VS Code fork — Open VSX + .vsix sideload     │
│ ✅ Windsurf          │ LOW    │ VS Code fork — .vsix sideload                │
│ ✅ Positron (Posit)  │ LOW    │ VS Code fork — .vsix sideload                │
│ ✅ GitHub Codespaces │ ZERO   │ Uses VS Code Marketplace                     │
│ 🆕 Antigravity (Ggl)│ LOW    │ VS Code fork — Open VSX + .vsix sideload     │
│ 🆕 Kiro IDE (AWS)   │ LOW    │ VS Code fork — VS Code compatible             │
│ 🆕 TRAE (ByteDance) │ LOW    │ VS Code fork — Open VSX + .vsix sideload     │
│ ⚠️ VS Code Web      │ MEDIUM │ Requires esbuild migration (no node_modules) │
├──────────────────────┴────────┴──────────────────────────────────────────────┤
│ TOTAL: 14 platforms reachable with 1 codebase (+ esbuild for web)           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Full Assistant × IDE Coverage Matrix (with Footnotes)

This matrix shows each assistant's native platform availability — independent of the Switchboard.

```
┌───────────────┬────────┬───────┬───────┬──────┬──────┬───────┬──────┬────────┐
│ Assistant     │VS Code │OpenVSX│JetBrns│ MSVS │Neovim│  CLI  │Forks │ Tier   │
│ (Adapter)     │ Mktpl  │      │       │      │      │       │sload │        │
├───────────────┼────────┼───────┼───────┼──────┼──────┼───────┼──────┼────────┤
│ Cline         │  ✅    │  ✅  │  ✅   │  ❌  │  ❌  │  ❌   │  ✅  │ A      │
│ Roo Code      │  ✅    │  ✅  │  ❌   │  ❌  │  ❌  │  ❌   │  ✅  │ A      │
│ Continue      │  ✅    │  ✅  │  ✅   │  ❌  │  ❌  │  ❌   │  ✅  │ A      │
│ Kilo Code     │  ✅    │  ✅  │  ✅   │  ❌  │  ❌  │  ✅   │  ✅  │ A      │
│ Codex CLI/IDE │  ✅ᵃ   │  ❌  │  ❌   │  ❌  │  ❌  │  ✅   │  ✅  │ A      │
│ Claude Code   │  ✅    │  ❌  │  ✅   │  ❌  │  ❌  │  ✅   │  ✅  │ B      │
│ GitHub Copilot│  ✅    │  ❌  │  ✅   │  ✅  │  ✅  │  ✅   │  ❌ᵇ │ B      │
│ CodeGPT       │  ✅    │  ✅  │  ✅   │  ❌  │  ❌  │  ❌   │  ✅  │ B      │
│ AnythingLLM   │  ⚠️ᶜ   │  ❌  │  ❌   │  ❌  │  ❌  │  ❌   │  ⚠️  │ B      │
│ Tabnine       │  ✅    │  ❌  │  ✅   │  ❌  │  ✅  │  ❌   │  ✅  │ C      │
│ Gemini CLI    │  ✅ᵈ   │  ❌  │  ✅ᵈ  │  ❌  │  ❌  │  ✅   │  ✅  │ C      │
├───────────────┼────────┼───────┼───────┼──────┼──────┼───────┼──────┼────────┤
│ TOTALS        │ 10/11  │ 5/11 │ 7/11  │ 1/11 │ 2/11 │ 5/11  │ 9/11 │        │
└───────────────┴────────┴───────┴───────┴──────┴──────┴───────┴──────┴────────┘

 ᵃ Codex VS Code = openai.chatgpt extension (separate from Codex CLI)
 ᵇ GitHub Copilot is actively blocked on Cursor and Windsurf forks
 ᶜ AnythingLLM is primarily a document RAG platform with a community VS Code wrapper
 ᵈ Gemini = "Gemini Code Assist" VS Code / JetBrains plugin (Google Cloud product)
```

### Future Adapter Candidates

Assistants we can add adapters for on customer request, sorted by priority:

```
┌────────────────────┬───────┬───────┬────────┬────────┬────────────────────────┐
│ Assistant          │VsCode │JetBrn │ Users  │Priority│ Why                    │
├────────────────────┼───────┼───────┼────────┼────────┼────────────────────────┤
│ Sourcegraph Cody   │  ✅   │  ✅   │ 350K+  │ HIGH   │ Enterprise, self-host  │
│ Supermaven         │  ✅   │  ✅   │ 500K+  │ HIGH   │ Fast completions       │
│ Qodo (CodiumAI)   │  ✅   │  ✅   │ 870K+  │ MEDIUM │ Testing focus          │
│ Augment Code       │  ✅   │  ✅   │ Entrpr │ MEDIUM │ Enterprise context eng │
│ Windsurf (plugin)  │  ✅   │  ✅   │ 10M+   │ MEDIUM │ OpenAI-backed          │
│ Refact.ai          │  ✅   │  ✅   │  50K+  │ LOW    │ Self-hosted niche      │
│ Kiro (AWS)         │  ✅   │  ❌   │ New    │ WATCH  │ Replacing Amazon Q     │
│ JetBrains AI/Junie │  ❌   │  ✅   │Built-in│ LOW    │ JB-native only         │
└────────────────────┴───────┴───────┴────────┴────────┴────────────────────────┘
```

### Platform Expansion — Reach vs Effort Heatmap

```
                         REACH vs EFFORT HEATMAP
                 ┌───────────────────────────────────────┐
                 │  🟩 = High ROI   🟨 = Medium   🟥 = Low │
     HIGH REACH  ├───────────────────────────────────────┤
                 │                                       │
          14 IDEs│ 🟩🟩🟩 Open VSX publish              │ ← Biggest bang
                 │ 🟩🟩🟩 (one `ovsx publish` command)  │    for zero code
                 │                                       │
           7 IDEs│ 🟨🟨🟨 JetBrains plugin              │ ← Kotlin rewrite
                 │ 🟨🟨🟨 (Kotlin/Gradle, ~4-6 weeks)   │    but 7 assistants
                 │                                       │
           1 IDE │ 🟨🟨 VS Code Web (esbuild)           │ ← 1 hour migration
                 │                                       │
     LOW REACH   │                                       │
                 │ 🟥 Visual Studio (C#, 1 assistant)    │
           1 IDE │ 🟥 Neovim (Lua, 2 assistants)         │
                 │ 🟥 Xcode (Swift, 1 assistant)          │
                 └───────────────────────────────────────┘
                  LOW EFFORT ──────────────────▶ HIGH EFFORT
```

### Recommended Expansion Roadmap

| Priority | Action | Effort | Platforms Unlocked |
|---|---|---|---|
| **P0** | Publish to Open VSX | ~1 hour | +7 (VSCodium, Theia, Gitpod, Coder, Che, Antigravity, TRAE) |
| **P1** | esbuild migration | ~1 hour | +1 (VS Code Web / github.dev / vscode.dev) |
| **P2** | Document sideload for forks | ~2 hours | +4 (Cursor, Windsurf, Positron, Kiro) |
| **P3** | JetBrains plugin (Kotlin) | ~4-6 weeks | +7 JetBrains IDEs × 7 assistants |
| Skip | Visual Studio, Neovim, Xcode | Months each | 1 assistant each — minimal ROI |

---

<p align="center">
  <sub>Last updated: May 2026 · AIdome Endpoint Switchboard v1.4.x</sub>
</p>
