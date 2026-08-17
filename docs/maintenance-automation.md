# Automated maintenance

Switchboard maintenance runs through the local Hermes gateway so the job can
use the persistent workspace at `/home/aidome-dev` and the existing GitHub and
Telegram credentials. The system never merges a pull request automatically.

## Scope

The adapter registry currently contains these 11 providers:

| Provider | Switchboard tier | Reference |
| --- | --- | --- |
| GitHub Copilot | B | `microsoft/vscode-copilot-chat` |
| Cline | A | `cline/cline` |
| Roo Code | A | `RooCodeInc/Roo-Code` (archived) |
| Kilo Code | A | `Kilo-Org/kilocode` |
| Continue.dev | A | `continuedev/continue` |
| Claude Code | A | `anthropics/claude-code` |
| OpenAI Codex | A | `openai/codex` |
| Gemini CLI | C | `google-gemini/gemini-cli` |
| CodeGPT | B | `timkmecl/codegpt` (legacy public source) |
| AnythingLLM | B | `Mintplex-Labs/anything-llm` |
| Tabnine | C | `codota/tabnine-vscode` |

The source-of-truth mapping is
[`maintenance/provider-repositories.json`](../maintenance/provider-repositories.json).
The synchronizer stores runtime commit state in
`/home/aidome-dev/pub-refs/switchboard-provider-manifest.json`, which is not
product code and should not be committed to this repository.

Unattended changes run from the dedicated worktree
`/home/aidome-dev/pub-refs/switchboard-worktree`; the user checkout is never a
cron workspace.

## Schedule

Hermes is configured for `Asia/Jerusalem` and runs one maintenance job at
19:00:

- Daily: inspect Switchboard and open maintenance PRs, then review existing
  maintenance PRs.
- On Sunday, the same run first synchronizes provider references and rebases
  the local `switchboard-maintenance` branches.

The Hermes gateway owns the scheduler and its cross-process locks. The
maintenance prompt also acquires a repository lock before changing files, so a
manual dry-run cannot overlap an unattended run.

Install or reconcile the live schedule idempotently with:

```bash
python3 maintenance/install_hermes_schedule.py
```

The installer creates or refreshes the dedicated worktree, configures
`Asia/Jerusalem`, and fails closed if Hermes' persisted next run is not 19:00
Israel time. If the gateway was already running when its timezone changed,
restart or reload Hermes and rerun the installer; do not accept a UTC schedule
as equivalent because Israel observes daylight-saving changes.

Run the complete read-only orchestration simulation with:

```bash
python3 maintenance/dry_run.py
```

It validates provider discovery, reference handling, PR inventory, report
construction, and Hermes notification wiring. Planned PR creation, comments,
and notifications are explicitly marked `planned`; the simulation performs no
GitHub, Git, or Telegram writes.

## Daily workflow

1. Read `AGENTS.md`, this document, the provider manifest, and the current
   Switchboard state.
2. Run `python3 maintenance/sync_provider_refs.py --json` to fetch references.
3. Search for evidence-backed bugs, regressions, provider API drift, weak error
   handling, missing tests, stale documentation, dependency problems, and
   security issues.
4. Check existing `maintenance/switchboard-*` branches and PRs before creating
   anything new. Reuse a PR when a finding is already being handled.
5. For a scoped finding, reproduce it, make the smallest fix, add a regression
   test, update documentation or `CHANGELOG.md` when required, and run the
   repository's full applicable checks:

   ```text
   npm run lint
   npm run compile
   npm test
   npm run test:e2e
   npm run test:continue:coverage
   npm run test:kilo:coverage
   npm run test:roo:coverage
   npm run package
   ```

   A command that is unavailable in the current environment must be reported;
   it must not be silently treated as passing.
6. Push a focused branch and open a PR. Use a draft PR when confidence is low,
   tests fail, or the change is broad.
7. Review generated and previously open maintenance PRs. Check the diff,
   changed files, CI status, unresolved review threads, tests, coverage,
   error-handling paths, documentation alignment, maintainability, security,
   dependency impact, and provider references.
8. Add or update one PR comment using the marker
   `<!-- switchboard-maintenance-report -->` and include the completion
   percentage, evidence, exact commands, and remaining work.

After every push, repeat a bounded review/fix/test/push loop, up to three
cycles per run. Before every provider-related fix or new provider-related
comment, refresh the matching official repository in `~/pub-refs/`. Address all
unresolved review threads, including Codex comments, and run the deterministic
gate:

```bash
python3 maintenance/review_pr.py --pr <PR Number> --json
```

The loop stops successfully only when the gate reports `eligible100: true`. If
it cannot converge after three cycles, leave the PR below 100%, record the
blocker, and notify Telegram.

## 100% gate and notifications

A PR is 100% only if every required check passes, no unresolved review comment
remains, no security or quality blocker remains, documentation is aligned, and
the report has no remaining work, the report names the current PR head commit,
and the deterministic gate passes. At 100%, send Hermes:

```text
hermes send --to telegram:1205688131 "Switchboard maintenance PR is 100% complete: <PR link> ..."
```

Do not merge. Also notify Hermes when a run fails or is blocked, provider
references cannot be synchronized, credentials or permissions are missing,
tests are repeatedly flaky, or a PR is stale.

If no actionable finding or notification exists, leave the run state recorded
and do not send a Telegram message.

## Safe operating rules

- Do not overwrite dirty worktrees, user branches, or existing unrelated edits.
- Do not make broad refactors, dependency upgrades, or behavior changes without
  a concrete finding.
- Never log tokens, API keys, credentials, or full sensitive endpoint URLs.
- Keep secrets in the existing credential stores and environment configuration.
- Use the adapter layer for assistant configuration behavior.
- Back up assistant configuration files before any write.
- Do not merge PRs automatically.
- If expected behavior or provider ownership is ambiguous, stop and notify the
  owner instead of guessing.
