"""Restore the clock of a Mesa model with its default step schedule.

Mesa 3.5 introduced an event-backed ``step`` wrapper. Its pending event must
move with model time, or the next wrapper call can replay old model steps.
"""

from __future__ import annotations

import math
from dataclasses import is_dataclass, replace
from typing import Any

from tensnap.bindings.basic.restore_plan import RestoreValue

from .utils import is_mesa_model_class


def mesa_model_time(model: Any) -> int | float:
    """Return the public Mesa clock (``steps`` on older Mesa 3 releases)."""
    if not is_mesa_model_class(type(model)):
        raise TypeError("Mesa clock requires a mesa.Model instance")
    if hasattr(model, "time"):
        value = model.time
    elif hasattr(model, "steps"):
        value = model.steps
    else:
        raise ValueError("Mesa model has no supported clock")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    raise ValueError("Mesa model has no supported clock")


def validate_mesa_model_time_restore(model: Any, time: int | float) -> int:
    """Check whether a projected integer clock can be restored safely.

    A model with additional future events or recurring generators needs its
    own full scheduler checkpoint; moving only the default step is insufficient.
    """
    if isinstance(time, bool) or not isinstance(time, (int, float)) or time < 0:
        raise ValueError("Mesa restore time must be a nonnegative integer")
    if isinstance(time, float) and (not math.isfinite(time) or not time.is_integer()):
        raise ValueError("Mesa restore time must be a nonnegative integer")
    tick = int(time)
    mesa_model_time(model)
    if getattr(model, "_simulator", None) is not None:
        raise ValueError(
            "Mesa models with an external simulator need a model checkpoint"
        )

    generator = getattr(model, "_default_schedule", None)
    if generator is None:
        if not hasattr(model, "steps"):
            raise ValueError("Mesa model has no supported default step schedule")
        return tick
    if tick >= 2**53 - 1:
        raise ValueError("Mesa event clock cannot advance exactly from this time")

    event_list = getattr(model, "_event_list", None)
    current_event = getattr(generator, "_current_event", None)
    schedule = getattr(generator, "schedule", None)
    generators = getattr(model, "_event_generators", None)
    # Mesa 3.5.0 keeps this list empty even for its active default generator.
    default_only = generators is not None and (
        not generators or (len(generators) == 1 and generator in generators)
    )
    if (
        event_list is None
        or current_event is None
        or schedule is None
        or not is_dataclass(schedule)
        or not callable(getattr(event_list, "peek_ahead", None))
        or not callable(getattr(generator, "stop", None))
        or not callable(getattr(generator, "start", None))
        or not hasattr(generator, "_execution_count")
        or not getattr(generator, "_active", False)
        or getattr(generator, "_paused", False)
        or getattr(schedule, "interval", None) != 1
        or getattr(schedule, "end", None) is not None
        or getattr(schedule, "count", None) is not None
        or not default_only
    ):
        raise ValueError("Mesa clock restore requires the default step schedule")
    try:
        pending = event_list.peek_ahead(2)
    except IndexError as exc:
        raise ValueError("Mesa default step event is missing") from exc
    if len(pending) != 1 or pending[0] is not current_event:
        raise ValueError("Mesa model has other pending events; use a model checkpoint")
    return tick


def restore_mesa_model_time(model: Any, time: int | float) -> None:
    """Set model time and rebase Mesa's next default step event.

    EventGenerator has no public clock-reset method in Mesa 3.5/4.0a0. The
    private access here is limited to the default schedule after preflight.
    """
    tick = validate_mesa_model_time_restore(model, time)
    generator = getattr(model, "_default_schedule", None)
    if generator is not None:
        generator.stop()
    if hasattr(model, "steps"):
        model.steps = tick
    if hasattr(model, "time"):
        model.time = float(tick)
    if generator is not None:
        generator.schedule = replace(generator.schedule, start=float(tick + 1))
        generator._execution_count = tick
        generator.start()


mesa_clock_restore = RestoreValue(
    apply=restore_mesa_model_time,
    validate=validate_mesa_model_time_restore,
)
