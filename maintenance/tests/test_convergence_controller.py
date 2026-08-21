from __future__ import annotations

import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from typing import Any, Callable

from maintenance.convergence_controller import (
    CommandResult,
    ConvergenceController,
    ControllerError,
    RunBudgetExceeded,
    VALIDATION_COMMANDS,
    exit_code_for_run_status,
    load_state,
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
    def test_legacy_list_state_is_migrated_to_keyed_pr_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            state_path = Path(directory) / "state.json"
            state_path.write_text(json.dumps({"prs": [{"pr": "123", "status": "blocked"}]}), encoding="utf-8")

            state = load_state(state_path)

            self.assertEqual(state["prs"]["123"]["status"], "blocked")

    def test_run_budget_stops_before_the_scheduler_deadline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(root=root, pub_refs=root / "pub", run_budget_seconds=11)
            controller.start_run_budget()
            controller._run_deadline = time.monotonic() - 1

            with self.assertRaises(RunBudgetExceeded):
                controller.run_command("git", "status")

    def test_budget_pause_is_persisted_for_the_next_run(self) -> None:
        class PausingController(ConvergenceController):
            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return [pr()]

            def process_pr(self, item: dict[str, Any]) -> dict[str, Any]:
                raise RunBudgetExceeded("simulated scheduler budget exhaustion")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = PausingController(root=root, pub_refs=root / "pub", state_path=state_path)

            result = controller.run()
            persisted = json.loads(state_path.read_text(encoding="utf-8"))

            self.assertEqual(result["status"], "paused-budget")
            self.assertEqual(persisted["lastRun"]["status"], "paused-budget")
            self.assertTrue(persisted["lastRun"]["resumesOnNextRun"])

    def test_inventory_cursor_rotates_after_last_completed_pr(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(root=root, pub_refs=root / "pub")
            controller.state["scheduler"] = {"lastProcessedPr": 1}

            rotated = controller.rotate_inventory([pr(1), pr(2), pr(3)])

            self.assertEqual([item["number"] for item in rotated], [2, 3, 1])

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
            self.assertEqual(controller.state["prs"]["123"]["lastHead"], "a" * 40)

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

    def test_non_100_gate_exit_one_is_a_normal_gate_result(self) -> None:
        payload = {"eligible100": False, "reasons": ["draft"], "checks": {"allCompleted": True}}

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            if "review_pr.py" in " ".join(command):
                return CommandResult(1, json.dumps(payload))
            raise AssertionError(f"unexpected command: {command}")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(root=root, pub_refs=root / "pub", runner=runner)
            result = controller.gate(123)

        self.assertFalse(result["eligible100"])
        self.assertEqual(result["reasons"], ["draft"])

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

    def test_run_continues_after_one_pr_fails_and_defers_discovery(self) -> None:
        class RunController(ConvergenceController):
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)
                self.discovery_calls = 0

            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return [pr(1), pr(2)]

            def run_discovery(self) -> dict[str, Any]:
                self.discovery_calls += 1
                return {"status": "completed", "changed": False}

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
            state_path = root / "state.json"
            controller = RunController(root=root, pub_refs=root / "pub", state_path=state_path)

            result = controller.run()

            self.assertEqual(result["status"], "discovery-deferred")
            self.assertEqual([item["number"] for item in result["results"]], [1, 2])
            self.assertEqual(controller.state["prs"]["1"]["status"], "failed")
            self.assertEqual(controller.state["prs"]["2"]["status"], "eligible100")
            # Unfinished PR work defers discovery instead of letting it starve the PR.
            self.assertEqual(controller.discovery_calls, 0)
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["lastRun"]["discovery"]["status"], "discovery-deferred")
            self.assertEqual(persisted["runs"][-1]["discovery"]["reason"], "unfinished-pr-work-waiting")

    def test_reconcile_only_refreshes_head_without_agent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = FakeController(root=root, pub_refs=root / "pub", state_path=root / "state.json", gate_values=[False])

            result = controller.reconcile_pr(pr())

            self.assertEqual(result["status"], "reconciled")
            self.assertEqual(controller.state["prs"]["123"]["lastHead"], "a" * 40)
            self.assertEqual(controller.agent_calls, 0)

class DiscoveryPriorityTests(unittest.TestCase):
    def test_existing_pr_converges_before_discovery(self) -> None:
        class OrderedController(ConvergenceController):
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                super().__init__(*args, **kwargs)
                self.order: list[str] = []

            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                self.order.append("sync")
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                self.order.append("inventory")
                return [pr()]

            def process_pr(self, item: dict[str, Any]) -> dict[str, Any]:
                self.order.append(f"process:{item['number']}")
                self.record_pr(item, status="eligible100")
                return {"number": item["number"], "status": "eligible100"}

            def run_discovery(self) -> dict[str, Any]:
                self.order.append("discovery")
                return {"status": "completed", "changed": False}

            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True, "key": kind}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = OrderedController(root=root, pub_refs=root / "pub", state_path=state_path)

            result = controller.run()

            self.assertEqual(result["status"], "completed")
            self.assertEqual(controller.order, ["sync", "inventory", "process:123", "discovery"])
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["lastDiscoveryLocalDate"], controller.local_date())

    def test_discovery_skipped_when_budget_insufficient(self) -> None:
        class LowBudgetController(ConvergenceController):
            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return [pr()]

            def process_pr(self, item: dict[str, Any]) -> dict[str, Any]:
                self.record_pr(item, status="eligible100")
                return {"number": item["number"], "status": "eligible100"}

            def run_discovery(self) -> dict[str, Any]:
                raise AssertionError("discovery must not run when the budget is insufficient")

            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True, "key": kind}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = LowBudgetController(
                root=root,
                pub_refs=root / "pub",
                state_path=state_path,
                discovery_min_budget_seconds=10_000_000,
            )

            result = controller.run()

            # Priority PR work converged (all eligible100); discovery was merely
            # deferred for a budget edge, so the run is a successful completion.
            self.assertEqual(result["status"], "completed")
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["lastRun"]["discovery"]["status"], "discovery-deferred")
            self.assertEqual(persisted["runs"][-1]["discovery"]["reason"], "insufficient-budget")

    def test_budget_edge_deferral_with_no_pending_pr_work_is_completed(self) -> None:
        # When PR convergence fully finishes and discovery is deferred only for a
        # budget edge (no actionable PR work waiting), the run must NOT be flagged
        # as an incomplete/non-zero run. Discovery stays due for the next run.
        class LowBudgetNoPrController(ConvergenceController):
            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return []

            def run_discovery(self) -> dict[str, Any]:
                raise AssertionError("discovery must not run when the budget is insufficient")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = LowBudgetNoPrController(
                root=root,
                pub_refs=root / "pub",
                state_path=state_path,
                discovery_min_budget_seconds=10_000_000,
            )

            result = controller.run()

            self.assertEqual(result["status"], "completed")
            self.assertEqual(exit_code_for_run_status(result["status"]), 0)
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["lastRun"]["discovery"]["status"], "discovery-deferred")
            self.assertEqual(persisted["runs"][-1]["discovery"]["reason"], "insufficient-budget")
            # Discovery was not run and remains due for a future run.
            self.assertNotIn("lastDiscoveryLocalDate", persisted)

    def test_discovery_cannot_starve_an_existing_pr(self) -> None:
        class BlockedPrController(ConvergenceController):
            def sync_provider_refs(self, weekly: bool) -> dict[str, Any]:
                return {"ok": True}

            def pr_inventory(self) -> list[dict[str, Any]]:
                return [pr()]

            def process_pr(self, item: dict[str, Any]) -> dict[str, Any]:
                return {"number": item["number"], "status": "blocked"}

            def run_discovery(self) -> dict[str, Any]:
                raise AssertionError("discovery must not run when unfinished PR work is waiting")

            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True, "key": kind}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state_path = root / "state.json"
            controller = BlockedPrController(root=root, pub_refs=root / "pub", state_path=state_path)

            result = controller.run()

            self.assertEqual(result["status"], "discovery-deferred")
            persisted = json.loads(state_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["lastRun"]["discovery"]["status"], "discovery-deferred")
            self.assertEqual(persisted["runs"][-1]["discovery"]["reason"], "unfinished-pr-work-waiting")

    def test_paused_and_deferred_runs_return_nonzero_exit_codes(self) -> None:
        self.assertEqual(exit_code_for_run_status("completed"), 0)
        self.assertEqual(exit_code_for_run_status("completed-with-alert"), 0)
        self.assertEqual(exit_code_for_run_status("paused-budget"), 2)
        self.assertEqual(exit_code_for_run_status("discovery-deferred"), 3)

    def test_discovery_pins_the_configured_model(self) -> None:
        calls: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            calls.append(command)
            text = " ".join(command)
            if command and Path(command[0]).name == "hermes":
                return CommandResult(0, "")
            if "status --porcelain" in text:
                return CommandResult(0, "")
            if "symbolic-ref" in text:
                return CommandResult(1, "")
            if "rev-parse" in text:
                return CommandResult(0, "abc123")
            return CommandResult(0, "")

        class DiscoveryRunnerController(ConvergenceController):
            def prepare_discovery_worktree(self) -> Path:
                worktree = self.pub_refs / "discovery-wt"
                worktree.mkdir(parents=True, exist_ok=True)
                return worktree

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = DiscoveryRunnerController(
                root=root,
                pub_refs=root / "pub",
                hermes_model="deepseek/deepseek-v4-flash-0731",
                runner=runner,
            )
            controller.run_discovery()

        hermes_calls = [call for call in calls if call and Path(call[0]).name == "hermes"]
        self.assertEqual(len(hermes_calls), 1)
        self.assertEqual(
            hermes_calls[0][0:6],
            (
                "/home/aidome-dev/.local/bin/hermes",
                "-m",
                "deepseek/deepseek-v4-flash-0731",
                "--accept-hooks",
                "-z",
                hermes_calls[0][5],
            ),
        )


class ValidationCommandTests(unittest.TestCase):
    def test_e2e_is_wrapped_in_xvfb_on_headless_host(self) -> None:
        # On a headless host (no DISPLAY), the E2E validation step launches a real
        # VS Code window and must run under a virtual framebuffer, otherwise it
        # SIGSEGVs with "Missing X server" and the controller can never certify 100%.
        seen: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            seen.append(command)
            return CommandResult(0, "")

        controller = ConvergenceController(root=Path("/tmp/x"), pub_refs=Path("/tmp/p"), runner=runner)
        old_display = os.environ.get("DISPLAY")
        os.environ.pop("DISPLAY", None)
        try:
            controller.validate(Path("/tmp/wt"))
        finally:
            if old_display is None:
                os.environ.pop("DISPLAY", None)
            else:
                os.environ["DISPLAY"] = old_display

        e2e = next(c for c in seen if "test:e2e" in " ".join(c))
        self.assertTrue(e2e[:2] == ("xvfb-run", "-a"), f"expected xvfb wrapper, got {e2e}")

    def test_e2e_does_not_xvfb_when_display_present(self) -> None:
        seen: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            seen.append(command)
            return CommandResult(0, "")

        controller = ConvergenceController(root=Path("/tmp/x"), pub_refs=Path("/tmp/p"), runner=runner)
        old_display = os.environ.get("DISPLAY")
        os.environ["DISPLAY"] = ":99"
        try:
            controller.validate(Path("/tmp/wt"))
        finally:
            if old_display is None:
                os.environ.pop("DISPLAY", None)
            else:
                os.environ["DISPLAY"] = old_display

        e2e = next(c for c in seen if "test:e2e" in " ".join(c))
        self.assertNotIn("xvfb-run", e2e, f"expected plain npm run test:e2e, got {e2e}")
        self.assertEqual(e2e[-1], "test:e2e")


class TransientGateTests(unittest.TestCase):
    def test_transient_gate_is_flagged_for_retry(self) -> None:
        controller = ConvergenceController(root=Path("/tmp/x"), pub_refs=Path("/tmp/p"))
        self.assertTrue(
            controller._is_transient_gate({"pr": {"mergeStateStatus": "UNKNOWN"}}),
            "UNKNOWN mergeStateStatus must be treated as transient",
        )
        self.assertTrue(
            controller._is_transient_gate({"pr": {"mergeable": "UNKNOWN"}}),
            "UNKNOWN mergeable must be treated as transient",
        )
        self.assertTrue(
            controller._is_transient_gate({"message": "Secondary rate limit"}),
            "rate-limit message must be treated as transient",
        )
        self.assertFalse(
            controller._is_transient_gate({"pr": {"mergeStateStatus": "CLEAN", "mergeable": "MERGEABLE"}, "message": ""}),
            "a stable CLEAN gate must NOT be transient",
        )

    def test_wait_for_gate_retries_transient_unknown_then_resolves(self) -> None:
        seen: list[dict[str, Any]] = []

        class RetryController(ConvergenceController):
            def gate(self, number: int) -> dict[str, Any]:
                seen.append(dict(number=number))
                state = seen[-1]
                # First call: unknown merge state; second: checks complete.
                if len(seen) == 1:
                    return {"eligible100": False, "pr": {"mergeStateStatus": "UNKNOWN"}, "checks": {"allCompleted": False}}
                return {
                    "eligible100": True,
                    "pr": {"mergeStateStatus": "CLEAN", "mergeable": "MERGEABLE"},
                    "checks": {"allCompleted": True},
                }

        controller = RetryController(
            root=Path("/tmp/x"),
            pub_refs=Path("/tmp/p"),
            sleep_fn=lambda _: None,  # no real sleeping in the test
            check_wait_seconds=10,
        )
        result = controller.wait_for_gate(5)
        self.assertEqual(result["eligible100"], True)
        self.assertEqual(len(seen), 2, "should have retried the transient UNKNOWN gate once")


class AutoUnDraftTests(unittest.TestCase):
    def _make_controller(self, runner, **kwargs: Any) -> ConvergenceController:
        return ConvergenceController(root=Path("/tmp/x"), pub_refs=Path("/tmp/p"), runner=runner, **kwargs)

    def test_auto_un_draft_is_disabled_by_default(self) -> None:
        # Must not run `gh pr ready` unless explicitly enabled.
        executed: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            executed.append(command)
            return CommandResult(0, "")

        class NoCurrent(ConvergenceController):
            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def gate(self, number: int) -> dict[str, Any]:
                return {"eligible100": False, "checks": None, "reasons": ["blocked"]}

            def prepare_worktree(self, current: dict[str, Any]) -> Path:
                wt = self.pub_refs / "wt"
                wt.mkdir(parents=True, exist_ok=True)
                return wt

            def ensure_dependencies(self, worktree: Path) -> dict[str, Any]:
                return {"status": "present"}

            def run_agent(self, current: dict[str, Any], cycle: int, worktree: Path) -> dict[str, Any]:
                return {"status": "completed"}

            def push_evidence(self, current: dict[str, Any], worktree: Path, head_before: str) -> dict[str, Any]:
                return {"pushVerified": True}

            def validate(self, worktree: Path) -> dict[str, Any]:
                return {"passed": True, "commands": []}

            def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            c = NoCurrent(root=root, pub_refs=root / "pub", state_path=root / "state.json", runner=runner)
            draft = pr()
            draft["isDraft"] = True
            c.process_pr(draft)  # auto_un_draft defaults to False
        gh_calls = [x for x in executed if x and Path(x[0]).name == "gh"]
        self.assertEqual(gh_calls, [], f"gh pr ready should NOT run by default, got {gh_calls}")

    def test_auto_un_draft_runs_ready_on_clean_draft_when_enabled(self) -> None:
        executed: list[tuple[str, ...]] = []

        def runner(*command: str, cwd: Path | None = None, timeout: int = 0) -> CommandResult:
            executed.append(command)
            return CommandResult(0, "")

        class NoCurrent(ConvergenceController):
            def current_pr(self, number: int) -> dict[str, Any]:
                return pr(number)

            def gate(self, number: int) -> dict[str, Any]:
                return {"eligible100": False, "checks": None, "reasons": ["draft"]}

            def prepare_worktree(self, current: dict[str, Any]) -> Path:
                wt = self.pub_refs / "wt"
                wt.mkdir(parents=True, exist_ok=True)
                return wt

            def ensure_dependencies(self, worktree: Path) -> dict[str, Any]:
                return {"status": "present"}

            def run_agent(self, current: dict[str, Any], cycle: int, worktree: Path) -> dict[str, Any]:
                return {"status": "completed"}

            def push_evidence(self, current: dict[str, Any], worktree: Path, head_before: str) -> dict[str, Any]:
                return {"pushVerified": True}

            def validate(self, worktree: Path) -> dict[str, Any]:
                return {"passed": True, "commands": []}

            def notify_once(self, kind: str, current: dict[str, Any], head: str, message: str, detail: str) -> dict[str, Any]:
                return {"sent": True}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            c = NoCurrent(
                root=root,
                pub_refs=root / "pub",
                state_path=root / "state.json",
                runner=runner,
                auto_un_draft=True,
            )
            draft = pr()
            draft["isDraft"] = True
            draft["mergeStateStatus"] = "CLEAN"
            c.process_pr(draft)
        gh_calls = [x for x in executed if x and Path(x[0]).name == "gh" and "ready" in x]
        self.assertTrue(gh_calls, f"gh pr ready SHOULD run when enabled for a CLEAN draft, got {executed}")


class MaintenanceModelTests(unittest.TestCase):
    def test_agent_calls_pin_the_configured_model(self) -> None:
        calls: list[tuple[str, ...]] = []

        def runner(*command: str, **_: Any) -> CommandResult:
            calls.append(command)
            return CommandResult(0, "")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            controller = ConvergenceController(
                root=root,
                pub_refs=root / "pub",
                hermes_model="deepseek/deepseek-v4-flash-0731",
                runner=runner,
            )
            controller.run_agent(pr(), 1, root)

        self.assertEqual(
            calls[0][0:6],
            ("/home/aidome-dev/.local/bin/hermes", "-m", "deepseek/deepseek-v4-flash-0731", "--accept-hooks", "-z", calls[0][5]),
        )


if __name__ == "__main__":
    unittest.main()
