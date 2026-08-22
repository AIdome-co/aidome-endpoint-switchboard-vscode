"""Shared live Hermes schedule configuration for Switchboard maintenance."""

SCHEDULE = "0 12,19 * * *"
TIMEZONE_NAME = "Asia/Jerusalem"
TELEGRAM_TARGET = "telegram:1205688131"
EXPECTED_RUN_HOURS = frozenset({12, 19})
# A full fix/review cycle may need several test commands and one model session.
# Keep a hard controller deadline, with Hermes' wrapper timeout slightly above it.
CONTROLLER_RUN_BUDGET_SECONDS = 1500
HERMES_SCRIPT_TIMEOUT_SECONDS = 1620
HERMES_ENTRYPOINT_NAME = "switchboard-maintenance.py"
HERMES_MAINTENANCE_MODEL = "deepseek/deepseek-v4-flash-0731"
# Opt-in: allow the controller to mark a draft PR ready for review when it is
# currently mergeable and non-conflicting. Never auto-merges. Off by default so
# un-drafting remains a manual, explicit decision unless an operator enables it.
AUTO_UN_DRAFT_PRS = False
