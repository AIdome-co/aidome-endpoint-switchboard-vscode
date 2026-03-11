---
applyTo: 'src/**'
---

# TypeScript Extension Rules

Rules for all TypeScript source files in this extension.

## Adapter Pattern

- Every AI assistant integration is implemented as an adapter that satisfies the common
  adapter interface. Do not add assistant-specific logic anywhere else.
- The adapter interface defines the contract: detect, configure, verify, and reset.
  Implement all methods — do not leave stubs that throw unhandled errors.
- Call the orchestrator to coordinate detection → plan → apply → verify.
  Never call adapters directly from command or UI code.
- When adding support for a new assistant, create a new adapter directory and register
  the assistant in the registry JSON. Do not modify the orchestrator for each new case.

## Profile Management

- Endpoint profiles have two storage tiers: non-sensitive metadata goes in `globalState`,
  secrets (API keys, tokens) go in `vscode.SecretStorage`.
- Always validate a profile before storing or applying it. Use the profile validator.
- When reading profiles, handle the case where SecretStorage returns `undefined`
  (first launch, cleared storage, or migrated state) gracefully.
- Do not hardcode endpoint URLs or auth schemes. All of these come from the active profile.

## Logging

- Use the Logger class for all output. Never use `console.log`, `console.warn`,
  `console.error`, or any other `console.*` method in source code.
- Before logging any value that could contain user data, API keys, or URLs, run it
  through the redaction utility.
- Log at the appropriate level: debug for internal state, info for user-visible progress,
  warn for recoverable problems, error for failures that need user attention.

## Error Handling

- Surface user-facing errors via `vscode.window.showErrorMessage` with a clear,
  actionable message. Do not show raw error stack traces to users.
- Log the full error details (message, stack) via the Logger at `error` level.
- Use typed error classes for domain errors so callers can handle specific cases.
- Do not swallow errors silently. Always log or surface them.

## Input Validation

- Validate all user-supplied URLs before using them: check that the scheme is in the
  allowlist (`https:`, `http:` in dev). Reject `javascript:`, `data:`, and `file:`.
- Sanitize profile names: strip control characters, enforce length limits, reject names
  that would cause filesystem or storage key collisions.
- Treat all values read from extension settings or user input as untrusted.

## Testing Requirements

- Every adapter must have a corresponding unit test file.
- Mock the `vscode` module in all unit tests — do not require a running VS Code instance.
- Use `vi.mock` for the vscode module and for filesystem operations.
- Test the happy path, error paths, and edge cases (missing config, empty values, invalid
  URLs, storage read failures).

## Code Style

- Use TypeScript strict mode — `"strict": true` in tsconfig. Do not suppress strict checks.
- Avoid `any` types. Use `unknown` with type guards, or define proper interfaces.
  If `any` is truly unavoidable, add a comment explaining why.
- Add JSDoc comments to all exported functions and classes. Describe params and return
  values for non-obvious signatures.
- Prefer `const` over `let`; avoid `var` entirely.
- Use `async`/`await` over raw Promise chains for readability.
