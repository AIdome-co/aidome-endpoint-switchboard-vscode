# AIdome Endpoint Switchboard (VS Code Extension) — Agent Guide

This file is the first stop for coding agents working in this repository.
Read it fully before making any changes.

## Quick Start

```bash
npm install          # Install all dependencies
npm run compile      # TypeScript compile + copy resources
npm run lint         # ESLint — must pass before commit
npm test             # Run Vitest unit tests
npm run package      # Package as .vsix (requires vsce)
```

To launch the Extension Development Host for manual testing, press **F5** in VS Code
(or run "Start Debugging" from the Run panel). This opens a new VS Code window with
the extension loaded.

## Tests

```bash
npm test                          # All tests (Vitest)
npm test -- --watch               # Watch mode for TDD
npm test -- path/to/test.test.ts  # Run a single test file
```

Tests are organized into three categories: unit tests for adapters, core logic, and
utilities; integration tests that run in the Extension Development Host; and pre-release
validation tests that gate releases (no console.log, VSIX content, required files).

All tests must pass before opening a PR. Validation tests are the final gate before release.

## Lint / Repo Checks

```bash
npm run lint         # ESLint (TypeScript strict — no-console rule enforced)
npm run compile      # TypeScript strict mode — zero errors required
```

There is **no `console.log`** allowed anywhere in source code. Use the Logger class.
The pre-release validation tests will fail if any `console.log` slips through.

## Changelog Convention

This project uses the **Keep a Changelog** `[Unreleased]` pattern:

- **When writing code / opening a PR**: add a concise bullet under `## [Unreleased]` in
  `CHANGELOG.md` describing what changed (feature, fix, or breaking change).
- **When triggering a release**: run the **Prepare Release** workflow
  (`prepare-release.yml`). It automatically promotes `## [Unreleased]` →
  `## [x.y.z] - YYYY-MM-DD`, bumps `package.json`, commits, tags, and kicks off the
  release. No manual version-rename is required.
- **Never** add a pre-versioned heading like `## [1.2.3]` in a PR —
  only `[Unreleased]` belongs there.

## Where To Find Deeper Guidance

- **Architecture, patterns, ADRs** → `.github/references/architecture.md`
- **Security rules with code examples** → `.github/references/security-rules.md`
- **Code quality conventions** → `.github/references/coding-guidelines.md`
- **TypeScript source rules** → `.github/instructions/typescript-extension.instructions.md`
- **Test writing conventions** → `.github/instructions/testing.instructions.md`
- **Adding a new assistant adapter** → `.github/skills/adapter-development/SKILL.md`
- **Packaging and releasing** → `.github/skills/extension-packaging/SKILL.md`
- **Debugging CI failures** → `.github/skills/ci-debugging/SKILL.md`
- **Full Copilot hub** → `.github/copilot-instructions.md`

## Safety & Security Requirements

These are non-negotiable. Violating them will cause CI to fail or introduce security issues:

1. **SecretStorage only** — API keys and credentials go in `vscode.SecretStorage`. Never
   store secrets in `globalState`, settings, or plain files.
2. **No `console.log`** — Use the Logger class for all output. `console.log` is caught by
   the no-console ESLint rule and by the pre-release validation test.
3. **Redact in logs** — Always run sensitive strings through the redaction utility before
   logging. Endpoint URLs, tokens, and API keys must never appear in plaintext in logs.
4. **Backup-before-modify** — Before writing to any assistant config file, create a timestamped
   backup. Never overwrite without a recoverable backup in place.
5. **Validate all input** — URLs must pass scheme allowlist checks (no `javascript:`, `data:`,
   `file:` schemes). Profile names must be sanitized.
6. **Adapter interface only** — Never write assistant-specific config directly in orchestration,
   command, or UI code. All assistant config changes go through the adapter layer.
