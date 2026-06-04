"""Internal Mesa detection and reset helpers."""

from __future__ import annotations

import importlib
from functools import lru_cache
from typing import Any


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
    """Remove Mesa's instance-level step wrapper before calling __init__ again."""
    if "step" in vars(model):
        delattr(model, "step")
