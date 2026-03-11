# AIdome Endpoint Switchboard — Claude Code Entry Point

> VS Code extension that configures AI coding assistants (Continue, Cline, Roo Code,
> Kilo Code, Codex CLI, CodeGPT, and others) to route through enterprise-approved
> LLM endpoints via the AIdome gateway.

## Start Here

| Resource | Purpose |
|---|---|
| `AGENTS.md` | Build, test, and lint commands — read first |
| `.github/copilot-instructions.md` | Full hub: scope, security, architecture |
| `.github/instructions/typescript-extension.instructions.md` | Rules for `src/` code |
| `.github/instructions/testing.instructions.md` | Rules for `test/` code |
| `.github/references/architecture.md` | Adapter pattern, profiles, orchestration, ADRs |
| `.github/references/security-rules.md` | Security rules with ❌/✅ examples |
| `.github/references/coding-guidelines.md` | Code quality, naming, anti-patterns |
| `.github/skills/adapter-development/SKILL.md` | How to add a new assistant |
| `.github/skills/extension-packaging/SKILL.md` | How to package and release |
| `.github/skills/ci-debugging/SKILL.md` | How to debug CI failures |

## Mandatory Rules (Read Before Writing Any Code)

These apply everywhere, without exception:

1. **SecretStorage for all sensitive data** — API keys, tokens, and credentials are stored
   exclusively in `vscode.SecretStorage`. Never use `globalState`, extension settings, or
   any file on disk for secrets.

2. **Adapter pattern — no direct config writes** — Assistant configurations are written
   exclusively through the adapter layer. Orchestration, command, and UI code must never
   directly read or write assistant-specific config files or formats.

3. **Backup-before-modify** — Before any write to an assistant config file, create a
   timestamped backup. This is an architectural invariant (ADR-003).

4. **No `console.log`** — Use the Logger class exclusively. The ESLint `no-console` rule
   and pre-release validation tests enforce this.

5. **Input validation** — Validate all URLs against a scheme allowlist before use.
   Sanitize profile names. Reject `javascript:`, `data:`, and `file:` URL schemes.

6. **Redact before logging** — All sensitive values (API keys, base URLs, tokens) must be
   run through the redaction utility before appearing in logs or diagnostics.

## Architecture in One Paragraph

The extension detects installed AI assistants, lets the user pick an endpoint profile
(stored with secrets in SecretStorage), then applies dialect-appropriate configuration
through per-assistant adapters. Each adapter implements a common interface, reads the
assistant's native config format (JSON, JSONC, TOML, YAML), backs it up, and writes
the updated endpoint settings. The orchestrator coordinates detection → plan → apply →
verify. A registry JSON file defines which assistants are supported and at what tier.

## What NOT to Do

- Don't add God objects or catch-all utility files — keep concerns narrow and named
- Don't use `any` types unless absolutely unavoidable (and document why)
- Don't break the adapter interface contract when adding new assistants
- Don't commit secrets, log sensitive values, or skip input validation
- Don't modify source code to work around failing tests — fix the root cause
