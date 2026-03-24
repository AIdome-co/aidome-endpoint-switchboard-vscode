---
name: vscode-ext-localization
description: >
  Use when localizing the AIdome Endpoint Switchboard VS Code extension.
  Covers package.json NLS, source code l10n, walkthrough content translation,
  and best practices for managing locale bundles.
---

# Skill: VS Code Extension Localization

## When to Use

Invoke this skill when you need to:
- Localize command titles, settings, or menu items in `package.json`
- Localize user-facing strings in TypeScript source code
- Translate walkthrough or markdown content
- Add support for a new language/locale
- Update existing translations after a feature change

## Project Context

The AIdome Endpoint Switchboard extension has user-facing strings in:
- **`package.json`** — command titles, setting descriptions, walkthrough metadata
- **Source code** — error messages, notifications, status bar text, wizard prompts
- **Walkthrough files** — step-by-step guidance markdown in `resources/`

All user-visible strings should be localizable to support enterprise deployments
in multilingual environments.

## VS Code Localization Overview

VS Code extensions use three localization mechanisms:

| What to Localize | Mechanism | File Pattern |
|---|---|---|
| `package.json` contributions | NLS (package.nls) | `package.nls.{locale}.json` |
| Source code strings | `@vscode/l10n` API | `l10n/bundle.l10n.{locale}.json` |
| Walkthrough markdown | Locale-suffixed files | `resources/walkthrough/step.{locale}.md` |

## Step 1 — Localize `package.json` Contributions

### Extract Strings

Replace hardcoded strings in `package.json` with `%key%` placeholders:

```json
{
  "contributes": {
    "commands": [
      {
        "command": "aidome-switchboard.setup",
        "title": "%commands.setup.title%",
        "category": "%extension.category%"
      }
    ],
    "configuration": {
      "title": "%configuration.title%",
      "properties": {
        "aidome-switchboard.logLevel": {
          "description": "%configuration.logLevel.description%"
        }
      }
    }
  }
}
```

### Create NLS Files

**`package.nls.json`** (default / English):
```json
{
  "commands.setup.title": "Setup Endpoint Routing",
  "extension.category": "AIdome Switchboard",
  "configuration.title": "AIdome Endpoint Switchboard",
  "configuration.logLevel.description": "Set the logging level for the extension"
}
```

**`package.nls.ja.json`** (Japanese example):
```json
{
  "commands.setup.title": "エンドポイントルーティングのセットアップ",
  "extension.category": "AIdome Switchboard",
  "configuration.title": "AIdome Endpoint Switchboard",
  "configuration.logLevel.description": "拡張機能のログレベルを設定"
}
```

### Naming Convention

- File: `package.nls.{locale}.json` where locale uses lowercase BCP 47 codes as
  per VS Code convention (e.g., `ja`, `pt-br`, `zh-cn`, `de`, `fr`, `es`)
- Keys: dot-separated, matching the contribution path (`commands.setup.title`)

## Step 2 — Localize Source Code Strings

### Install `@vscode/l10n`

The `@vscode/l10n` package provides the `l10n.t()` function for runtime string
localization:

```typescript
import * as vscode from 'vscode';

// Use vscode.l10n.t() for localizable strings
vscode.window.showInformationMessage(
  vscode.l10n.t('Endpoint routing configured for {0}', assistantName)
);
```

### Create Locale Bundles

**`l10n/bundle.l10n.json`** (default / English — for reference):
```json
{
  "Endpoint routing configured for {0}": "Endpoint routing configured for {0}",
  "Profile validation failed": "Profile validation failed"
}
```

**`l10n/bundle.l10n.ja.json`** (Japanese):
```json
{
  "Endpoint routing configured for {0}": "{0} のエンドポイントルーティングが構成されました",
  "Profile validation failed": "プロファイル検証に失敗しました"
}
```

### Best Practices for Source Strings

- Use full English sentences as keys (not abbreviations)
- Use `{0}`, `{1}`, etc. for interpolation — never concatenate strings
- Keep messages user-friendly — no technical jargon in user-visible strings
- Log messages (via Logger) do not need localization — they are developer-facing

```typescript
// ❌ WRONG — concatenated string, not localizable
vscode.window.showErrorMessage('Failed to configure ' + name);

// ✅ CORRECT — parameterized, localizable
vscode.window.showErrorMessage(
  vscode.l10n.t('Failed to configure {0}', name)
);
```

## Step 3 — Localize Walkthrough Content

For walkthrough markdown files in `resources/`:

```
resources/
  walkthrough/
    setup.md          ← Default (English)
    setup.ja.md       ← Japanese
    setup.pt-br.md    ← Brazilian Portuguese
```

VS Code automatically selects the locale-suffixed file based on the user's
language setting.

## Step 4 — Add a New Language

When adding support for a new locale:

1. Create `package.nls.{locale}.json` with all keys from `package.nls.json`
2. Create `l10n/bundle.l10n.{locale}.json` with all source code strings
3. Create locale-suffixed walkthrough files (if walkthrough exists)
4. Test by setting `"locale": "{locale}"` in VS Code's `argv.json`

### Testing Localization

```bash
# Launch VS Code with a specific locale
code --locale=ja

# Or set in argv.json (Help → Toggle Developer Tools → Console)
# Then restart VS Code
```

Verify:
- Command titles in the palette show translated text
- Setting descriptions show translated text
- Error messages and notifications show translated text
- Walkthrough steps show translated content

## Extension-Specific Considerations

### Strings That Should NOT Be Localized

- Logger messages (developer-facing diagnostic output)
- Assistant names (Continue, Cline, Roo Code — proper nouns)
- Config file field names (technical identifiers)
- Command IDs (`aidome-switchboard.setup`)
- API error codes and technical identifiers

### Strings That MUST Be Localized

- Command titles and categories in the palette
- Setting labels and descriptions
- User-facing error messages (`showErrorMessage`, `showWarningMessage`)
- Wizard step prompts and descriptions
- Status bar text
- Walkthrough titles and step content

## Checklist

- [ ] All `package.json` contribution strings use `%key%` placeholders
- [ ] `package.nls.json` contains all default (English) strings
- [ ] Locale-specific `package.nls.{locale}.json` files created
- [ ] Source code strings use `vscode.l10n.t()` with parameterized placeholders
- [ ] `l10n/bundle.l10n.{locale}.json` files created for source strings
- [ ] Walkthrough files have locale-suffixed variants
- [ ] Assistant names and technical identifiers are NOT localized
- [ ] Tested with target locale via `code --locale={locale}`
