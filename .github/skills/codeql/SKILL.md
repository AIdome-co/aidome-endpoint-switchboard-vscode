---
name: codeql
description: >
  Use when setting up or maintaining CodeQL code scanning for the AIdome
  Endpoint Switchboard extension. Covers GitHub Actions workflow configuration,
  JavaScript/TypeScript analysis, alert triage, and custom query packs.
---

# Skill: CodeQL Code Scanning

## When to Use

Invoke this skill when you need to:
- Create or update the CodeQL GitHub Actions workflow for this extension
- Configure CodeQL analysis for JavaScript/TypeScript source code
- Triage or investigate CodeQL alerts in the Security tab
- Set up custom query packs or CodeQL configuration files
- Troubleshoot CodeQL analysis failures in CI

## Project Context

The AIdome Endpoint Switchboard is a TypeScript VS Code extension. CodeQL analysis
should target `javascript-typescript` and focus on security queries relevant to:
- Secret handling (API keys stored in SecretStorage)
- Input validation (URL scheme allowlist enforcement)
- File operations (config file reads/writes in adapters)
- Extension API usage (vscode namespace)

## Step 1 — Configure the CodeQL Workflow

Create or update `.github/workflows/codeql.yml`:

```yaml
name: "CodeQL"

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  schedule:
    - cron: '30 6 * * 1'   # Weekly Monday 6:30 UTC

permissions:
  security-events: write
  contents: read
  actions: read

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - language: javascript-typescript
            build-mode: none

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v4
        with:
          languages: ${{ matrix.language }}
          build-mode: ${{ matrix.build-mode }}
          queries: security-extended

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v4
        with:
          category: "/language:${{ matrix.language }}"
```

### Key Configuration Notes

- **Language**: Use `javascript-typescript` — this covers both JS and TS files
- **Build mode**: Use `none` — TypeScript extraction does not require compilation
- **Query suite**: Use `security-extended` for broader security coverage
- **Schedule**: Weekly scans catch new vulnerability patterns in existing code

## Step 2 — Configure Path Exclusions

Create `.github/codeql/codeql-config.yml` to exclude test fixtures and dependencies:

```yaml
paths:
  - src/
paths-ignore:
  - node_modules/
  - test/fixtures/
  - '**/*.test.ts'
  - dist/
```

Reference it in the workflow:

```yaml
- uses: github/codeql-action/init@v4
  with:
    config-file: .github/codeql/codeql-config.yml
```

## Step 3 — Triage Alerts

When CodeQL reports alerts, investigate with these priorities:

| Alert Category | Priority | Action |
|---|---|---|
| Hardcoded credentials | Critical | Verify SecretStorage is used — fix immediately |
| URL injection / open redirect | High | Verify scheme allowlist validation — fix immediately |
| Path traversal | High | Verify safe file ops are used — fix immediately |
| Insecure randomness | Medium | Check if used for security-sensitive operations |
| Unused imports / dead code | Low | Clean up in a separate PR |

### Extension-Specific False Positives

These patterns may trigger CodeQL alerts but are safe in this extension:

- **`vscode.workspace.getConfiguration`** reads — VS Code settings are trusted
  input in this context (but user-supplied URLs within settings are not)
- **Dynamic `require`** in test mocks — `vi.mock('vscode')` patterns are test-only
- **Template literal URLs** — safe when the base URL has passed scheme validation

## Step 4 — Run CodeQL Locally (Optional)

```bash
# Install CodeQL CLI (download bundle from GitHub releases)
# Create database
codeql database create codeql-db \
  --language=javascript-typescript \
  --source-root=src

# Analyze
codeql database analyze codeql-db \
  javascript-security-extended.qls \
  --format=sarif-latest \
  --output=results.sarif
```

## Troubleshooting

| Problem | Solution |
|---|---|
| No results for TypeScript files | Ensure language is `javascript-typescript`, not just `javascript` |
| Too many alerts from test files | Add `test/` to `paths-ignore` in CodeQL config |
| Workflow not triggering | Verify `on:` triggers include the correct branches |
| Analysis timeout | Reduce scope with `paths` config; use `none` build mode |

## Checklist

- [ ] CodeQL workflow targets `javascript-typescript`
- [ ] Build mode set to `none` (no compilation needed)
- [ ] Query suite set to `security-extended`
- [ ] Path exclusions configured for test and dependency directories
- [ ] Alerts triaged with extension-specific context
- [ ] No false positive dismissals without documented reason
