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

Hermes is configured for `Asia/Jerusalem` and runs one maintenance job twice
daily at 12:00 and 19:00:

- Daily: inspect Switchboard and all in-scope open PRs, then review and
  converge existing `maintenance/switchboard-*` and `fix/*` PRs.
- On Sunday, the same run first synchronizes provider references and rebases
  the local `switchboard-maintenance` branches.

The Hermes gateway owns the scheduler. The job runs in Hermes no-agent/script
mode through the reviewed `maintenance/hermes_cron_entrypoint.py` entrypoint,
so it does not spend an LLM session or terminal inactivity budget merely
launching the deterministic controller. The entrypoint is installed under
Hermes' trusted scripts directory with a 1620-second scheduler timeout; the
controller has its own 1500-second budget and checkpoints before that limit. The
controller acquires a repository lock before changing files, so a manual live
run cannot overlap an unattended run. The controller sends deduplicated
actionable Telegram notifications directly and emits no duplicate stdout
delivery.

### Deterministic convergence controller

The live entry point is:

```bash
python3 maintenance/convergence_controller.py \
  --root /home/aidome-dev/pub-refs/switchboard-worktree \
  --pub-refs /home/aidome-dev/pub-refs \
  --repo AIdome-co/aidome-endpoint-switchboard-vscode \
  --auto-weekly
```

The controller performs one bounded Hermes fix cycle at a time in an isolated
worktree for each trusted full-fix PR. After every cycle it independently
checks cleanliness, dependencies, validation commands, the pushed remote head,
the refreshed PR metadata, the canonical report, and `review_pr.py`. It allows
at most three cycles per scheduled run, rotates the PR cursor so a slow PR
cannot starve the queue, and persists per-PR state under
`/home/aidome-dev/pub-refs/`. If the budget is reached, the run is recorded as
`paused-budget` and the next run resumes from the last checkpoint. Dependabot
PRs receive a read-only review and never enter a fix worktree. PRs from
untrusted source repositories are blocked before code execution. Legacy
list-shaped PR state is migrated to the durable keyed format at startup.

All discovery, fix-cycle, and dependency-review agent calls pass the explicit
OpenRouter model `deepseek/deepseek-v4-flash-0731`; they do not inherit Hermes'
global default model. Operators can override it for a controlled run with
`SWITCHBOARD_HERMES_MODEL` or `--hermes-model`. Telegram delivery uses Hermes'
`send` and does not invoke a model.

Before the PR inventory, the first normal scheduled run for each Israel local
date invokes a separate main-based discovery worktree. That cycle scans the
product and provider references for reproduced bugs or drift and deduplicates
against existing PRs and issues. For a new validated finding it creates or
reuses a GitHub Issue containing evidence and acceptance criteria, then creates
one focused `maintenance/switchboard-*` PR linked with `Fixes #<issue-number>`.
The issue URL and provider-reference commit are recorded in the PR description
and maintenance report. Its branch, cleanliness, and pushed remote head are
verified before the new inventory is processed. The second
daily run skips discovery and focuses on convergence. Controlled `--pr` and
`--reconcile-only` runs intentionally skip discovery.

Validation selects a Node.js runtime at version 22 or newer (or the executable
specified by `SWITCHBOARD_NODE_BIN`) and prepends its `bin` directory to the
validation environment. If no supported runtime is available, the PR is
blocked and the owner is notified; Node 18 is never treated as an equivalent
passing environment.

### Pull request scope

Every daily run builds its target list with
`python3 maintenance/pr_scope.py`. It processes every open PR returned by that
command, not only PRs created during the current run:

| Branch pattern | Automation behavior |
| --- | --- |
| `maintenance/switchboard-*` | Full review, fix, test, push, report, and convergence loop; newly discovered work is linked to an Issue |
| `fix/*` | Full review, fix, test, push, report, and convergence loop on the existing branch |
| `dependabot/*` | Read-only review; fixes use a separate maintenance branch |

Draft `fix/*` PRs are reviewed and fixed, but cannot be reported as 100% until
they are marked ready and the deterministic gate passes.

Install or reconcile the live schedule and validation dependencies idempotently
with:

```bash
python3 maintenance/install_hermes_schedule.py
```

The installer creates or refreshes the dedicated worktree, installs its locked
Node dependencies when absent, configures `Asia/Jerusalem`, and fails closed if
Hermes' persisted next run is not 12:00 or 19:00 Israel time. If the gateway
was already running when its timezone changed, restart or reload Hermes and
rerun the installer; do not accept a UTC schedule as equivalent because Israel
observes daylight-saving changes.

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
4. Run `python3 maintenance/pr_scope.py` and process every returned PR. Check
   existing `maintenance/switchboard-*` and `fix/*` branches before creating
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
7. Review generated and previously open in-scope PRs. Check the diff,
   changed files, CI status, unresolved review threads, tests, coverage,
   error-handling paths, documentation alignment, maintainability, security,
   dependency impact, and provider references.
8. Add or update one PR comment using the marker
   `<!-- switchboard-maintenance-report -->` and include the completion
   percentage, evidence, exact commands, and remaining work.

The controller repeats a bounded review/fix/test/push loop, up to three cycles
per run for `maintenance/switchboard-*` and `fix/*` PRs. Before every
provider-related fix or new provider-related comment, refresh the matching
official repository in `~/pub-refs/`. Address all unresolved review threads,
including Codex comments, and run the deterministic gate after every cycle:

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
and the deterministic gate passes. At 100%, the controller sends Hermes
exactly once per PR head, including the PR link and commit. Do not merge. It
also notifies Hermes when a run fails or is blocked, provider
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
