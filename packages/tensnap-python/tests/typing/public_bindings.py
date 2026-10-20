"""Public decorator exports must resolve to callables in CLI and editor checks."""

from typing_extensions import assert_type

from tensnap import action as root_action, chart as root_chart, monitor as root_monitor
from tensnap.bindings import action, chart, monitor


def advance() -> bool:
    return True


def population() -> int:
    return 3


def status() -> dict[str, bool]:
    return {"ready": True}


assert_type(action("advance")(advance)(), bool)
assert_type(root_action("advance")(advance)(), bool)
chart("population")(population)
root_chart("population")(population)
monitor("status")(status)
root_monitor("status")(status)
