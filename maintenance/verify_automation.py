#!/usr/bin/env python3
"""Read-only verification of the Switchboard maintenance wiring."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from schedule_config import (
    EXPECTED_RUN_HOURS,
    HERMES_ENTRYPOINT_NAME,
    HERMES_SCRIPT_TIMEOUT_SECONDS,
    SCHEDULE,
    TELEGRAM_TARGET,
    TIMEZONE_NAME,
)


def command_ok(*command: str) -> bool:
    try:
        return subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120).returncode == 0
    except subprocess.TimeoutExpired:
        return False


def command_output(*command: str) -> str:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired:
        return ""
    return (result.stdout or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--pub-refs", type=Path, default=Path("/home/aidome-dev/pub-refs"))
    parser.add_argument("--runtime", action="store_true", help="Also verify GitHub auth, Hermes target, and the live cron job.")
    args = parser.parse_args()
    repo = args.repo.resolve()
    pub_refs = args.pub_refs.resolve()

    registry = json.loads((repo / "src/core/registry/assistants.registry.json").read_text(encoding="utf-8"))
    manifest = json.loads((repo / "maintenance/provider-repositories.json").read_text(encoding="utf-8"))
    registry_keys = {item["key"] for item in registry["assistants"]}
    providers = manifest["providers"]
    provider_keys = {item["key"] for item in providers}
    checks: list[dict[str, Any]] = []

    def add(name: str, ok: bool, detail: str) -> None:
        checks.append({"name": name, "ok": ok, "detail": detail})

    add("registry-manifest-parity", registry_keys == provider_keys, f"registry={len(registry_keys)} manifest={len(provider_keys)}")
    add("maintenance-prompt", (repo / "maintenance/agent-prompt.md").is_file(), "agent prompt exists")
    add("maintenance-documentation", (repo / "docs/maintenance-automation.md").is_file(), "runbook exists")
    add("deterministic-controller", (repo / "maintenance/convergence_controller.py").is_file(), "convergence controller exists")
    add("deterministic-pr-gate", (repo / "maintenance/review_pr.py").is_file(), "PR gate script exists")
    add("pr-scope-policy", (repo / "maintenance/pr_scope.py").is_file(), "open PR scope policy exists")
    add("sync-dry-run", command_ok("python3", str(repo / "maintenance/sync_provider_refs.py"), "--dry-run", "--pub-refs", str(pub_refs)), "read-only synchronizer validation")

    missing: list[str] = []
    dirty: list[str] = []
    missing_branches: list[str] = []
    remote_mismatches: list[str] = []
    branch_mismatches: list[str] = []
    for provider in providers:
        destination = pub_refs / provider["path"]
        if not (destination / ".git").exists():
            missing.append(provider["key"])
            continue
        if subprocess.run(["git", "-C", str(destination), "status", "--porcelain"], check=False, capture_output=True, text=True).stdout.strip():
            dirty.append(provider["key"])
        if not command_ok("git", "-C", str(destination), "show-ref", "--verify", "refs/heads/switchboard-maintenance"):
            missing_branches.append(provider["key"])
        remote = command_output("git", "-C", str(destination), "remote", "get-url", "upstream")
        if remote.removesuffix(".git").rstrip("/") != provider["url"].removesuffix(".git").rstrip("/"):
            remote_mismatches.append(provider["key"])
        upstream_head = command_output("git", "-C", str(destination), "symbolic-ref", "--short", "refs/remotes/upstream/HEAD")
        if upstream_head != f"upstream/{provider['branch']}":
            branch_mismatches.append(provider["key"])
    add("provider-references", not missing, f"missing={missing}")
    add("provider-reference-cleanliness", not dirty, f"dirty={dirty}")
    add("weekly-maintenance-branches", not missing_branches, f"missing={missing_branches}")
    add("provider-remote-integrity", not remote_mismatches, f"mismatched={remote_mismatches}")
    add("provider-default-branches", not branch_mismatches, f"mismatched={branch_mismatches}")

    if args.runtime:
        hermes = os.environ.get("HERMES_BIN", "/home/aidome-dev/.local/bin/hermes")
        add("github-auth", command_ok("gh", "auth", "status"), "gh auth status")
        add("hermes-telegram", command_ok(hermes, "send", "--list", "telegram"), "Telegram target is configured")
        try:
            cron = subprocess.run([hermes, "cron", "list", "--all"], check=False, capture_output=True, text=True, timeout=120)
        except subprocess.TimeoutExpired:
            cron = None
        jobs_path = Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes"))) / "cron/jobs.json"
        hermes_home = jobs_path.parent.parent
        expected_worktree = pub_refs / "switchboard-worktree"
        cron_ok = False
        cron_detail = f"twice-daily 12:00/19:00 {TIMEZONE_NAME} job is registered"
        try:
            jobs = json.loads(jobs_path.read_text(encoding="utf-8"))["jobs"]
            job = next(item for item in jobs if item.get("name") == "switchboard-maintenance-daily")
            next_run = datetime.fromisoformat(job["next_run_at"]).astimezone(ZoneInfo("Asia/Jerusalem"))
            script_path = hermes_home / "scripts" / str(job.get("script", ""))
            script_text = script_path.read_text(encoding="utf-8") if script_path.is_file() else ""
            config_text = (hermes_home / "config.yaml").read_text(encoding="utf-8")
            timeout_match = re.search(r"(?m)^\s*script_timeout_seconds:\s*(\d+)\s*$", config_text)
            cron_ok = (
                cron is not None
                and cron.returncode == 0
                and job.get("schedule", {}).get("expr") == SCHEDULE
                and job.get("workdir") == str(expected_worktree)
                and job.get("deliver") == TELEGRAM_TARGET
                and job.get("no_agent") is True
                and job.get("script") == HERMES_ENTRYPOINT_NAME
                and script_path.is_file()
                and "convergence_controller.py" in script_text
                and "--auto-weekly" in script_text
                and timeout_match is not None
                and int(timeout_match.group(1)) >= HERMES_SCRIPT_TIMEOUT_SECONDS
                and next_run.hour in EXPECTED_RUN_HOURS
                and next_run.minute == 0
            )
            if not cron_ok:
                cron_detail = (
                    f"schedule={job.get('schedule', {}).get('expr')}, "
                    f"workdir={job.get('workdir')}, deliver={job.get('deliver')}, "
                    f"no_agent={job.get('no_agent')}, script={job.get('script')}, "
                    f"next={next_run.isoformat()}"
                )
        except (OSError, KeyError, StopIteration, json.JSONDecodeError, ValueError) as exc:
            cron_detail = f"could not verify live schedule: {exc}"
        add("hermes-cron", cron_ok, cron_detail)

    failed = [item for item in checks if not item["ok"]]
    result = {"ok": not failed, "checks": checks, "failed": failed}
    print(json.dumps(result, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
