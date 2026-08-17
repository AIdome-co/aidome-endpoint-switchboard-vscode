#!/usr/bin/env python3
"""Evaluate the deterministic 100% gate for a Switchboard pull request.

The maintenance agent may write the narrative report, but this script owns the
objective parts of the gate: current-head evidence, GitHub checks, draft state,
mergeability, review threads, and the canonical report marker.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from typing import Any


REPORT_MARKER = "<!-- switchboard-maintenance-report -->"
REQUIRED_REVIEW_REQUEST = (
    "Please tell me what is left to be done here in relation to tests coverage, "
    "error handling, documentation alignment and other quality related stuff - "
    "you can correlate these stuff against also ~/pub-refs/ as well - once done, "
    "send a comment with full report of % and the stuff that still need to be done "
    "in this PR as a comment in the PR"
)
PASSING_CONCLUSIONS = {"SUCCESS", "NEUTRAL", "SKIPPED"}


class ReviewError(RuntimeError):
    """Raised when GitHub data cannot be inspected safely."""


def run(*command: str) -> str:
    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, timeout=120)
    except subprocess.TimeoutExpired as exc:
        raise ReviewError(f"{' '.join(command)} timed out after 120s") from exc
    output = (result.stdout or result.stderr).strip()
    if result.returncode:
        raise ReviewError(f"{' '.join(command)} failed: {output}")
    return output


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9%]+", " ", text.lower()).strip()


def parse_repo(repository: str) -> tuple[str, str]:
    parts = repository.strip().split("/")
    if len(parts) != 2 or not all(parts):
        raise ReviewError(f"Repository must be OWNER/NAME: {repository}")
    return parts[0], parts[1]


def check_is_passing(check: dict[str, Any]) -> bool:
    status = str(check.get("status", "")).upper()
    conclusion = str(check.get("conclusion", "")).upper()
    state = str(check.get("state", "")).upper()
    if status and status != "COMPLETED":
        return False
    if conclusion and conclusion not in PASSING_CONCLUSIONS:
        return False
    if state and state not in {"SUCCESS", "EXPECTED"}:
        return False
    return bool(status or conclusion or state)


def latest_report(comments: list[dict[str, Any]]) -> tuple[str | None, int]:
    reports = [comment.get("body", "") for comment in comments if REPORT_MARKER in comment.get("body", "")]
    return (reports[-1] if reports else None), len(reports)


def report_percent(report: str) -> int | None:
    match = re.search(r"\*\*Completion:\s*(\d+)%\*\*", report, re.IGNORECASE)
    return int(match.group(1)) if match else None


def report_commit(report: str) -> str | None:
    match = re.search(r"\bCommit\b.*?([0-9a-f]{7,40})", report, re.IGNORECASE)
    return match.group(1) if match else None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pr", type=int, required=True)
    parser.add_argument("--repo", default="AIdome-co/aidome-endpoint-switchboard-vscode")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable output (the default).")
    args = parser.parse_args()
    try:
        owner, name = parse_repo(args.repo)
        pr = json.loads(
            run(
                "gh",
                "pr",
                "view",
                str(args.pr),
                "--repo",
                args.repo,
                "--json",
                "number,title,url,isDraft,state,mergeStateStatus,mergeable,reviewDecision,headRefOid,statusCheckRollup,comments",
            )
        )
        graphql = run(
            "gh",
            "api",
            "graphql",
            "-f",
            "query=query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved,isOutdated,comments(first:20){nodes{author{login},body,url}}},pageInfo{hasNextPage}}}}}",
            "-f",
            f"owner={owner}",
            "-f",
            f"name={name}",
            "-F",
            f"number={args.pr}",
        )
        thread_data = json.loads(graphql)["data"]["repository"]["pullRequest"]["reviewThreads"]
        threads = thread_data.get("nodes", [])
        unresolved = [thread for thread in threads if not thread.get("isResolved") and not thread.get("isOutdated")]
        codex_comments = [
            comment
            for thread in unresolved
            for comment in thread.get("comments", {}).get("nodes", [])
            if "codex" in str((comment.get("author") or {}).get("login", "")).lower()
            or "codex" in str(comment.get("body", "")).lower()
        ]

        checks = pr.get("statusCheckRollup") or []
        report, report_count = latest_report(pr.get("comments") or [])
        head = str(pr.get("headRefOid", ""))
        reasons: list[str] = []
        if pr.get("state") != "OPEN":
            reasons.append("PR is not open")
        if pr.get("isDraft"):
            reasons.append("PR is still a draft")
        if pr.get("mergeable") != "MERGEABLE":
            reasons.append(f"GitHub mergeable={pr.get('mergeable')}")
        if pr.get("mergeStateStatus") != "CLEAN":
            reasons.append(f"GitHub mergeStateStatus={pr.get('mergeStateStatus')}")
        if pr.get("reviewDecision") == "CHANGES_REQUESTED":
            reasons.append("GitHub has requested changes")
        if not checks:
            reasons.append("no GitHub checks were returned")
        elif not all(check_is_passing(check) for check in checks):
            reasons.append("one or more GitHub checks are pending or failing")
        if unresolved:
            reasons.append(f"{len(unresolved)} unresolved review thread(s)")
        if thread_data.get("pageInfo", {}).get("hasNextPage"):
            reasons.append("review thread results were truncated")
        if report is None:
            reasons.append("canonical maintenance report is missing")
        else:
            if report_count != 1:
                reasons.append(f"expected exactly one canonical report, found {report_count}")
            if report_percent(report) != 100:
                reasons.append(f"report completion is {report_percent(report)}%")
            commit = report_commit(report)
            if not commit or not head.startswith(commit):
                reasons.append("report does not identify the current PR head commit")
            if normalize(REQUIRED_REVIEW_REQUEST) not in normalize(report):
                reasons.append("report does not contain the required review request")
            if not re.search(r"remaining\s+work\s*:\s*(none|nothing|0|no remaining work)", report, re.IGNORECASE):
                reasons.append("report still lists remaining work")

        payload = {
            "eligible100": not reasons,
            "pr": {
                "number": pr.get("number"),
                "title": pr.get("title"),
                "url": pr.get("url"),
                "headCommit": head,
                "isDraft": pr.get("isDraft"),
                "mergeable": pr.get("mergeable"),
                "mergeStateStatus": pr.get("mergeStateStatus"),
                "reviewDecision": pr.get("reviewDecision"),
            },
            "checks": {"count": len(checks), "allPassing": bool(checks) and all(check_is_passing(check) for check in checks)},
            "reviewThreads": {"unresolved": len(unresolved), "codex": len(codex_comments)},
            "report": {"count": report_count, "percent": report_percent(report or ""), "hasRequiredRequest": bool(report and normalize(REQUIRED_REVIEW_REQUEST) in normalize(report))},
            "reasons": reasons,
        }
        print(json.dumps(payload, indent=2))
        return 0 if not reasons else 1
    except (ReviewError, json.JSONDecodeError, KeyError) as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
