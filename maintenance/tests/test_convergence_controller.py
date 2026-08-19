from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable

from maintenance.convergence_controller import (
    CommandResult,
    ConvergenceController,
    ControllerError,
    trusted_head_repository,
)
from maintenance.review_pr import missing_report_sections


def pr(number: int = 123, head: str = "a" * 40, branch: str = "fix/example") -> dict[str, Any]:
    return {
        "number": number,
        "title": "fix: example",
        "url": f"https://github.com/AIdome-co/aidome-endpoint-switchboard-vscode/pull/{number}",
        "headRefName": branch,
        "headRefOid": head,
        "headRepository": {"name": "aidome-endpoint-switchboard-vscode"},
        "headRepositoryOwner": {"login": "AIdome-co"},
        "mode": "full-fix",
    }


class FakeController(ConvergenceController):
    def __init__(self, *args: Any, gate_values: list[bool], **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.gate_values = iter(gate_values)
        self.gate_calls = 0
        self.push_calls = 0
        self.agent_calls = 0
        self.notifications: list[str] = []

    def current_pr(self, number: int) -> dict[str, Any]:
        return pr(number)

    def gate(self, number: int) -> dict[str, Any]:
        self.gate_calls += 1
        eligible = next(self.gate_values)
        return {"eligible100": eligible, "reasons": [] if eligible else ["remaining blocker"]}

    def prepare_worktree(self, current: dict[str, Any]) -> Path:
        worktree = self.pub_refs / "fake-worktree"
        worktree.mkdir(parents=True, exist_ok=True)
        return worktree

    def ensure_dependencies(self, worktree: Path) -> dict[str, Any]:
        return {"status": "present"}

    def run_agent(self, current: dict[str, Any], cycle: int, worktree: Path) -> dict[str, Any]:
        self.agent_calls += 1
        return {"status": "completed"}

    def push_evidence(self, current: dict[str, Any], worktree: Path, head_before: str) -> dict[str, Any]:
        self.push_calls += 1
        return {"headBefore": head_before, "headAfter": head_before, "remoteHead": head_before, "pushVerified": True}

    def validate(self, worktree: Path) -> dict[str, Any]:
        return {"passed": True, "commands": []}

    def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
        self.notifications.append(kind)
        return {"sent": True, "key": f"{kind}:{current['number']}"}


class ConvergenceControllerTests(unittest.TestCase):
    def test_success_rechecks_gate_after_agent_cycle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = FakeController(root=root, pub_refs=root / "pub", state_path=root / "state.json", gate_values=[False, True])

            result = controller.process_pr(pr())

            self.assertEqual(result["status"], "eligible100")
            self.assertEqual(controller.gate_calls, 2)
            self.assertEqual(controller.agent_calls, 1)
            self.assertEqual(controller.push_calls, 1)
            self.assertEqual(controller.notifications, ["success"])

    def test_existing_gate_still_requires_controller_validation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = FakeController(root=root, pub_refs=root / "pub", state_path=root / "state.json", gate_values=[True, True])

            result = controller.process_pr(pr())

            self.assertEqual(result["status"], "eligible100")
            self.assertEqual(controller.agent_calls, 0)
            self.assertEqual(controller.push_calls, 1)

    def test_three_cycles_stop_and_record_blocker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = FakeController(
                root=root,
                pub_refs=root / "pub",
                state_path=root / "state.json",
                gate_values=[False, False, False, False, False, False],
                max_cycles=3,
            )

            result = controller.process_pr(pr())

            self.assertEqual(result["status"], "blocked")
            self.assertEqual(len(result["cycles"]), 3)
            self.assertEqual(controller.agent_calls, 3)
            self.assertEqual(controller.notifications, ["blocked"])

    def test_cycle_history_survives_the_next_scheduled_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            first = FakeController(
                root=root,
                pub_refs=root / "pub",
                state_path=state_path,
                gate_values=[False, False, False, False, False, False],
                max_cycles=3,
            )
            first.process_pr(pr())

            second = FakeController(
                root=root,
                pub_refs=root / "pub",
                state_path=state_path,
                gate_values=[False, True],
                max_cycles=3,
            )
            result = second.process_pr(pr())

            self.assertEqual(result["status"], "eligible100")
            self.assertEqual(len(second.state["prs"]["123"]["cycleHistory"]), 4)

    def test_untrusted_pr_is_not_executed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = FakeController(root=root, pub_refs=root / "pub", state_path=root / "state.json", gate_values=[])
            foreign = pr()
            foreign["headRepositoryOwner"] = {"login": "attacker"}

            result = controller.process_pr(foreign)

            self.assertEqual(result["status"], "blocked-untrusted-source")
            self.assertEqual(controller.agent_calls, 0)
            self.assertEqual(controller.push_calls, 0)

    def test_push_evidence_rejects_stale_remote_head(self) -> None:
        calls: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            calls.append(command)
            if "rev-parse" in command:
                return CommandResult(0, "local-head\n")
            if "ls-remote" in command:
                return CommandResult(0, "remote-head\trefs/heads/fix/example\n")
            return CommandResult(0, "")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(root=root, pub_refs=root / "pub", runner=runner)
            with self.assertRaises(ControllerError):
                controller.push_evidence(pr(head="old-head"), root, "old-head")
        self.assertTrue(any("ls-remote" in call for call in calls))

    def test_pending_checks_time_out_before_agent_execution(self) -> None:
        class PendingController(FakeController):
            def gate(self, number: int) -> dict[str, Any]:
                self.gate_calls += 1
                return {"eligible100": False, "reasons": ["checks pending"], "checks": {"allCompleted": False}}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = PendingController(
                root=root,
                pub_refs=root / "pub",
                state_path=root / "state.json",
                gate_values=[],
                check_wait_seconds=0,
            )

            with self.assertRaises(ControllerError):
                controller.process_pr(pr())

            self.assertEqual(controller.agent_calls, 0)

    def test_notification_is_idempotent(self) -> None:
        sends = 0

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            nonlocal sends
            if len(command) >= 2 and command[1] == "send":
                sends += 1
            return CommandResult(0, "sent\n")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = ConvergenceController(root=root, pub_refs=root / "pub", state_path=state_path, runner=runner)
            first = controller.notify_once("success", pr(), "head", "message", "verified-100")
            second = controller.notify_once("success", pr(), "head", "message", "verified-100")

            self.assertTrue(first["sent"])
            self.assertTrue(second["deduplicated"])
            self.assertEqual(sends, 1)
            self.assertTrue(state_path.is_file())

    def test_notification_failure_retries_and_fails_closed(self) -> None:
        sends = 0

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            nonlocal sends
            if len(command) >= 2 and command[1] == "send":
                sends += 1
                return CommandResult(1, "", "telegram unavailable")
            return CommandResult(0, "")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(root=root, pub_refs=root / "pub", runner=runner)
            with self.assertRaises(ControllerError):
                controller.notify_once("blocked", pr(), "head", "message", "blocked")

        self.assertEqual(sends, 3)

    def test_dry_run_does_not_write_state(self) -> None:
        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            command_text = " ".join(command)
            if "sync_provider_refs.py" in command_text:
                return CommandResult(0, json.dumps({"ok": True, "dryRun": True}))
            if "pr_scope.py" in command_text:
                return CommandResult(0, json.dumps({"pullRequests": [pr()]}))
            raise AssertionError(f"unexpected command: {command_text}")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = ConvergenceController(
                root=root,
                pub_refs=root / "pub",
                state_path=state_path,
                runner=runner,
                dry_run=True,
            )

            result = controller.run()

            self.assertEqual(result["status"], "completed")
            self.assertFalse(state_path.exists())

    def test_report_requires_all_quality_sections(self) -> None:
        missing = missing_report_sections("Tests coverage\nError handling\nRemaining work: none")
        self.assertIn("documentation alignment", missing)
        self.assertIn("provider correlation", missing)
        self.assertNotIn("tests coverage", missing)

    def test_run_continues_after_one_pr_fails(self) -> None:
        class RunController(ConvergenceController):
            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return [pr(1), pr(2)]

            def process_pr(self, item: dict[str, Any]) -> dict[str, Any]:
                if item["number"] == 1:
                    raise ControllerError("simulated PR failure")
                self.record_pr(item, status="eligible100")
                return {"number": 2, "status": "eligible100"}

            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def notify_once(self, kind: str, item: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True, "key": kind}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = RunController(root=root, pub_refs=root / "pub", state_path=root / "state.json")

            result = controller.run()

            self.assertEqual(result["status"], "completed-with-alert")
            self.assertEqual([item["number"] for item in result["results"]], [1, 2])
            self.assertEqual(controller.state["prs"]["1"]["status"], "failed")
            self.assertEqual(controller.state["prs"]["2"]["status"], "eligible100")


if __name__ == "__main__":
    unittest.main()
