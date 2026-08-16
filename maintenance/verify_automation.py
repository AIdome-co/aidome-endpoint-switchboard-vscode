#!/usr/bin/env python3
"""Read-only verification of the Switchboard maintenance wiring."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


def command_ok(*command: str) -> bool:
    return subprocess.run(command, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0


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
    add("sync-dry-run", command_ok("python3", str(repo / "maintenance/sync_provider_refs.py"), "--dry-run", "--pub-refs", str(pub_refs)), "read-only synchronizer validation")

    missing: list[str] = []
    dirty: list[str] = []
    missing_branches: list[str] = []
    for provider in providers:
        destination = pub_refs / provider["path"]
        if not (destination / ".git").exists():
            missing.append(provider["key"])
            continue
        if subprocess.run(["git", "-C", str(destination), "status", "--porcelain"], check=False, capture_output=True, text=True).stdout.strip():
            dirty.append(provider["key"])
        if not command_ok("git", "-C", str(destination), "show-ref", "--verify", "refs/heads/switchboard-maintenance"):
            missing_branches.append(provider["key"])
    add("provider-references", not missing, f"missing={missing}")
    add("provider-reference-cleanliness", not dirty, f"dirty={dirty}")
    add("weekly-maintenance-branches", not missing_branches, f"missing={missing_branches}")

    if args.runtime:
        add("github-auth", command_ok("gh", "auth", "status"), "gh auth status")
        add("hermes-telegram", command_ok("/home/aidome-dev/.local/bin/hermes", "send", "--list", "telegram"), "Telegram target is configured")
        cron = subprocess.run(["/home/aidome-dev/.local/bin/hermes", "cron", "list", "--all"], check=False, capture_output=True, text=True)
        add("hermes-cron", cron.returncode == 0 and "switchboard-maintenance-daily" in cron.stdout and "0 19 * * *" in cron.stdout, "daily 19:00 job is registered")

    failed = [item for item in checks if not item["ok"]]
    result = {"ok": not failed, "checks": checks, "failed": failed}
    print(json.dumps(result, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
