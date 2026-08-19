"""Shared live Hermes schedule configuration for Switchboard maintenance."""

SCHEDULE = "0 12,19 * * *"
TIMEZONE_NAME = "Asia/Jerusalem"
TELEGRAM_TARGET = "telegram:1205688131"
EXPECTED_RUN_HOURS = frozenset({12, 19})
CONTROLLER_RUN_BUDGET_SECONDS = 480
HERMES_SCRIPT_TIMEOUT_SECONDS = 540
HERMES_ENTRYPOINT_NAME = "switchboard-maintenance.py"
