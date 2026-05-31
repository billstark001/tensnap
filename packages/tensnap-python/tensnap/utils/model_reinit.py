"""Helpers for rebuilding handler-owned simulation models."""

from __future__ import annotations

from collections.abc import Callable, Container
from typing import Any, cast


async def reinitialize_registered_model(
    handler: Any,
    *,
    lifecycle_parameter_ids: Container[str] = frozenset(),
    unregister_auto: Callable[[Any], None] | None = None,
    rebuild_model: Callable[[], None] | None = None,
    reregister: Callable[[Any], Any] | None = None,
) -> None:
    """
    Rebuild a model owned by a registered handler while preserving UI parameters.

    The handler is expected to expose the conventions used by TenSnap model
    handlers: ``scenario``, ``model_init_kwargs_orig``, ``model_init_kwargs``,
    ``_unregister_auto()``, ``_init_model()``, and ``on_registered()``. Optional
    callbacks let specialized handlers override individual steps without
    reimplementing the parameter replay algorithm.
    """
    scenario = handler.scenario
    assert scenario is not None, "Handler must be registered before re-init."

    dumped: dict[str, Any] = {
        pid: scenario._get_param_value(param)
        for pid, param in scenario.parameters.items()
    }

    if unregister_auto is None:
        unregister_auto = cast(Callable[[Any], None], handler._unregister_auto)
    unregister_auto(scenario)

    replayed: dict[str, Any] = {}
    init_kwargs_orig = getattr(handler, "model_init_kwargs_orig", {})
    init_kwargs = getattr(handler, "model_init_kwargs", {})

    for key, value in dumped.items():
        if key in lifecycle_parameter_ids:
            continue
        if key in init_kwargs_orig:
            init_kwargs[key] = value
        else:
            replayed[key] = value

    if rebuild_model is None:
        rebuild_model = cast(Callable[[], None], handler._init_model)
    rebuild_model()

    if reregister is None:
        reregister = cast(Callable[[Any], Any], handler.on_registered)
    await reregister(scenario)

    for key, value in replayed.items():
        if key in scenario.parameters:
            scenario._set_param_value(scenario.parameters[key], value)
