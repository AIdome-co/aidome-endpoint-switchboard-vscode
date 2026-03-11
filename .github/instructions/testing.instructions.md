---
applyTo: 'test/**'
---

# Testing Rules

Rules for all test files in this extension.

## Vitest Patterns

- Use `describe` / `it` / `expect` structure. Group related assertions under a `describe`
  block named after the module or behavior being tested.
- Use `vi.mock` for module mocking, `vi.fn()` for spies, and `vi.spyOn` when you need
  to mock a method on an existing object without fully replacing the module.
- Prefer `expect(...).toBe(...)` for primitive equality and `expect(...).toEqual(...)`
  for deep object equality.
- Use `beforeEach` / `afterEach` to reset mocks and shared state between tests.

## Mocking the vscode Module

The `vscode` module is not available outside a running VS Code instance. All unit tests
must mock it. The standard pattern used across this codebase:

```typescript
vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      show: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(), update: vi.fn() })),
  },
  ExtensionContext: vi.fn(),
  SecretStorage: vi.fn(),
  // add more members as needed by the module under test
}))
```

Add only the vscode API members that the module under test actually uses.

## Unit Test Conventions

- One test file per source module. Name the test file to match the source file.
- Mock all external dependencies: filesystem, vscode API, HTTP calls, other modules.
- Do not share mutable state between tests — reset in `beforeEach`.
- Test the exported API surface of a module, not its private internals.
- Cover the happy path, all known error paths, and meaningful edge cases.

## Pre-Release Validation Tests

The validation test suite acts as the final gate before release. It checks:

- **No `console.log` in source** — scans compiled output and source for console calls.
- **Required files exist** — verifies that `package.json`, `LICENSE`, `CHANGELOG.md`,
  and the compiled output directory are all present.
- **TypeScript compiles without errors** — runs the compiler and checks for zero errors.
- **`.vscodeignore` is correct** — ensures that source, test, and dependency directories
  are excluded from the packaged VSIX.
- **Registry is valid** — confirms that the assistant registry JSON is parseable and
  contains the expected fields.

Do not remove or weaken validation tests. If a validation test fails, fix the root cause.

## How to Run Tests

```bash
npm test                          # Full test suite
npm test -- --watch               # Watch mode (re-runs on file changes)
npm test -- path/to/test.test.ts  # Single test file
npm test -- --reporter=verbose    # Verbose output
```

The `npm run compile` step must succeed before tests run (`pretest` hook).

## Integration Tests

Integration tests exercise the full extension activation in an Extension Development
Host. They require a real VS Code instance and run more slowly. These are not part of
the default `npm test` run — they require `@vscode/test-electron`.

Run integration tests only when making changes to extension activation, command
registration, or features that interact deeply with the VS Code API.
