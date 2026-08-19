#!/usr/bin/env python3
"""Install and verify the idempotent Hermes Switchboard schedule."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from convergence_controller import discover_supported_node_bin_dir
from schedule_config import (
    EXPECTED_RUN_HOURS,
    HERMES_ENTRYPOINT_NAME,
    HERMES_SCRIPT_TIMEOUT_SECONDS,
    SCHEDULE,
    TELEGRAM_TARGET,
    TIMEZONE_NAME,
)


ROOT = Path(__file__).resolve().parent.parent
PUB_REFS = Path(os.environ.get("SWITCHBOARD_PUB_REFS", "/home/aidome-dev/pub-refs")).resolve()
WORKTREE = Path(
    os.environ.get("SWITCHBOARD_MAINTENANCE_WORKTREE", str(PUB_REFS / "switchboard-worktree"))
).resolve()
HERMES = os.environ.get("HERMES_BIN", "/home/aidome-dev/.local/bin/hermes")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))).resolve()
JOB_NAME = "switchboard-maintenance-daily"
TIMEZONE = ZoneInfo(TIMEZONE_NAME)
ENTRYPOINT_SOURCE = WORKTREE / "maintenance/hermes_cron_entrypoint.py"
ENTRYPOINT_DEST = HERMES_HOME / "scripts" / HERMES_ENTRYPOINT_NAME

PROMPT = (
    f"Deterministic Switchboard maintenance runs from {WORKTREE} in a no-agent script. "
    "The controller owns all repository actions, checkpoints, gates, and deduplicated Telegram notifications."
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


def install_entrypoint() -> None:
    """Install the reviewed controller entrypoint inside Hermes' script sandbox."""

    if not ENTRYPOINT_SOURCE.is_file():
        raise RuntimeError(f"Maintenance entrypoint is missing from the deployed worktree: {ENTRYPOINT_SOURCE}")
    ENTRYPOINT_DEST.parent.mkdir(parents=True, exist_ok=True)
    temporary = ENTRYPOINT_DEST.with_name(f".{ENTRYPOINT_DEST.name}.{os.getpid()}.tmp")
    shutil.copyfile(ENTRYPOINT_SOURCE, temporary)
    temporary.chmod(0o700)
    temporary.replace(ENTRYPOINT_DEST)


def configure_script_timeout() -> None:
    run(HERMES, "config", "set", "cron.script_timeout_seconds", str(HERMES_SCRIPT_TIMEOUT_SECONDS))


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
    if not job.get("no_agent") or job.get("script") != HERMES_ENTRYPOINT_NAME:
        raise RuntimeError(f"Hermes job is not using the deterministic no-agent entrypoint: {job.get('script')}")
    if not ENTRYPOINT_DEST.is_file():
        raise RuntimeError(f"Hermes entrypoint was not installed: {ENTRYPOINT_DEST}")
    config_text = (HERMES_HOME / "config.yaml").read_text(encoding="utf-8")
    match = re.search(r"(?m)^\s*script_timeout_seconds:\s*(\d+)\s*$", config_text)
    if not match or int(match.group(1)) < HERMES_SCRIPT_TIMEOUT_SECONDS:
        raise RuntimeError("Hermes cron script timeout is shorter than the controller entrypoint budget")
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
    install_entrypoint()
    run(HERMES, "config", "set", "timezone", TIMEZONE_NAME)
    configure_script_timeout()
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
            "--script",
            HERMES_ENTRYPOINT_NAME,
            "--no-agent",
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
            "--script",
            HERMES_ENTRYPOINT_NAME,
            "--no-agent",
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
