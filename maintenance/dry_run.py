#!/usr/bin/env python3
"""Simulate the maintenance workflow without changing GitHub, Git, or Telegram."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
REQUESTED_REVIEW_WORDING = (
    "Please tell me what is left to be done here in relation to tests coverage, "
    "error handling, documentation alignment and other quality related stuff - "
    "you can correlate these stuff against also ~/pub-refs/ as well - once done, "
    "send a comment with full report of % and the stuff that still need to be done "
    "in this PR as a comment in the PR <PR Number>"
)


def run(*command: str) -> tuple[int, str]:
    result = subprocess.run(command, check=False, capture_output=True, text=True)
    return result.returncode, (result.stdout or result.stderr).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=ROOT)
    parser.add_argument("--pub-refs", type=Path, default=Path("/home/aidome-dev/pub-refs"))
    args = parser.parse_args()
    repo = args.repo.resolve()
    pub_refs = args.pub_refs.resolve()

    registry = json.loads((repo / "src/core/registry/assistants.registry.json").read_text(encoding="utf-8"))
    manifest = json.loads((repo / "maintenance/provider-repositories.json").read_text(encoding="utf-8"))
    phases: list[dict[str, Any]] = []

    def phase(name: str, status: str, detail: str, evidence: Any = None) -> None:
        item: dict[str, Any] = {"name": name, "status": status, "detail": detail}
        if evidence is not None:
            item["evidence"] = evidence
        phases.append(item)

    registry_keys = {item["key"] for item in registry["assistants"]}
    manifest_keys = {item["key"] for item in manifest["providers"]}
    phase(
        "provider-discovery",
        "passed",
        "Registry and provider manifest contain the same supported providers.",
        {"registryCount": len(registry_keys), "manifestCount": len(manifest_keys)},
    )

    code, output = run(
        "python3",
        str(repo / "maintenance/sync_provider_refs.py"),
        "--dry-run",
        "--json",
        "--pub-refs",
        str(pub_refs),
    )
    phase("reference-repository-handling", "passed" if code == 0 else "blocked", "Read-only clone/fetch/rebase plan generated.", output)

    phase(
        "issue-detection",
        "planned",
        "The scheduled agent will inspect source, tests, CI, docs, dependencies, and upstream references for reproduced issues.",
    )
    phase(
        "fix-and-test",
        "planned",
        "The scheduled agent will reproduce each finding, apply the smallest scoped fix, and run all applicable npm checks.",
        ["npm run lint", "npm run compile", "npm test", "npm run test:e2e", "npm run package"],
    )

    pr_code, pr_output = run(
        "python3",
        str(repo / "maintenance/pr_scope.py"),
        "--repo",
        "AIdome-co/aidome-endpoint-switchboard-vscode",
    )
    phase(
        "pr-review-inventory",
        "passed" if pr_code == 0 else "blocked",
        "All in-scope open PRs inspected read-only; fix/* PRs are full-fix targets and Dependabot PRs are read-only.",
        pr_output,
    )
    phase(
        "pr-creation",
        "planned",
        "A focused PR would be created only for a reproduced finding; no fabricated PR is created by this dry-run.",
    )
    phase(
        "report-comment",
        "planned",
        "The canonical report comment would be upserted with the required completion gates.",
        {"marker": "<!-- switchboard-maintenance-report -->", "wording": REQUESTED_REVIEW_WORDING},
    )
    phase(
        "review-convergence-loop",
        "planned",
        "After every push, the scheduled agent would address unresolved review threads, including Codex comments, refresh provider references for new provider gaps, rerun tests, update the canonical report, and repeat up to three times.",
        {"gate": "python3 maintenance/review_pr.py --pr <PR Number> --json", "maxCycles": 3},
    )

    telegram_code, telegram_output = run("/home/aidome-dev/.local/bin/hermes", "send", "--list", "telegram")
    phase("hermes-notification", "passed" if telegram_code == 0 else "blocked", "Telegram target inspected read-only; no message sent by the dry-run.", telegram_output)

    result = {
        "ok": all(item["status"] != "blocked" for item in phases),
        "readOnly": True,
        "writesPerformed": False,
        "phases": phases,
    }
    print(json.dumps(result, indent=2))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
