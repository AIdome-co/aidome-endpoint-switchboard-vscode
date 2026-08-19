#!/usr/bin/env python3
"""List open pull requests that Switchboard maintenance may process."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from typing import Any


REPOSITORY = "AIdome-co/aidome-endpoint-switchboard-vscode"
FULL_FIX_PREFIXES = ("maintenance/switchboard-", "fix/")
READ_ONLY_PREFIXES = ("dependabot/",)


def classify_pr(head_ref: str) -> str | None:
    """Return the processing mode for an open PR, or ``None`` when excluded."""

    if head_ref.startswith(FULL_FIX_PREFIXES):
        return "full-fix"
    if head_ref.startswith(READ_ONLY_PREFIXES):
        return "dependency-review"
    return None


def fetch_open_prs(repository: str) -> list[dict[str, Any]]:
    """Fetch the open PR inventory from GitHub."""

    result = subprocess.run(
        [
            "gh",
            "pr",
            "list",
            "--repo",
            repository,
            "--state",
            "open",
            "--limit",
            "1000",
            "--json",
            "number,title,url,headRefName,headRefOid,headRepository,headRepositoryOwner,isDraft",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode:
        message = (result.stderr or result.stdout).strip()
        raise RuntimeError(f"Could not list open PRs: {message}")
    payload = json.loads(result.stdout)
    if not isinstance(payload, list):
        raise RuntimeError("GitHub returned an invalid open PR inventory")
    return payload


def scoped_prs(prs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Annotate and filter the open PR inventory according to policy."""

    result: list[dict[str, Any]] = []
    for pr in prs:
        head_ref = str(pr.get("headRefName", ""))
        mode = classify_pr(head_ref)
        if mode is None:
            continue
        result.append({**pr, "mode": mode})
    return sorted(result, key=lambda item: int(item["number"]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=REPOSITORY)
    args = parser.parse_args()
    try:
        open_prs = fetch_open_prs(args.repo)
        targets = scoped_prs(open_prs)
        print(
            json.dumps(
                {
                    "repository": args.repo,
                    "fullFixPrefixes": list(FULL_FIX_PREFIXES),
                    "readOnlyPrefixes": list(READ_ONLY_PREFIXES),
                    "pullRequests": targets,
                },
                indent=2,
            )
        )
        return 0
    except (OSError, RuntimeError, ValueError, json.JSONDecodeError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
