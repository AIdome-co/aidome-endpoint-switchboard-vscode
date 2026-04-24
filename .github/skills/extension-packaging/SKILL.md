---
name: extension-packaging
description: >
  Use when packaging, releasing, or publishing the VS Code extension.
  Covers vsce packaging, VSIX validation, GitHub Releases, and
  Marketplace / Open VSX publishing.
---

# Skill: Extension Packaging & Release

## When to Use

Invoke this skill when you need to:
- Create a `.vsix` package for testing or distribution
- Cut a new release and publish to GitHub
- Prepare for VS Code Marketplace or Open VSX publishing

## Step 1 — Pre-Release Checks

Before packaging, ensure the codebase is clean:

```bash
npm run lint       # Must pass with zero errors/warnings that block
npm run compile    # TypeScript must compile with zero errors
npm test           # All tests must pass, including validation tests
```

The pre-release validation tests check for `console.log` in source, missing required
files, and `.vscodeignore` correctness. Fix any failures before proceeding.

## Step 2 — Bump the Version

The **Prepare Release** workflow (`prepare-release.yml`) handles the version bump
automatically when triggered via `workflow_dispatch`. Choose the semver increment:

- **Patch** (`x.x.N`) — Bug fixes, no new features
- **Minor** (`x.N.x`) — New features, backward compatible
- **Major** (`N.x.x`) — Breaking changes

The workflow calls `npm version <type>` to update `package.json` and
`package-lock.json`, then commits both alongside the CHANGELOG update (Step 3).

## Step 3 — CHANGELOG Convention (`[Unreleased]`)

This project uses the **Keep a Changelog** `[Unreleased]` pattern for fully automated
changelog management:

**During development (every PR that ships user-visible changes):**

Add a bullet under `## [Unreleased]` in `CHANGELOG.md` — do **not** add a
pre-versioned heading:

```markdown
## [Unreleased]

### Added
- New Windsurf adapter with full Tier A endpoint configuration

### Fixed
- Profile validation now rejects `data:` URL schemes
```

**During release (automated by `prepare-release.yml`):**

The workflow finds `## [Unreleased]` and renames it to `## [x.y.z] - YYYY-MM-DD`
using `sed`. The updated `CHANGELOG.md` is committed alongside the `package.json`
version bump in the release commit. No manual rename is ever needed.

**If `[Unreleased]` is empty or absent when the workflow runs**, it will fail with a
clear error asking you to document the changes first.

## Step 4 — Package with vsce

```bash
npm run package
# or explicitly:
npx @vscode/vsce package --out aidome-endpoint-switchboard.vsix
```

This produces a `.vsix` file in the project root.

## Step 5 — Validate VSIX Contents

Inspect the VSIX (it's a zip file) to confirm the package is clean:

```bash
unzip -l *.vsix | grep -E "(src/|test/|node_modules/|\.map$)"
```

This command should produce **no output**. If it does, update `.vscodeignore` to
exclude those paths, then re-package and re-validate.

The VSIX must include the compiled JS output, resources (icons, walkthrough files),
and documentation files (README, CHANGELOG, LICENSE). It must NOT include TypeScript
source, test files, dependency directories, source maps, or development configuration.

## Step 6 — Tag and Push for Release

The release workflow triggers on tags matching `v*`:

```bash
git tag v1.2.3
git push origin v1.2.3
```

This triggers the release workflow, which compiles, tests, packages, and creates a
GitHub Release with the VSIX attached and auto-generated release notes.

Monitor the workflow run in the GitHub Actions tab to confirm it succeeds.

## Step 7 — Future: Marketplace Publishing

When ready to publish to the VS Code Marketplace:

1. Add `VSCE_PAT` as a repository secret (Personal Access Token from Azure DevOps)
2. Uncomment the Marketplace publish step in the release workflow
3. Verify the publisher ID in `package.json` matches the Azure DevOps publisher

For Open VSX (VS Codium / Gitpod):

1. Add `OVSX_PAT` as a repository secret (token from open-vsx.org)
2. Uncomment the Open VSX publish step in the release workflow

Publish to VS Code Marketplace first, then Open VSX.

## Troubleshooting

| Problem | Likely Cause | Fix |
|---|---|---|
| `vsce` packaging error | Missing required field in `package.json` | Check `displayName`, `description`, `publisher`, `repository` |
| VSIX too large | `node_modules/` or `src/` included | Update `.vscodeignore` |
| Tests fail during release | Compilation error or broken test | Run `npm test` locally and fix |
| Release workflow fails | Tag format wrong | Use `v1.2.3` format (semver with `v` prefix) |
