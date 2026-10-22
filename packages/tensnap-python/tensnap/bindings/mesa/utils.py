"""Mesa detection and version-aware reconstruction utilities."""

from __future__ import annotations

import importlib
import math
from dataclasses import is_dataclass, replace
from functools import lru_cache
from types import ModuleType
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Iterable, Sequence
    from random import Random

    # Mesa has no py.typed marker. This is the common cell-space surface used by
    # the bindings and examples; runtime exports are the native Mesa classes.
    class CellCollection:
        cells: Iterable[Cell]
        agents: Iterable[CellAgent]

    class Cell:
        coordinate: tuple[int, ...]
        agents: list[CellAgent]
        is_empty: bool
        is_full: bool
        neighborhood: CellCollection

        def get_neighborhood(
            self, radius: int = 1, include_center: bool = False
        ) -> CellCollection: ...

    class CellAgent:
        model: Any
        cell: Cell
        unique_id: int

        def __init__(self, model: Any) -> None: ...
        def remove(self) -> None: ...

    class OrthogonalMooreGrid:
        dimensions: Sequence[int]
        all_cells: Iterable[Cell]

        def __init__(
            self,
            dimensions: Sequence[int],
            *,
            torus: bool = False,
            capacity: float | None = None,
            random: Random | None = None,
        ) -> None: ...

        def __getitem__(self, coordinate: tuple[int, ...]) -> Cell: ...


_CELL_SPACE_EXPORTS = frozenset(
    {"Cell", "CellAgent", "CellCollection", "OrthogonalMooreGrid"}
)


@lru_cache(maxsize=1)
def _load_mesa_cell_space() -> ModuleType:
    """Resolve Mesa 3.2-3.5 cell space, or its Mesa 3.0/3.1 namespace.

    The fallback runs only when ``mesa.discrete_space`` itself is absent.
    Missing dependencies inside either module propagate to the caller.
    """
    try:
        return importlib.import_module("mesa.discrete_space")
    except ModuleNotFoundError as error:
        if error.name != "mesa.discrete_space":
            raise
        return importlib.import_module("mesa.experimental.cell_space")


def __getattr__(name: str) -> Any:
    """Lazily expose native cell-space classes without requiring Mesa on import."""
    if name in _CELL_SPACE_EXPORTS:
        return getattr(_load_mesa_cell_space(), name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


@lru_cache(maxsize=2)
def _load_mesa_base_class(name: str) -> type[Any] | None:
    try:
        base_class = getattr(importlib.import_module("mesa"), name, None)
    except Exception:
        return None
    return base_class if isinstance(base_class, type) else None


def _is_mesa_subclass(value: object, base_name: str) -> bool:
    if not isinstance(value, type):
        return False

    base_class = _load_mesa_base_class(base_name)
    if isinstance(base_class, type):
        try:
            return issubclass(value, base_class)
        except TypeError:
            return False

    return any(
        base.__name__ == base_name
        and (base.__module__ == "mesa" or base.__module__.startswith("mesa."))
        for base in getattr(value, "__mro__", ())
    )


def is_mesa_model_class(value: object) -> bool:
    return _is_mesa_subclass(value, "Model")


def is_mesa_agent_class(value: object) -> bool:
    return _is_mesa_subclass(value, "Agent")


def cleanup_mesa_model_step(model: object) -> None:
    """Remove the instance-level step wrapper used by Mesa 3.0 through 3.5.1.

    No-op when the instance has no own ``step`` attribute. For constructor
    reconstruction, use ``prepare_mesa_model_reinit`` to also handle legacy IDs.
    """
    if "step" in vars(model):
        delattr(model, "step")


def prepare_mesa_model_reinit(model: object) -> None:
    """Prepare a Mesa model for an immediate in-place constructor call.

    Mesa 3.0-3.4 uses ``Agent._ids[model]`` outside the model instance; discard
    only this model's entry so new agents restart at ID 1. Mesa 3.5.0/3.5.1 uses
    a model-owned counter that ``Model.__init__`` resets: ID cleanup is a no-op
    there. Runtime detection checks the counter layout, not a version string.

    The ID operation is also a no-op if ``Agent._ids`` is absent, is not a dict,
    or contains no entry for this model. Step-wrapper cleanup still applies in
    all these versions; the whole utility is a no-op only if both the instance
    ``step`` and the legacy counter entry are absent. Repeated calls are safe.

    Call immediately before ``type(model).__init__(model, ...)``, as part of
    replacing the population. The constructor owns RNG and clock initialization.
    Raises ``TypeError`` for objects that are not Mesa models.
    """
    if not is_mesa_model_class(type(model)):
        raise TypeError("Mesa reconstruction requires a mesa.Model instance")
    cleanup_mesa_model_step(model)
    # Private layout verified against Mesa 3.0.3, 3.3.1 and 3.4.0. Mesa 3.5.0
    # moved allocation into Model.register_agent and removed Agent._ids.
    agent_class = _load_mesa_base_class("Agent")
    agent_ids = getattr(agent_class, "_ids", None)
    if isinstance(agent_ids, dict):
        agent_ids.pop(model, None)


def mesa_model_time(model: Any) -> int | float:
    """Read ``time`` on Mesa 3.4/3.5, or ``steps`` on Mesa 3.0-3.3."""
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
    Scheduler inspection is a no-op on Mesa 3.0-3.4, where the default step
    wrapper has no event generator. Mesa 3.5.0/3.5.1 requires the default event
    schedule and rejects additional pending events before changing any state.
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

    Mesa 3.5.0/3.5.1 has no public EventGenerator clock-reset method, so the
    validated default generator is rebased through its private execution count.
    Generator rebasing is a no-op on Mesa 3.0-3.4; the scalar clock is still set.
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
