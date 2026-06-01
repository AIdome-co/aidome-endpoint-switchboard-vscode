# 🗺️ Platform Expansion Roadmap (Internal)

> **Internal planning document** — Not customer-facing.
> Last updated: 2026-06-01

---

## Research Corrections Log

Corrections applied during the June 2026 platform research audit:

| Item | Initial Assessment | Actual | Action Taken |
|---|---|---|---|
| **Cline + JetBrains** | ⚠️ beta | ✅ Native plugin #28247 | Upgraded to ✅ |
| **Kilo Code + JetBrains** | ❌ | ✅ Supports all JB IDEs | Upgraded to ✅ |
| **Kilo Code + CLI** | ❌ | ✅ Has CLI | Upgraded to ✅ |
| **Codex + VS Code** | ❌ | ✅ `openai.chatgpt` extension | Upgraded to ✅ |
| **CodeGPT + JetBrains** | ❌ | ✅ Plugin #28906 | Upgraded to ✅ |
| **Tabnine + MSVS** | ✅ | ❌ Not in current supported list | Downgraded to ❌ |
| **Copilot + Cursor/Windsurf** | Not listed | ❌ Actively blocked by Microsoft | Added ❌ |
| **Roo Code + JetBrains** | ❌ | ❌ Confirmed correct | No change |
| **AnythingLLM** | Listed as adapter | ⚠️ RAG platform, not coding assistant | Flagged with footnote |

**Impact:** JetBrains coverage went from 4/11 → **7/11** assistants. Codex VS Code went ❌ → ✅. Tabnine MSVS went ✅ → ❌.

---

## Reach vs Effort Heatmap

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

---

## Recommended Expansion Roadmap (P0–P3)

| Priority | Action | Effort | Platforms Unlocked | Status |
|---|---|---|---|---|
| **P0** | Publish to Open VSX | 1 hour | +7 (VSCodium, Theia, Gitpod, Coder, Che, Antigravity, TRAE) | 🟡 Ready — `OVSX_PAT` secret added, awaiting first publish |
| **P1** | esbuild migration | 1 hour | +1 (VS Code Web / github.dev / vscode.dev) | ⬚ Not started |
| **P2** | Document sideload for forks | 2 hours | +4 (Cursor, Windsurf, Positron, Kiro) | ⬚ Not started |
| **P3** | JetBrains plugin (Kotlin) | 4–6 weeks | +7 JetBrains IDEs × 7 assistants | ⬚ Not started |
| **Skip** | Visual Studio (C#) | Months | 1 assistant (Copilot only) | ❌ Minimal ROI |
| **Skip** | Neovim (Lua) | Months | 2 assistants (Copilot, Tabnine) | ❌ Minimal ROI |
| **Skip** | Xcode (Swift) | Months | 1 assistant (Copilot only) | ❌ Minimal ROI |

---

## Future Adapter Candidates

Assistants not yet supported by the Switchboard, ranked by strategic value:

| Assistant | VS Code | JetBrains | Est. Users | Priority | Rationale |
|---|---|---|---|---|---|
| **Sourcegraph Cody** | ✅ | ✅ | 350K+ | HIGH | Enterprise-grade, supports self-hosting — aligns with AIdome's enterprise customers |
| **Supermaven** | ✅ | ✅ | 500K+ | HIGH | Fast completions, growing rapidly, cross-IDE |
| **Qodo** (CodiumAI) | ✅ | ✅ | 870K+ | MEDIUM | Testing-focused, large install base, enterprise appeal |
| **Augment Code** | ✅ | ✅ | Enterprise | MEDIUM | Context engine, enterprise-only, strong fit |
| **Windsurf** (plugin) | ✅ | ✅ | 10M+ | MEDIUM | OpenAI-backed, massive user base |
| **Refact.ai** | ✅ | ✅ | 50K+ | LOW | Self-hosted niche, small market |
| **Kiro** (AWS) | ✅ | ❌ | New | WATCH | Replacing Amazon Q Developer, too early to evaluate |
| **JetBrains AI / Junie** | ❌ | ✅ | Built-in | LOW | JetBrains-native only, no VS Code presence |

---

## Decision Notes

### Why "Skip" Tier Exists

| Platform | Language | Assistants Supported | Decision |
|---|---|---|---|
| Visual Studio | C# / .NET | 1 (Copilot) | Only Copilot supports MSVS. Copilot doesn't allow custom endpoints. Zero ROI. |
| Neovim | Lua / VimScript | 2 (Copilot, Tabnine) | Niche audience. Both assistants have their own config mechanisms. Low enterprise demand. |
| Xcode | Swift | 1 (Copilot) | Apple-only. Single assistant. Custom development from scratch. |

### Key Architectural Notes

- **Same `.vsix` for all VS Code forks** — No code changes needed. Only distribution/publishing differs.
- **JetBrains requires full rewrite** — Kotlin/Gradle plugin, different API surface. BUT 7/11 assistants have JetBrains plugins, making it the highest-value new platform investment.
- **esbuild migration** — Needed for VS Code Web only. Eliminates `node_modules` from the bundle. Low effort, unblocks `vscode.dev` and `github.dev`.
- **Copilot fork blocking** — Microsoft actively blocks GitHub Copilot on Cursor and Windsurf. This is outside our control. Noted in customer-facing docs with footnote.

---

## Status Tracker

| Date | Event | Notes |
|---|---|---|
| 2026-06-01 | `OVSX_PAT` secret added to GitHub repo | Ready for first Open VSX publish via release workflow |
| 2026-06-01 | Research audit completed | Corrections applied to `docs/platform-support.md` |
| 2026-06-01 | Internal roadmap created | This document |
