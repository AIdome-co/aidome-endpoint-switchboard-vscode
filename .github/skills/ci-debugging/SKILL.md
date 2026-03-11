---
name: ci-debugging
description: >
  Use when debugging failing CI workflows, build errors, test failures,
  or VSIX packaging issues in GitHub Actions.
---

# Skill: Debugging CI Failures

## When to Use

Invoke this skill when a CI workflow run is failing and you need to:
- Understand what went wrong from the logs
- Reproduce the failure locally
- Apply a fix and verify it passes

## Step 1 — Read the Failing Workflow Logs

Open the failing workflow run in the GitHub Actions tab. Identify:

1. Which job failed (lint, compile, test, package)?
2. Which step within the job failed?
3. What was the exact error message?

Look for the **red ✗** next to the failed step. Expand it to see the full output.
The error is almost always in the last few lines before the failure marker.

## Step 2 — Reproduce Locally

Run the same sequence of commands locally before making any changes:

```bash
npm ci              # Matches CI — clean install from lock file
npm run lint        # Lint
npm run compile     # TypeScript compile
npm test            # Tests
npm run package     # VSIX packaging
```

If it fails locally with the same error, you can debug interactively.
If it passes locally but fails in CI, look for environment differences (Node version,
missing env vars, file path case sensitivity, OS differences).

## Common Failure Patterns

### TypeScript Compile Errors

**Symptoms**: The "compile" step fails with `error TS...` messages.

**Common causes**:
- Type error in recently added or modified code
- Missing import or incorrect module resolution
- `strict` mode violation (null check, implicit any, etc.)
- A dependency update changed a type signature

**Fix approach**:
```bash
npm run compile 2>&1 | head -50   # See first errors
```
Address each error. Never suppress with `// @ts-ignore` without a documented reason.

### ESLint Failures

**Symptoms**: The "lint" step fails with ESLint rule violations.

**Common causes**:
- `console.log` used in source code (no-console rule)
- `any` type used where a stricter type is expected
- Unused variable or import
- Formatting issues (semicolons, etc.)

**Fix approach**:
```bash
npm run lint               # See all violations
npm run lint -- --fix      # Auto-fix where possible (formatting only)
```

The no-console rule is the most common CI lint failure. Replace all `console.*` calls
with Logger class calls.

### Test Failures

**Symptoms**: The "test" step fails with Vitest assertion errors or runtime errors.

**Common causes**:
- A code change broke existing behavior
- A mock is missing or incomplete for a new vscode API member used
- A test depends on file state that doesn't exist in CI
- Pre-release validation test caught a real issue (console.log, missing file, etc.)

**Fix approach**:
```bash
npm test                                    # Full suite
npm test -- --reporter=verbose              # More detail on failures
npm test -- path/to/failing.test.ts         # Isolate the failing test
```

Read the assertion error carefully. It tells you what was expected vs. what was received.
Do not skip or remove failing tests — fix the root cause.

### VSIX Packaging Failures

**Symptoms**: The "package" step fails with a vsce error.

**Common causes**:
- Missing required `package.json` fields (`displayName`, `publisher`, `description`)
- `README.md` references images that don't exist or aren't relative paths
- `vsce` version mismatch between local and CI

**Fix approach**:
```bash
npx @vscode/vsce package --out test.vsix 2>&1
```

Check the error message. vsce errors are usually explicit about which field is missing
or which file cannot be found.

### npm Dependency Failures

**Symptoms**: The "install" step fails with network errors or version conflicts.

**Common causes**:
- `package-lock.json` is out of sync with `package.json`
- A transitive dependency has a breaking change
- npm registry connectivity issue (rare, usually resolves on retry)

**Fix approach**:
```bash
npm ci               # Uses lock file exactly — reproduces CI
npm audit            # Check for vulnerabilities that may block install
```

If `package-lock.json` is out of sync: run `npm install` locally to regenerate it,
then commit the updated lock file.

## Step 3 — Apply and Verify the Fix

After applying a fix:

```bash
npm run lint && npm run compile && npm test && npm run package
```

All four steps must pass before pushing the fix. The CI workflow runs them in sequence —
a failure in any step blocks the rest.

## Step 4 — Push and Monitor

Push the fix and monitor the new workflow run in GitHub Actions. If the same step fails
again, return to Step 1 with the new logs.

## Escalation

If the failure is in CI infrastructure itself (GitHub Actions runner issue, npm registry
outage, network timeout) rather than in the code:

- Check the GitHub Status page (githubstatus.com) for active incidents
- Re-run the failed jobs from the GitHub Actions UI (re-run button)
- If consistently failing without code changes, check if a recent dependency update
  introduced the regression by comparing against the last passing run
