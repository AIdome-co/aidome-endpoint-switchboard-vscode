#!/usr/bin/env python3
"""Install and verify the idempotent Hermes Switchboard schedule."""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from convergence_controller import discover_supported_node_bin_dir
from schedule_config import EXPECTED_RUN_HOURS, SCHEDULE, TELEGRAM_TARGET, TIMEZONE_NAME


ROOT = Path(__file__).resolve().parent.parent
PUB_REFS = Path(os.environ.get("SWITCHBOARD_PUB_REFS", "/home/aidome-dev/pub-refs")).resolve()
WORKTREE = Path(
    os.environ.get("SWITCHBOARD_MAINTENANCE_WORKTREE", str(PUB_REFS / "switchboard-worktree"))
).resolve()
HERMES = os.environ.get("HERMES_BIN", "/home/aidome-dev/.local/bin/hermes")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).resolve()
JOB_NAME = "switchboard-maintenance-daily"
TIMEZONE = ZoneInfo(TIMEZONE_NAME)

PROMPT = (
    f"This scheduled job runs at 12:00 and 19:00 in {TIMEZONE_NAME}. "
    f"Operate only through the deterministic controller in {WORKTREE}; never use the user checkout. "
    f"Run: python3 {WORKTREE}/maintenance/convergence_controller.py "
    f"--root {WORKTREE} --pub-refs {PUB_REFS} --repo AIdome-co/aidome-endpoint-switchboard-vscode "
    "--auto-weekly. The controller owns provider synchronization, trusted-source checks, isolated "
    "per-PR worktrees, bounded Hermes fix cycles, validation, push/current-head verification, the "
    "100% gate, durable state, and idempotent Telegram notifications. Do not perform maintenance "
    "actions outside the controller, do not merge, and do not send a second notification. The final "
    "response must be exactly [SILENT] because the controller sends only deduplicated actionable "
    "notifications directly through Hermes."
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


def ensure_dependencies() -> None:
    """Bootstrap the ignored runtime dependencies used by validation commands."""

    if (WORKTREE / "node_modules/.bin/eslint").is_file():
        return
    try:
        node_bin_dir = discover_supported_node_bin_dir()
    except RuntimeError as exc:
        raise RuntimeError(str(exc)) from exc
    npm = node_bin_dir / "npm"
    run(
        "env",
        f"PATH={node_bin_dir}:{os.environ.get('PATH', '')}",
        str(npm),
        "--prefix",
        str(WORKTREE),
        "ci",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        timeout=900,
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
    if job.get("deliver") != TELEGRAM_TARGET:
        raise RuntimeError(f"Hermes delivery target is not Telegram: {job.get('deliver')}")
    next_run = job.get("next_run_at")
    if not next_run:
        raise RuntimeError(f"Hermes did not persist a next run for {JOB_NAME}")
    local_next_run = datetime.fromisoformat(next_run).astimezone(TIMEZONE)
    if (local_next_run.hour, local_next_run.minute) not in {(hour, 0) for hour in EXPECTED_RUN_HOURS}:
        raise RuntimeError(
            f"Hermes next run is {local_next_run.isoformat()}, not 12:00 or 19:00 {TIMEZONE_NAME}. "
            "Restart/reload the Hermes gateway and rerun this installer."
        )


def main() -> int:
    ensure_worktree()
    ensure_dependencies()
    run(HERMES, "config", "set", "timezone", TIMEZONE_NAME)
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
            TELEGRAM_TARGET,
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
            TELEGRAM_TARGET,
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
