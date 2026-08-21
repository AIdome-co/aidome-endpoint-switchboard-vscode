#!/usr/bin/env python3
"""Run the deterministic Switchboard controller as a Hermes no-agent job."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(os.environ.get("SWITCHBOARD_MAINTENANCE_WORKTREE", "/home/aidome-dev/pub-refs/switchboard-worktree")).resolve()
PUB_REFS = Path(os.environ.get("SWITCHBOARD_PUB_REFS", "/home/aidome-dev/pub-refs")).resolve()
REPOSITORY = os.environ.get("SWITCHBOARD_REPOSITORY", "AIdome-co/aidome-endpoint-switchboard-vscode")
CONTROLLER_TIMEOUT_SECONDS = int(os.environ.get("SWITCHBOARD_ENTRYPOINT_TIMEOUT_SECONDS", "1590"))


def main() -> int:
    command = [
        sys.executable,
        str(ROOT / "maintenance/convergence_controller.py"),
        "--root",
        str(ROOT),
        "--pub-refs",
        str(PUB_REFS),
        "--repo",
        REPOSITORY,
        "--auto-weekly",
    ]
    if os.environ.get("SWITCHBOARD_CRON_DRY_RUN") == "1":
        command.append("--dry-run")
    environment = os.environ.copy()
    environment.setdefault("SWITCHBOARD_RUN_BUDGET_SECONDS", "1500")
    try:
        result = subprocess.run(
            command,
            cwd=str(ROOT),
            env=environment,
            capture_output=True,
            text=True,
            timeout=CONTROLLER_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print("Switchboard controller exceeded its entrypoint timeout", file=sys.stderr)
        return 124
    if result.returncode == 2:
        print("Switchboard maintenance paused before completion; it will resume on the next scheduled run", file=sys.stderr)
    elif result.returncode == 3:
        print(
            "Switchboard maintenance deferred discovery (existing PR work or budget priority); "
            "the run resumed on the next scheduled run is reported as incomplete",
            file=sys.stderr,
        )
    elif result.returncode:
        # The controller owns detailed, deduplicated Telegram alerts. Keep the
        # Hermes script failure concise and avoid duplicating or leaking output.
        print(f"Switchboard controller exited with code {result.returncode}", file=sys.stderr)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
