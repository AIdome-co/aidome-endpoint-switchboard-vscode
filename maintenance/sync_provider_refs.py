#!/usr/bin/env python3
"""Synchronize official provider source repositories used by Switchboard maintenance.

The checked-in JSON is the desired provider inventory. Runtime synchronization
state is intentionally stored under pub-refs so daily maintenance does not
create unrelated commits in the Switchboard repository.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


DEFAULT_CONFIG = Path(__file__).with_name("provider-repositories.json")
STATE_FILENAME = "switchboard-provider-manifest.json"
MAINTENANCE_BRANCH = "switchboard-maintenance"


class SyncError(RuntimeError):
    """Raised when a provider reference cannot be synchronized safely."""


def run_git(repo: Path | None, *args: str, check: bool = True) -> str:
    command = ["git"]
    if repo is not None:
        command.extend(["-C", str(repo)])
    command.extend(args)
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    if result.returncode != 0 and not check:
        return (result.stdout or "").strip()
    output = (result.stdout or result.stderr).strip()
    if check and result.returncode != 0:
        raise SyncError(f"{' '.join(command)} failed: {output}")
    return output


def run_command(*args: str, check: bool = True) -> str:
    result = subprocess.run(args, check=False, capture_output=True, text=True)
    output = (result.stdout or result.stderr).strip()
    if check and result.returncode != 0:
        raise SyncError(f"{' '.join(args)} failed: {output}")
    return output


def validate_repository_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc.lower() != "github.com":
        raise SyncError(f"Only HTTPS GitHub URLs are allowed: {url}")
    if not parsed.path.strip("/"):
        raise SyncError(f"Repository URL has no repository path: {url}")


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SyncError(f"Could not read provider manifest {path}: {exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("providers"), list):
        raise SyncError(f"Invalid provider manifest shape: {path}")
    return config


def get_branch(repo: Path, configured_branch: str) -> str:
    branch = run_git(repo, "symbolic-ref", "--short", "refs/remotes/upstream/HEAD", check=False)
    if branch.startswith("upstream/"):
        return branch.removeprefix("upstream/")
    return configured_branch


def ensure_remote(repo: Path, url: str, dry_run: bool) -> None:
    existing_url = run_git(repo, "remote", "get-url", "upstream", check=False)
    if existing_url:
        normalized_existing = existing_url.removesuffix(".git").rstrip("/")
        normalized_configured = url.removesuffix(".git").rstrip("/")
        if normalized_existing != normalized_configured:
            raise SyncError(
                f"Existing upstream remote does not match manifest: {existing_url} != {url}"
            )
        return
    if not dry_run:
        run_git(repo, "remote", "add", "upstream", url)


def sync_provider(provider: dict[str, Any], pub_refs: Path, weekly: bool, dry_run: bool) -> dict[str, Any]:
    key = str(provider.get("key", ""))
    url = str(provider.get("url", ""))
    branch = str(provider.get("branch", ""))
    relative_path = str(provider.get("path", ""))
    if not key or not url or not branch or not relative_path:
        raise SyncError(f"Provider entry is missing key, url, branch, or path: {provider}")
    validate_repository_url(url)

    destination = (pub_refs / relative_path).resolve()
    if pub_refs.resolve() not in destination.parents:
        raise SyncError(f"Provider path escapes pub-refs: {relative_path}")

    action = "unchanged"
    synchronized_commit: str | None = None
    if not destination.exists():
        action = "clone"
        if not dry_run:
            destination.parent.mkdir(parents=True, exist_ok=True)
            run_command("git", "clone", "--origin", "upstream", url, str(destination))
    elif not (destination / ".git").exists():
        raise SyncError(f"Reference path exists but is not a Git repository: {destination}")

    if not dry_run:
        ensure_remote(destination, url, dry_run=False)
        dirty = run_git(destination, "status", "--porcelain")
        if dirty:
            raise SyncError(f"Reference repository has local changes; refusing to modify: {destination}")
        actual_branch = get_branch(destination, branch)
        run_git(destination, "fetch", "--prune", "upstream", actual_branch)
        upstream_ref = f"upstream/{actual_branch}"
        synchronized_commit = run_git(destination, "rev-parse", upstream_ref)
        if weekly:
            local_branch_exists = run_git(
                destination, "show-ref", "--verify", f"refs/heads/{MAINTENANCE_BRANCH}", check=False
            )
            if local_branch_exists:
                run_git(destination, "rebase", upstream_ref, MAINTENANCE_BRANCH)
            else:
                run_git(destination, "branch", MAINTENANCE_BRANCH, upstream_ref)
            action = "fetched-and-rebased"
        elif action != "clone":
            action = "fetched"
    else:
        if destination.exists():
            ensure_remote(destination, url, dry_run=True)
        action = "would-clone" if action == "clone" else "would-fetch"
        if weekly:
            action = "would-sync-and-rebase"

    return {
        "key": key,
        "displayName": provider.get("displayName", key),
        "url": url,
        "branch": branch,
        "path": str(destination),
        "status": provider.get("status", "active"),
        "action": action,
        "synchronizedCommit": synchronized_commit,
        "synchronizedAt": datetime.now(timezone.utc).isoformat(),
    }


def write_state(path: Path, config: dict[str, Any], results: list[dict[str, Any]], dry_run: bool) -> None:
    if dry_run:
        return
    state = {
        "schemaVersion": config.get("schemaVersion", "1.0.0"),
        "switchboardRepository": config.get("switchboardRepository"),
        "maintenanceBranch": MAINTENANCE_BRANCH,
        "lastRunAt": datetime.now(timezone.utc).isoformat(),
        "providers": results,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--pub-refs", type=Path, default=None)
    parser.add_argument("--weekly", action="store_true", help="Rebase the local maintenance branch after fetching.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and report actions without network or filesystem mutations.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable results.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        config = load_config(args.config.resolve())
        configured_root = config.get("pubRefsRoot", "~/pub-refs")
        pub_refs = (args.pub_refs or Path(str(configured_root)).expanduser()).resolve()
        results: list[dict[str, Any]] = []
        failures: list[dict[str, str]] = []
        for provider in config["providers"]:
            try:
                results.append(sync_provider(provider, pub_refs, args.weekly, args.dry_run))
            except SyncError as exc:
                failures.append({"key": str(provider.get("key", "unknown")), "error": str(exc)})

        if failures:
            payload = {"ok": False, "pubRefs": str(pub_refs), "results": results, "failures": failures}
            if args.json:
                print(json.dumps(payload, indent=2), file=sys.stderr)
            else:
                print("\n".join(f"{item['key']}: {item['error']}" for item in failures), file=sys.stderr)
            return 1

        state_path = pub_refs / STATE_FILENAME
        write_state(state_path, config, results, args.dry_run)
        payload = {
            "ok": True,
            "dryRun": args.dry_run,
            "weekly": args.weekly,
            "pubRefs": str(pub_refs),
            "state": str(state_path),
            "results": results,
        }
        if args.json:
            print(json.dumps(payload, indent=2))
        else:
            print("\n".join(f"{item['key']}: {item['action']}" for item in results))
        return 0
    except SyncError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
