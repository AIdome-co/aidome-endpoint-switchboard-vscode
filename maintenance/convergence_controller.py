#!/usr/bin/env python3
"""Deterministic controller for Switchboard maintenance PR convergence.

Hermes is used for the reasoning and code-change step, one bounded cycle at a
time. This controller owns the safety-critical transitions: trusted-source
checks, worktree isolation, validation, push verification, the current-head
100% gate, durable state, and idempotent Telegram notifications.
"""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

try:
    from .schedule_config import TELEGRAM_TARGET, TIMEZONE_NAME
except ImportError:  # Script execution from the maintenance directory.
    from schedule_config import TELEGRAM_TARGET, TIMEZONE_NAME


REPOSITORY = "AIdome-co/aidome-endpoint-switchboard-vscode"
FULL_FIX_PREFIXES = ("maintenance/switchboard-", "fix/")
READ_ONLY_PREFIXES = ("dependabot/",)
REPORT_MARKER = "<!-- switchboard-maintenance-report -->"
MAX_CYCLES_PER_RUN = 3
STATE_SCHEMA_VERSION = "2.0.0"
COMMAND_TIMEOUT = 120
AGENT_TIMEOUT = 3600
VALIDATION_TIMEOUT = 1800
NOTIFICATION_RETRIES = 3
CHECK_WAIT_SECONDS = 300
CHECK_POLL_SECONDS = 15
VALIDATION_COMMANDS: tuple[tuple[str, ...], ...] = (
    ("npm", "run", "lint"),
    ("npm", "run", "compile"),
    ("npm", "test"),
    ("npm", "run", "test:e2e"),
    ("npm", "run", "test:continue:coverage"),
    ("npm", "run", "test:kilo:coverage"),
    ("npm", "run", "test:roo:coverage"),
    ("npm", "run", "package"),
)


class ControllerError(RuntimeError):
    """Raised when the controller cannot safely continue."""


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False

    @property
    def output(self) -> str:
        return (self.stdout or self.stderr).strip()


Runner = Callable[..., CommandResult]


def command_runner(*command: str, cwd: Path | None = None, timeout: int = COMMAND_TIMEOUT) -> CommandResult:
    """Run a command without a shell and without inheriting interactive Git prompts."""

    try:
        result = subprocess.run(
            command,
            cwd=str(cwd) if cwd else None,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except subprocess.TimeoutExpired as exc:
        return CommandResult(124, str(exc), str(exc), timed_out=True)
    return CommandResult(result.returncode, result.stdout or "", result.stderr or "")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def short_output(value: str, limit: int = 1200) -> str:
    value = re.sub(r"(?i)(token|password|secret|authorization)\s*[=:]\s*\S+", r"\1=[REDACTED]", value)
    value = re.sub(r"https?://[^\s)]+", "[URL_REDACTED]", value)
    return value[-limit:]


def discover_supported_node_bin_dir() -> Path:
    """Find an approved Node.js >=22 runtime and its npm executable."""

    candidates: list[Path] = []
    configured = os.environ.get("SWITCHBOARD_NODE_BIN")
    if configured:
        candidates.append(Path(configured).expanduser())
    nvm_root = Path("/home/aidome-dev/.nvm/versions/node")
    if nvm_root.is_dir():
        candidates.extend(sorted(nvm_root.glob("v*/bin/node"), reverse=True))
    discovered = shutil.which("node")
    if discovered:
        candidates.append(Path(discovered))
    for candidate in candidates:
        node = candidate / "node" if candidate.is_dir() else candidate
        npm = node.with_name("npm")
        if not node.is_file() or not npm.is_file():
            continue
        try:
            result = subprocess.run([str(node), "--version"], check=False, capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.TimeoutExpired):
            continue
        match = re.match(r"v(\d+)", result.stdout.strip())
        if result.returncode == 0 and match and int(match.group(1)) >= 22:
            return node.parent
    raise ControllerError(
        "A supported Node.js runtime (>=22 with npm) is unavailable; "
        "set SWITCHBOARD_NODE_BIN to the approved Node executable."
    )


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_state(path: Path, repository: str = REPOSITORY) -> dict[str, Any]:
    if not path.exists():
        return {
            "schemaVersion": STATE_SCHEMA_VERSION,
            "repository": repository,
            "prs": {},
            "notifications": {},
            "runs": [],
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ControllerError(f"Cannot read maintenance state {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ControllerError(f"Maintenance state is not an object: {path}")
    payload.setdefault("schemaVersion", STATE_SCHEMA_VERSION)
    payload.setdefault("repository", repository)
    payload.setdefault("prs", {})
    payload.setdefault("notifications", {})
    payload.setdefault("runs", [])
    return payload


def save_state(path: Path, state: dict[str, Any]) -> None:
    state["schemaVersion"] = STATE_SCHEMA_VERSION
    state["updatedAt"] = utc_now()
    state["runs"] = state.get("runs", [])[-50:]
    atomic_write_json(path, state)


def parse_json_output(result: CommandResult, description: str) -> Any:
    if result.returncode != 0:
        raise ControllerError(f"{description} failed: {short_output(result.output)}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise ControllerError(f"{description} returned invalid JSON: {short_output(result.output)}") from exc


def classify_branch(branch: str) -> str | None:
    if branch.startswith(FULL_FIX_PREFIXES):
        return "full-fix"
    if branch.startswith(READ_ONLY_PREFIXES):
        return "dependency-review"
    return None


def trusted_head_repository(pr: dict[str, Any], repository: str) -> bool:
    owner = str((pr.get("headRepositoryOwner") or {}).get("login", ""))
    name = str((pr.get("headRepository") or {}).get("name", ""))
    return f"{owner}/{name}".casefold() == repository.casefold()


def notification_key(kind: str, pr_number: int, head: str, detail: str = "") -> str:
    digest = hashlib.sha256(detail.encode("utf-8")).hexdigest()[:12]
    return f"{kind}:{pr_number}:{head}:{digest}"


def cycle_prompt(pr: dict[str, Any], cycle: int, worktree: Path, pub_refs: Path) -> str:
    number = int(pr["number"])
    branch = str(pr["headRefName"])
    title = str(pr.get("title", ""))
    return textwrap.dedent(
        f"""
        You are one bounded Switchboard maintenance cycle, cycle {cycle}/{MAX_CYCLES_PER_RUN}, for PR #{number}.
        Repository: {REPOSITORY}
        PR title: {title}
        Branch: {branch}
        Worktree: {worktree}
        Provider references: {pub_refs}

        Work only in this worktree and only on this PR branch. Do not merge anything, modify main,
        modify another PR, or send Telegram. Read AGENTS.md, CLAUDE.md, docs/maintenance-automation.md,
        maintenance/agent-prompt.md, and relevant provider references before acting.

        Apply the exact requested review:
        "Please tell me what is left to be done here in relation to tests coverage, error handling,
        documentation alignment and other quality related stuff - you can correlate these stuff against
        also ~/pub-refs/ as well - once done, send a comment with full report of % and the stuff that
        still need to be done in this PR as a comment in the PR {number}"

        Inspect the current diff, CI, unresolved review and Codex comments, tests, error handling,
        documentation, changelog, security, maintainability, dependencies, and relevant official
        provider references. Synchronize the matching provider reference before fixing a newly found
        provider-related gap. Reproduce actionable gaps, implement the smallest safe fix, add regression
        tests, update documentation/changelog when required, and commit and push the branch.

        Update exactly one comment containing {REPORT_MARKER}. The report must include the completion
        percentage, current commit SHA, tests/coverage, error handling, documentation alignment,
        quality/maintainability, security, provider correlation, evidence commands, and remaining work.
        Never claim 100% unless the deterministic gate confirms it after this cycle.

        Finish with a concise summary of actions and blockers. The controller will independently verify
        the filesystem, pushed head, validation commands, GitHub state, report, and deterministic gate.
        """
    ).strip()


def dependency_review_prompt(pr: dict[str, Any], root: Path, pub_refs: Path) -> str:
    number = int(pr["number"])
    return textwrap.dedent(
        f"""
        Perform a read-only quality review of Dependabot PR #{number} in {REPOSITORY}.
        Work from {root}; never checkout or execute the PR branch, never modify files, never commit,
        never push, and never merge. Inspect the PR metadata and diff with gh, the current repository
        source only as reference, and relevant official provider references under {pub_refs}.

        Review tests and coverage, error handling, documentation and changelog alignment, quality,
        maintainability, security, dependency impact, and provider compatibility. Use the exact request:
        "Please tell me what is left to be done here in relation to tests coverage, error handling,
        documentation alignment and other quality related stuff - you can correlate these stuff against
        also ~/pub-refs/ as well - once done, send a comment with full report of % and the stuff that
        still need to be done in this PR as a comment in the PR {number}"

        Update exactly one canonical report comment containing {REPORT_MARKER}. Do not claim 100% unless
        the deterministic gate confirms it. Finish with a concise read-only review summary.
        """
    ).strip()


def discovery_prompt(worktree: Path, pub_refs: Path) -> str:
    return textwrap.dedent(
        f"""
        You are the Switchboard daily discovery agent for {REPOSITORY}.
        Work only in {worktree}; never use the user checkout and never merge anything.
        Read AGENTS.md, CLAUDE.md, docs/maintenance-automation.md, maintenance/provider-repositories.json,
        and the current Git state before acting.

        Inspect the adapter registry and all supported providers, matching official repositories under
        {pub_refs}, source, tests, CI, dependencies, error handling, security, documentation, and changelog.
        Look for reproduced bugs, provider API drift, deprecations, endpoint/auth changes, and concrete
        test or documentation gaps. Prefer evidence-backed findings over speculative cleanup. Synchronize
        the matching official provider reference before acting on a provider-related finding.

        Search existing branches, issues, and PRs before creating anything. For each safe, deduplicated
        finding, make the smallest fix, add a regression test, update docs/changelog when required, run
        the applicable checks, and create or update one focused maintenance/switchboard-* PR. Use a draft
        when confidence is low or checks do not pass. Never modify an unrelated branch, never merge, and
        never send Telegram. If there is no concrete finding, make no code changes.

        Commit and push any focused change. Finish with a concise summary of findings, branch/PR URLs,
        tests, and blockers; the controller will verify the worktree and rediscover PRs afterward.
        """
    ).strip()


class ConvergenceController:
    """Orchestrate one bounded, verifiable convergence run."""

    def __init__(
        self,
        *,
        repository: str = REPOSITORY,
        root: Path,
        pub_refs: Path,
        state_path: Path | None = None,
        hermes: str = "/home/aidome-dev/.local/bin/hermes",
        runner: Runner = command_runner,
        max_cycles: int = MAX_CYCLES_PER_RUN,
        dry_run: bool = False,
        check_wait_seconds: int = CHECK_WAIT_SECONDS,
        sleep_fn: Callable[[float], None] = time.sleep,
    ) -> None:
        self.repository = repository
        self.root = root.resolve()
        self.pub_refs = pub_refs.resolve()
        self.state_path = (state_path or self.pub_refs / "switchboard-maintenance-state.json").resolve()
        self.hermes = hermes
        self.runner = runner
        self.max_cycles = max_cycles
        self.dry_run = dry_run
        self.check_wait_seconds = check_wait_seconds
        self.sleep_fn = sleep_fn
        self._node_bin_dir: Path | None = None
        self.run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
        self.state = load_state(self.state_path, self.repository)

    def node_bin_dir(self) -> Path:
        """Select a Node runtime compatible with the repository toolchain."""

        if self._node_bin_dir is not None:
            return self._node_bin_dir
        self._node_bin_dir = discover_supported_node_bin_dir()
        return self._node_bin_dir

    def run_command(self, *command: str, cwd: Path | None = None, timeout: int = COMMAND_TIMEOUT) -> CommandResult:
        effective = command
        if command and command[0] in {"node", "npm", "npx"}:
            node_dir = self.node_bin_dir()
            effective = ("env", f"PATH={node_dir}:{os.environ.get('PATH', '')}", *command)
        return self.runner(*effective, cwd=cwd, timeout=timeout)

    def pr_inventory(self) -> list[dict[str, Any]]:
        result = self.run_command(
            "python3",
            str(self.root / "maintenance/pr_scope.py"),
            "--repo",
            self.repository,
            cwd=self.root,
        )
        payload = parse_json_output(result, "PR inventory")
        pull_requests = payload.get("pullRequests") if isinstance(payload, dict) else None
        if not isinstance(pull_requests, list):
            raise ControllerError("PR inventory did not contain pullRequests")
        return pull_requests

    def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
        command = [
            "python3",
            str(self.root / "maintenance/sync_provider_refs.py"),
            "--json",
            "--pub-refs",
            str(self.pub_refs),
        ]
        if weekly:
            command.append("--weekly")
        if self.dry_run:
            command.append("--dry-run")
        result = self.run_command(*command, cwd=self.root, timeout=VALIDATION_TIMEOUT)
        return parse_json_output(result, "provider synchronization")

    def current_pr(self, number: int) -> dict[str, Any]:
        result = self.run_command(
            "gh",
            "pr",
            "view",
            str(number),
            "--repo",
            self.repository,
            "--json",
            "number,title,url,state,isDraft,mergeStateStatus,mergeable,reviewDecision,headRefName,headRefOid,headRepository,headRepositoryOwner,statusCheckRollup,comments",
        )
        payload = parse_json_output(result, f"PR #{number} inspection")
        if not isinstance(payload, dict):
            raise ControllerError(f"PR #{number} inspection returned an invalid object")
        return payload

    def gate(self, number: int) -> dict[str, Any]:
        result = self.run_command(
            "python3",
            str(self.root / "maintenance/review_pr.py"),
            "--pr",
            str(number),
            "--repo",
            self.repository,
            "--json",
            cwd=self.root,
        )
        if result.returncode not in {0, 1}:
            raise ControllerError(f"PR #{number} gate could not be evaluated: {short_output(result.output)}")
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ControllerError(
                f"PR #{number} gate returned invalid JSON: {short_output(result.output)}"
            ) from exc
        if not isinstance(payload, dict) or "eligible100" not in payload:
            raise ControllerError(f"PR #{number} gate returned an invalid payload")
        return payload

    def wait_for_gate(self, number: int) -> dict[str, Any]:
        """Wait for a visible, complete check set before acting on its result."""

        deadline = time.monotonic() + self.check_wait_seconds
        latest: dict[str, Any] | None = None
        while True:
            latest = self.gate(number)
            checks = latest.get("checks") or {}
            if "allCompleted" not in checks or checks.get("allCompleted"):
                return latest
            if time.monotonic() >= deadline:
                reasons = list(latest.get("reasons", []))
                reasons.append("GitHub checks remained pending or inaccessible after the bounded wait")
                latest["eligible100"] = False
                latest["reasons"] = reasons
                latest["checksTimedOut"] = True
                return latest
            self.sleep_fn(min(CHECK_POLL_SECONDS, max(0, deadline - time.monotonic())))

    def prepare_worktree(self, pr: dict[str, Any]) -> Path:
        number = int(pr["number"])
        branch = str(pr["headRefName"])
        if not re.fullmatch(r"(?:maintenance/switchboard-[A-Za-z0-9._/-]+|fix/[A-Za-z0-9._/-]+)", branch):
            raise ControllerError(f"PR #{number} has an unsafe branch name: {branch}")
        worktree = self.pub_refs / "switchboard-pr-worktrees" / f"pr-{number}"
        fetch_ref = f"+refs/heads/{branch}:refs/remotes/origin/{branch}"
        fetched = self.run_command("git", "-C", str(self.root), "fetch", "origin", fetch_ref, timeout=VALIDATION_TIMEOUT)
        if fetched.returncode:
            raise ControllerError(f"Could not fetch PR #{number}: {short_output(fetched.output)}")
        worktree.parent.mkdir(parents=True, exist_ok=True)
        self.run_command("git", "-C", str(self.root), "worktree", "prune")
        if not (worktree / ".git").exists():
            added = self.run_command(
                "git",
                "-C",
                str(self.root),
                "worktree",
                "add",
                "--detach",
                str(worktree),
                f"refs/remotes/origin/{branch}",
                timeout=VALIDATION_TIMEOUT,
            )
            if added.returncode:
                raise ControllerError(f"Could not create PR #{number} worktree: {short_output(added.output)}")
        status = self.run_command("git", "-C", str(worktree), "status", "--porcelain")
        if status.returncode or status.output:
            raise ControllerError(f"PR #{number} worktree is not clean")
        switched = self.run_command(
            "git",
            "-C",
            str(worktree),
            "switch",
            "--detach",
            f"refs/remotes/origin/{branch}",
            timeout=COMMAND_TIMEOUT,
        )
        if switched.returncode:
            raise ControllerError(f"Could not reset PR #{number} worktree: {short_output(switched.output)}")
        return worktree

    def prepare_discovery_worktree(self) -> Path:
        """Prepare a clean main-based worktree for repository-wide discovery."""

        worktree = self.pub_refs / "switchboard-discovery-worktree"
        fetched = self.run_command(
            "git",
            "-C",
            str(self.root),
            "fetch",
            "origin",
            "+refs/heads/main:refs/remotes/origin/main",
            timeout=VALIDATION_TIMEOUT,
        )
        if fetched.returncode:
            raise ControllerError(f"Could not fetch main for discovery: {short_output(fetched.output)}")
        worktree.parent.mkdir(parents=True, exist_ok=True)
        self.run_command("git", "-C", str(self.root), "worktree", "prune")
        if not (worktree / ".git").exists():
            added = self.run_command(
                "git",
                "-C",
                str(self.root),
                "worktree",
                "add",
                "--detach",
                str(worktree),
                "refs/remotes/origin/main",
                timeout=VALIDATION_TIMEOUT,
            )
            if added.returncode:
                raise ControllerError(f"Could not create discovery worktree: {short_output(added.output)}")
        status = self.run_command("git", "-C", str(worktree), "status", "--porcelain")
        if status.returncode or status.output:
            raise ControllerError("discovery worktree is dirty; refusing to run discovery")
        switched = self.run_command(
            "git",
            "-C",
            str(worktree),
            "switch",
            "--detach",
            "refs/remotes/origin/main",
            timeout=COMMAND_TIMEOUT,
        )
        if switched.returncode:
            raise ControllerError(f"Could not reset discovery worktree: {short_output(switched.output)}")
        return worktree

    def run_discovery(self) -> dict[str, Any]:
        if self.dry_run:
            return {"status": "planned"}
        worktree = self.prepare_discovery_worktree()
        result = self.run_command(
            self.hermes,
            "-z",
            discovery_prompt(worktree, self.pub_refs),
            cwd=worktree,
            timeout=AGENT_TIMEOUT,
        )
        if result.returncode:
            raise ControllerError(f"daily discovery failed: {short_output(result.output)}")
        status = self.run_command("git", "-C", str(worktree), "status", "--porcelain")
        if status.returncode or status.output:
            raise ControllerError("daily discovery left uncommitted changes in its worktree")
        branch_result = self.run_command("git", "-C", str(worktree), "symbolic-ref", "--short", "-q", "HEAD")
        branch = branch_result.output if branch_result.returncode == 0 else ""
        head = self.run_command("git", "-C", str(worktree), "rev-parse", "HEAD")
        base = self.run_command("git", "-C", str(worktree), "rev-parse", "refs/remotes/origin/main")
        if head.returncode or base.returncode:
            raise ControllerError("daily discovery could not verify its final head")
        changed = head.output != base.output
        if changed:
            if not branch.startswith("maintenance/switchboard-"):
                raise ControllerError(f"daily discovery changed to an unsafe branch: {branch or 'detached'}")
            remote = self.run_command("git", "-C", str(worktree), "ls-remote", "origin", f"refs/heads/{branch}")
            remote_head = remote.output.split()[0] if remote.output else ""
            if remote.returncode or remote_head != head.output:
                raise ControllerError("daily discovery changed code without a verified pushed branch")
        return {"status": "completed", "changed": changed, "branch": branch or None, "head": head.output}

    def ensure_dependencies(self, worktree: Path) -> dict[str, Any]:
        if (worktree / "node_modules/.bin/eslint").is_file():
            self.node_bin_dir()
            return {"status": "present"}
        self.node_bin_dir()
        result = self.run_command(
            "npm",
            "--prefix",
            str(worktree),
            "ci",
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            cwd=worktree,
            timeout=VALIDATION_TIMEOUT,
        )
        if result.returncode:
            raise ControllerError(f"npm ci failed: {short_output(result.output)}")
        return {"status": "installed"}

    def validate(self, worktree: Path) -> dict[str, Any]:
        results: list[dict[str, Any]] = []
        for command in VALIDATION_COMMANDS:
            result = self.run_command(*command, cwd=worktree, timeout=VALIDATION_TIMEOUT)
            results.append(
                {
                    "command": " ".join(command),
                    "returncode": result.returncode,
                    "passed": result.returncode == 0,
                    "timedOut": result.timed_out,
                    "output": short_output(result.output),
                }
            )
        return {"passed": bool(results) and all(item["passed"] for item in results), "commands": results}

    def push_evidence(self, pr: dict[str, Any], worktree: Path, head_before: str) -> dict[str, Any]:
        branch = str(pr["headRefName"])
        head_after_result = self.run_command("git", "-C", str(worktree), "rev-parse", "HEAD")
        if head_after_result.returncode:
            raise ControllerError(f"Could not read PR head after agent cycle: {short_output(head_after_result.output)}")
        head_after = head_after_result.output
        dirty = self.run_command("git", "-C", str(worktree), "status", "--porcelain")
        if dirty.returncode or dirty.output:
            raise ControllerError(f"PR #{pr['number']} has uncommitted changes after the agent cycle")
        remote = self.run_command("git", "-C", str(worktree), "ls-remote", "origin", f"refs/heads/{branch}")
        if remote.returncode:
            raise ControllerError(f"Could not verify pushed PR head: {short_output(remote.output)}")
        remote_head = remote.output.split()[0] if remote.output else ""
        if not remote_head or remote_head != head_after:
            raise ControllerError(
                f"PR #{pr['number']} push verification failed: local={head_after} remote={remote_head or 'missing'}"
            )
        return {
            "headBefore": head_before,
            "headAfter": head_after,
            "remoteHead": remote_head,
            "headChanged": head_before != head_after,
            "pushVerified": True,
        }

    def run_agent(self, pr: dict[str, Any], cycle: int, worktree: Path) -> dict[str, Any]:
        if self.dry_run:
            return {"status": "planned"}
        result = self.run_command(
            self.hermes,
            "-z",
            cycle_prompt(pr, cycle, worktree, self.pub_refs),
            cwd=worktree,
            timeout=AGENT_TIMEOUT,
        )
        if result.returncode:
            raise ControllerError(f"Hermes cycle failed: {short_output(result.output)}")
        return {"status": "completed"}

    def run_dependency_review(self, pr: dict[str, Any]) -> dict[str, Any]:
        if self.dry_run:
            return {"status": "planned"}
        clean_before = self.run_command("git", "-C", str(self.root), "status", "--porcelain")
        if clean_before.returncode or clean_before.output:
            raise ControllerError("base maintenance worktree is dirty; read-only Dependabot review refused")
        result = self.run_command(
            self.hermes,
            "-z",
            dependency_review_prompt(pr, self.root, self.pub_refs),
            cwd=self.root,
            timeout=AGENT_TIMEOUT,
        )
        if result.returncode:
            raise ControllerError(f"Dependabot review failed: {short_output(result.output)}")
        clean_after = self.run_command("git", "-C", str(self.root), "status", "--porcelain")
        if clean_after.returncode or clean_after.output:
            raise ControllerError("read-only Dependabot review modified the base worktree")
        return {"status": "completed"}

    def notify_once(self, kind: str, pr: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
        key = notification_key(kind, int(pr["number"]), head, detail)
        notifications = self.state.setdefault("notifications", {})
        if key in notifications:
            return {"sent": False, "deduplicated": True, "key": key}
        if self.dry_run:
            return {"sent": False, "planned": True, "key": key}
        self.pub_refs.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", prefix="switchboard-telegram-", suffix=".txt", dir=self.pub_refs, delete=False
            ) as message_file:
                message_file.write(message)
                temporary_path = Path(message_file.name)
            result: CommandResult | None = None
            for _attempt in range(NOTIFICATION_RETRIES):
                result = self.run_command(
                    self.hermes,
                    "send",
                    "--to",
                    TELEGRAM_TARGET,
                    "--file",
                    str(temporary_path),
                    timeout=COMMAND_TIMEOUT,
                )
                if result.returncode == 0:
                    break
            if result is None or result.returncode:
                raise ControllerError(
                    f"Telegram notification failed after {NOTIFICATION_RETRIES} attempts: "
                    f"{short_output(result.output if result else '')}"
                )
            notifications[key] = {"kind": kind, "pr": int(pr["number"]), "head": head, "sentAt": utc_now()}
            save_state(self.state_path, self.state)
            return {"sent": True, "key": key}
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def record_pr(self, pr: dict[str, Any], **values: Any) -> None:
        item = self.state.setdefault("prs", {}).setdefault(str(pr["number"]), {})
        item.update(values)
        if pr.get("headRefName") is not None:
            item["branch"] = pr.get("headRefName")
        if pr.get("mode") is not None:
            item["mode"] = pr.get("mode")
        item["updatedAt"] = utc_now()
        if not self.dry_run:
            save_state(self.state_path, self.state)

    def process_pr(self, pr: dict[str, Any]) -> dict[str, Any]:
        number = int(pr["number"])
        mode = str(pr.get("mode") or classify_branch(str(pr.get("headRefName", ""))) or "")
        if not trusted_head_repository(pr, self.repository):
            detail = "PR head repository is not the trusted product repository; code execution was skipped."
            self.record_pr(pr, status="blocked-untrusted-source", blocker=detail)
            self.notify_once(
                "untrusted-source",
                pr,
                str(pr.get("headRefOid", "unknown")),
                f"Switchboard maintenance blocked PR #{number}: {detail}\n{pr.get('url', '')}",
                detail,
            )
            return {"number": number, "status": "blocked-untrusted-source"}
        if mode == "dependency-review":
            review = self.run_dependency_review(pr)
            self.record_pr(pr, status="dependency-review", lastHead=pr.get("headRefOid"), readOnly=True, review=review)
            return {"number": number, "status": "dependency-review", "review": review}
        if mode != "full-fix":
            return {"number": number, "status": "out-of-scope"}

        last_gate: dict[str, Any] | None = None
        cycles: list[dict[str, Any]] = []
        previous_history = self.state.get("prs", {}).get(str(number), {}).get("cycleHistory", [])
        cycle_history: list[dict[str, Any]] = list(previous_history) if isinstance(previous_history, list) else []
        for cycle in range(1, self.max_cycles + 1):
            current = self.current_pr(number)
            head_before = str(current.get("headRefOid", ""))
            last_gate = self.wait_for_gate(number)
            self.record_pr(pr, status="in-progress", lastHead=head_before, lastGate=last_gate, cycle=cycle)
            if last_gate.get("checksTimedOut"):
                raise ControllerError(f"PR #{number} checks remained pending or inaccessible")
            if last_gate.get("eligible100"):
                final_worktree = self.prepare_worktree(current)
                final_dependencies = self.ensure_dependencies(final_worktree)
                final_validation = self.validate(final_worktree)
                final_push = self.push_evidence(current, final_worktree, head_before)
                refreshed = self.current_pr(number)
                refreshed_gate = self.wait_for_gate(number)
                if refreshed_gate.get("checksTimedOut"):
                    raise ControllerError(f"PR #{number} checks remained pending or inaccessible")
                if (
                    final_validation.get("passed")
                    and refreshed_gate.get("eligible100")
                    and str(refreshed.get("headRefOid", "")) == head_before
                ):
                    notification = self.notify_once(
                        "success",
                        refreshed,
                        head_before,
                        f"Switchboard maintenance PR #{number} is 100% complete.\n"
                        f"Review and merge manually: {refreshed.get('url', '')}\n"
                        f"Commit: {head_before}\nValidation: all controller checks passed.",
                        "verified-100",
                    )
                    self.record_pr(
                        refreshed,
                        status="eligible100",
                        lastHead=head_before,
                        notification=notification,
                        validation=final_validation,
                        dependencies=final_dependencies,
                        push=final_push,
                    )
                    return {"number": number, "status": "eligible100", "gate": refreshed_gate, "cycles": cycles}
                last_gate = dict(refreshed_gate)
                reasons = list(last_gate.get("reasons", []))
                if not final_validation.get("passed"):
                    reasons.append("controller validation did not pass")
                if str(refreshed.get("headRefOid", "")) != head_before:
                    reasons.append("PR head changed during final verification")
                last_gate["eligible100"] = False
                last_gate["reasons"] = reasons

            worktree = self.prepare_worktree(current)
            dependencies = self.ensure_dependencies(worktree)
            agent = self.run_agent(current, cycle, worktree)
            if self.dry_run:
                cycle_record = {"cycle": cycle, "headBefore": head_before, "agent": agent, "status": "planned"}
                cycles.append(cycle_record)
                self.record_pr(current, status="planned", cycles=cycles)
                continue
            push = self.push_evidence(current, worktree, head_before)
            validation = self.validate(worktree)
            refreshed = self.current_pr(number)
            refreshed_gate = self.wait_for_gate(number)
            if refreshed_gate.get("checksTimedOut"):
                raise ControllerError(f"PR #{number} checks remained pending or inaccessible")
            controller_eligible = bool(validation.get("passed")) and bool(refreshed_gate.get("eligible100"))
            effective_gate = dict(refreshed_gate)
            if not validation.get("passed"):
                effective_gate["eligible100"] = False
                effective_gate["reasons"] = list(effective_gate.get("reasons", [])) + [
                    "controller validation did not pass"
                ]
            cycle_record = {
                "runId": self.run_id,
                "cycle": cycle,
                "headBefore": head_before,
                "agent": agent,
                "dependencies": dependencies,
                "push": push,
                "validation": validation,
                "headAfter": refreshed.get("headRefOid"),
                "gate": effective_gate,
                "status": "eligible100" if controller_eligible else "blocked",
            }
            cycles.append(cycle_record)
            cycle_history.append(cycle_record)
            last_gate = effective_gate
            self.record_pr(
                refreshed,
                status=cycle_record["status"],
                lastHead=str(refreshed.get("headRefOid", "")),
                cycles=cycles,
                cycleHistory=cycle_history[-30:],
                lastGate=effective_gate,
            )
            if controller_eligible:
                notification = self.notify_once(
                    "success",
                    refreshed,
                    str(refreshed.get("headRefOid", "")),
                    f"Switchboard maintenance PR #{number} is 100% complete.\n"
                    f"Review and merge manually: {refreshed.get('url', '')}\n"
                    f"Commit: {refreshed.get('headRefOid', '')}\n"
                    f"Validation: all controller checks passed.",
                    "verified-100",
                )
                self.record_pr(
                    refreshed,
                    status="eligible100",
                    lastHead=str(refreshed.get("headRefOid", "")),
                    notification=notification,
                    cycles=cycles,
                    cycleHistory=cycle_history[-30:],
                )
                return {"number": number, "status": "eligible100", "gate": refreshed_gate, "cycles": cycles}

        current = self.current_pr(number)
        blocker = json.dumps((last_gate or {}).get("reasons", []), ensure_ascii=True)
        notification = self.notify_once(
            "blocked",
            current,
            str(current.get("headRefOid", "unknown")),
            f"Switchboard maintenance PR #{number} did not reach 100% after {self.max_cycles} verified cycles.\n"
            f"Review required: {current.get('url', '')}\nRemaining gate blockers: {blocker}",
            blocker,
        )
        self.record_pr(
            current,
            status="blocked",
            lastHead=str(current.get("headRefOid", "")),
            blocker=blocker,
            notification=notification,
            cycles=cycles,
            cycleHistory=cycle_history[-30:],
        )
        return {"number": number, "status": "blocked", "gate": last_gate, "cycles": cycles}

    def reconcile_pr(self, pr: dict[str, Any]) -> dict[str, Any]:
        """Refresh durable state from GitHub without invoking an agent or mutating a branch."""

        current = self.current_pr(int(pr["number"]))
        gate = self.wait_for_gate(int(pr["number"]))
        self.record_pr(
            current,
            status="reconciled",
            lastHead=str(current.get("headRefOid", "")),
            lastGate=gate,
            reconcileOnly=True,
        )
        return {"number": int(pr["number"]), "status": "reconciled", "head": current.get("headRefOid"), "gate": gate}

    def run(
        self,
        *,
        weekly: bool = False,
        only_pr: int | None = None,
        reconcile_only: bool = False,
    ) -> dict[str, Any]:
        started = utc_now()
        run_record: dict[str, Any] = {"runId": self.run_id, "startedAt": started, "weekly": weekly, "status": "running"}
        self.state.setdefault("runs", []).append(run_record)
        if not self.dry_run:
            save_state(self.state_path, self.state)
        results: list[dict[str, Any]] = []
        try:
            provider_sync = self.sync_provider_refs(weekly)
            if self.dry_run:
                discovery = {"status": "planned"}
            elif only_pr is not None or reconcile_only:
                discovery = {"status": "skipped-controlled-mode"}
            else:
                discovery = self.run_discovery()
            inventory = self.pr_inventory()
            if only_pr is not None:
                inventory = [pr for pr in inventory if int(pr["number"]) == only_pr]
                if not inventory:
                    raise ControllerError(f"PR #{only_pr} was not returned by the in-scope PR inventory")
            if self.dry_run:
                results = [{"number": int(pr["number"]), "status": "planned", "mode": pr.get("mode")} for pr in inventory]
            elif reconcile_only:
                results = [self.reconcile_pr(pr) for pr in inventory]
            else:
                for pr in inventory:
                    try:
                        results.append(self.process_pr(pr))
                    except ControllerError as exc:
                        detail = str(exc)
                        current = pr
                        try:
                            current = self.current_pr(int(pr["number"]))
                        except ControllerError:
                            pass
                        notification: dict[str, Any] | None = None
                        try:
                            notification = self.notify_once(
                                "pr-failure",
                                current,
                                str(current.get("headRefOid", pr.get("headRefOid", "unknown"))),
                                f"Switchboard maintenance PR #{pr['number']} failed and requires attention.\n"
                                f"{current.get('url', pr.get('url', ''))}\n{detail}",
                                detail,
                            )
                        except ControllerError as notification_error:
                            detail = f"{detail}; notification failed: {notification_error}"
                        self.record_pr(current, status="failed", blocker=detail, notification=notification)
                        results.append({"number": int(pr["number"]), "status": "failed", "error": detail})
            run_record.update(
                {
                    "status": "completed-with-alert"
                    if any(item.get("status") in {"blocked", "blocked-untrusted-source", "failed"} for item in results)
                    else "completed",
                    "finishedAt": utc_now(),
                    "providerSync": {"ok": bool(provider_sync.get("ok", False)), "weekly": weekly},
                    "discovery": discovery,
                    "results": results,
                }
            )
        except Exception as exc:  # noqa: BLE001 - controller must persist and alert every failure.
            detail = str(exc)
            run_record.update({"status": "failed", "finishedAt": utc_now(), "error": detail})
            synthetic_pr = {
                "number": 0,
                "headRefOid": self.run_id,
                "url": f"https://github.com/{self.repository}/pulls",
            }
            try:
                self.notify_once(
                    "run-failure",
                    synthetic_pr,
                    self.run_id,
                    f"Switchboard maintenance run failed and requires attention.\n{detail}",
                    detail,
                )
            except ControllerError as notification_error:
                run_record["notificationError"] = str(notification_error)
            if not self.dry_run:
                save_state(self.state_path, self.state)
            raise
        finally:
            run_record["finishedAt"] = run_record.get("finishedAt", utc_now())
            if not self.dry_run:
                save_state(self.state_path, self.state)
        return {"runId": self.run_id, "status": run_record["status"], "results": results}


class MaintenanceLock:
    """Non-blocking process lock for the complete controller run."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.handle: Any = None

    def __enter__(self) -> "MaintenanceLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            self.handle.close()
            raise ControllerError(f"maintenance lock is already held: {self.path}") from exc
        return self

    def __exit__(self, _type: Any, _value: Any, _traceback: Any) -> None:
        if self.handle is not None:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
            self.handle.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=REPOSITORY)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--pub-refs", type=Path, default=Path("/home/aidome-dev/pub-refs"))
    parser.add_argument("--state", type=Path, default=None)
    parser.add_argument("--hermes", default=os.environ.get("HERMES_BIN", "/home/aidome-dev/.local/bin/hermes"))
    parser.add_argument("--weekly", action="store_true")
    parser.add_argument("--auto-weekly", action="store_true", help="Use Sunday in Asia/Jerusalem for weekly synchronization.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--max-cycles", type=int, default=MAX_CYCLES_PER_RUN)
    parser.add_argument("--pr", type=int, default=None, help="Process one in-scope PR; intended for controlled validation.")
    parser.add_argument("--reconcile-only", action="store_true", help="Refresh state from GitHub without invoking an agent.")
    args = parser.parse_args()
    if not 1 <= args.max_cycles <= MAX_CYCLES_PER_RUN:
        parser.error(f"--max-cycles must be between 1 and {MAX_CYCLES_PER_RUN}")
    pub_refs = args.pub_refs.resolve()
    state = args.state.resolve() if args.state else pub_refs / "switchboard-maintenance-state.json"
    lock = pub_refs / ".switchboard-maintenance.lock"
    try:
        weekly = args.weekly or (args.auto_weekly and datetime.now(ZoneInfo(TIMEZONE_NAME)).weekday() == 6)
        controller = ConvergenceController(
            repository=args.repo,
            root=args.root,
            pub_refs=pub_refs,
            state_path=state,
            hermes=args.hermes,
            max_cycles=args.max_cycles,
            dry_run=args.dry_run,
        )
        if args.dry_run:
            result = controller.run(weekly=weekly, only_pr=args.pr, reconcile_only=args.reconcile_only)
        else:
            with MaintenanceLock(lock):
                result = controller.run(weekly=weekly, only_pr=args.pr, reconcile_only=args.reconcile_only)
        print(json.dumps(result, indent=2))
        return 0
    except ControllerError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
