"""Shared live Hermes schedule configuration for Switchboard maintenance."""

SCHEDULE = "0 12,19 * * *"
TIMEZONE_NAME = "Asia/Jerusalem"
TELEGRAM_TARGET = "telegram:1205688131"
EXPECTED_RUN_HOURS = frozenset({12, 19})
