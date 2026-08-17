#!/usr/bin/env python3
"""Install and verify the idempotent Hermes Switchboard schedule."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parent.parent
PUB_REFS = Path(os.environ.get("SWITCHBOARD_PUB_REFS", "/home/aidome-dev/pub-refs")).resolve()
WORKTREE = Path(
    os.environ.get("SWITCHBOARD_MAINTENANCE_WORKTREE", str(PUB_REFS / "switchboard-worktree"))
).resolve()
HERMES = os.environ.get("HERMES_BIN", "/home/aidome-dev/.local/bin/hermes")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).resolve()
JOB_NAME = "switchboard-maintenance-daily"
SCHEDULE = "0 19 * * *"
TIMEZONE = ZoneInfo("Asia/Jerusalem")

PROMPT = (
    "Read maintenance/agent-prompt.md and docs/maintenance-automation.md before acting. "
    "Run the daily Switchboard maintenance workflow in this dedicated worktree. Determine the "
    "current day in the configured Asia/Jerusalem timezone; on Sunday perform the weekly "
    "provider-reference synchronization/rebase first, otherwise perform the daily sync. "
    "Acquire the documented lock before modifications. Use the local GitHub CLI credentials to "
    "inspect existing branches, issues, PRs, and all unresolved review threads, including Codex "
    "comments. For every PR iteration, use the exact requested coverage/error-handling/"
    "documentation/quality review wording, update the canonical report comment, and run "
    "maintenance/review_pr.py. For every new provider-related gap, synchronize the matching "
    "official repository in ~/pub-refs before fixing it. Reproduce scoped issues, fix and test "
    "them, push, then repeat the review/fix/test/push loop until the deterministic gate is 100% "
    "or the bounded retry limit is reached. Send Hermes Telegram notifications only for 100% PRs "
    "or actionable failures/blocks. Never merge. If there is no actionable work or alert, record "
    "state and remain silent."
)


def run(*args: str, timeout: int = 120) -> str:
    try:
        result = subprocess.run(args, check=False, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"{' '.join(args)} timed out after {timeout}s") from exc
    output = (result.stdout or result.stderr).strip()
    if result.returncode:
        raise RuntimeError(f"{' '.join(args)} failed: {output}")
    return output


def ensure_worktree() -> None:
    WORKTREE.parent.mkdir(parents=True, exist_ok=True)
    if not WORKTREE.exists():
        run("git", "-C", str(ROOT), "fetch", "origin", "main", timeout=900)
        run("git", "-C", str(ROOT), "worktree", "add", "--detach", str(WORKTREE), "origin/main", timeout=120)
    if not (WORKTREE / ".git").exists():
        raise RuntimeError(f"Maintenance worktree is not a Git worktree: {WORKTREE}")
    if run("git", "-C", str(WORKTREE), "status", "--porcelain"):
        raise RuntimeError(f"Maintenance worktree is dirty; refusing to run: {WORKTREE}")
    run("git", "-C", str(WORKTREE), "fetch", "origin", "main", timeout=900)
    run("git", "-C", str(WORKTREE), "switch", "--detach", "origin/main", timeout=120)
    if not (WORKTREE / "maintenance/agent-prompt.md").is_file():
        raise RuntimeError(
            "origin/main does not contain the maintenance automation yet; merge PR #116 "
            "before installing the dedicated cron worktree."
        )


def verify_live_schedule() -> None:
    jobs_path = HERMES_HOME / "cron/jobs.json"
    try:
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))["jobs"]
    except (OSError, KeyError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Could not read Hermes cron state: {jobs_path}: {exc}") from exc
    job = next((item for item in jobs if item.get("name") == JOB_NAME), None)
    if job is None:
        raise RuntimeError(f"Hermes job was not found after installation: {JOB_NAME}")
    if job.get("schedule", {}).get("expr") != SCHEDULE:
        raise RuntimeError(f"Unexpected schedule for {JOB_NAME}: {job.get('schedule')}")
    if job.get("workdir") != str(WORKTREE):
        raise RuntimeError(f"Hermes workdir is not the dedicated worktree: {job.get('workdir')}")
    next_run = job.get("next_run_at")
    if not next_run:
        raise RuntimeError(f"Hermes did not persist a next run for {JOB_NAME}")
    local_next_run = datetime.fromisoformat(next_run).astimezone(TIMEZONE)
    if (local_next_run.hour, local_next_run.minute) != (19, 0):
        raise RuntimeError(
            f"Hermes next run is {local_next_run.isoformat()}, not 19:00 Asia/Jerusalem. "
            "Restart/reload the Hermes gateway and rerun this installer."
        )


def main() -> int:
    ensure_worktree()
    run(HERMES, "config", "set", "timezone", "Asia/Jerusalem")
    jobs = run(HERMES, "cron", "list", "--all")
    if JOB_NAME in jobs:
        command = [
            HERMES,
            "cron",
            "edit",
            JOB_NAME,
            "--schedule",
            SCHEDULE,
            "--prompt",
            PROMPT,
            "--deliver",
            "local",
            "--workdir",
            str(WORKTREE),
        ]
        action = "updated"
    else:
        command = [
            HERMES,
            "cron",
            "create",
            SCHEDULE,
            PROMPT,
            "--name",
            JOB_NAME,
            "--deliver",
            "local",
            "--workdir",
            str(WORKTREE),
        ]
        action = "created"
    print(run(*command))
    verify_live_schedule()
    print(f"{action}: {JOB_NAME} ({SCHEDULE}, Asia/Jerusalem, {WORKTREE})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
