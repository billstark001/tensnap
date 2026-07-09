"""Mesa 3 bindings for TenSnap."""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any
from warnings import warn

if TYPE_CHECKING:
    from tensnap.bindings.lifecycle import (
        BindKwargsConfig,
        BoundModelReinitializer,
        KwargBinding,
        bind_kwargs,
        default_cleanup_for_model,
        get_bind_kwargs,
        merge_registry_changes,
        reinitialize_registered_model,
    )

    from .datacollector import (
        BindDataCollectorConfig,
        bind_datacollector,
        get_registered_collectors,
    )
    from .handler import MesaSimulationHandler
    from .utils import cleanup_mesa_model_step


_DIRECT_EXPORTS = {
    "BindDataCollectorConfig": (".datacollector", "BindDataCollectorConfig"),
    "bind_datacollector": (".datacollector", "bind_datacollector"),
    "get_registered_collectors": (".datacollector", "get_registered_collectors"),
    "MesaSimulationHandler": (".handler", "MesaSimulationHandler"),
    "cleanup_mesa_model_step": (".utils", "cleanup_mesa_model_step"),
}

_DEPRECATED_EXPORTS = {
    "BindKwargsConfig": ("tensnap.bindings.lifecycle", "BindKwargsConfig"),
    "BoundModelReinitializer": (
        "tensnap.bindings.lifecycle",
        "BoundModelReinitializer",
    ),
    "KwargBinding": ("tensnap.bindings.lifecycle", "KwargBinding"),
    "bind_kwargs": ("tensnap.bindings.lifecycle", "bind_kwargs"),
    "get_bind_kwargs": ("tensnap.bindings.lifecycle", "get_bind_kwargs"),
    "merge_registry_changes": (
        "tensnap.bindings.lifecycle",
        "merge_registry_changes",
    ),
    "reinitialize_registered_model": (
        "tensnap.bindings.lifecycle",
        "reinitialize_registered_model",
    ),
    "default_cleanup_for_model": (
        "tensnap.bindings.lifecycle",
        "default_cleanup_for_model",
    ),
}

__all__ = [
    "BindDataCollectorConfig",
    "BindKwargsConfig",
    "BoundModelReinitializer",
    "KwargBinding",
    "MesaSimulationHandler",
    "bind_datacollector",
    "bind_kwargs",
    "cleanup_mesa_model_step",
    "default_cleanup_for_model",
    "get_bind_kwargs",
    "get_registered_collectors",
    "merge_registry_changes",
    "reinitialize_registered_model",
]


def __getattr__(name: str) -> Any:
    if name in _DIRECT_EXPORTS:
        module_name, attr_name = _DIRECT_EXPORTS[name]
        return getattr(import_module(module_name, __name__), attr_name)

    if name in _DEPRECATED_EXPORTS:
        module_name, attr_name = _DEPRECATED_EXPORTS[name]
        warn(
            f"tensnap.bindings.mesa.{name} is deprecated; import {name} from "
            f"{module_name} instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return getattr(import_module(module_name), attr_name)

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
