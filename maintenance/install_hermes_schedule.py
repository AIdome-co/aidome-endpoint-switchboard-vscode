#!/usr/bin/env python3
"""Install or update the idempotent Hermes Switchboard maintenance schedule."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
HERMES = "/home/aidome-dev/.local/bin/hermes"
JOB_NAME = "switchboard-maintenance-daily"
SCHEDULE = "0 19 * * *"

PROMPT = (
    "Read maintenance/agent-prompt.md and docs/maintenance-automation.md before acting. "
    "Run the daily Switchboard maintenance workflow in the repository. Determine the current day "
    "in the configured Asia/Jerusalem timezone; on Sunday perform the weekly provider-reference "
    "synchronization/rebase first, otherwise perform the daily sync. Acquire the documented lock "
    "before modifications. Use the local GitHub CLI credentials to inspect existing branches, "
    "issues, and PRs, implement only reproduced scoped fixes, test them, create focused PRs, "
    "review all open maintenance PRs, update the canonical report comment, and send Hermes Telegram "
    "notifications only for 100% PRs or actionable failures/blocks. Never merge. If there is no "
    "actionable work or alert, record state and remain silent."
)


def run(*args: str) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def main() -> int:
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
            str(ROOT),
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
            str(ROOT),
        ]
        action = "created"
    print(run(*command))
    print(f"{action}: {JOB_NAME} ({SCHEDULE}, Asia/Jerusalem)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
