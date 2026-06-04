"""Mesa-specific reset helpers plus deprecated lifecycle re-exports."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from warnings import warn

from tensnap.bindings.lifecycle import (
    BindKwargsConfig as _BindKwargsConfig,
    BoundModelReinitializer as _BoundModelReinitializer,
    KwargBinding as _KwargBinding,
    KwargValueSource as _KwargValueSource,
    RegistryChanges as _RegistryChanges,
    bind_kwargs as _bind_kwargs,
    default_cleanup_for_model as _default_cleanup_for_model,
    get_bind_kwargs as _get_bind_kwargs,
    merge_registry_changes as _merge_registry_changes,
    reinitialize_registered_model as _reinitialize_registered_model,
)

from .utils import cleanup_mesa_model_step

if TYPE_CHECKING:
    RegistryChanges = _RegistryChanges
    BindKwargsConfig = _BindKwargsConfig
    KwargBinding = _KwargBinding
    KwargValueSource = _KwargValueSource
    BoundModelReinitializer = _BoundModelReinitializer
    bind_kwargs = _bind_kwargs
    get_bind_kwargs = _get_bind_kwargs
    merge_registry_changes = _merge_registry_changes
    reinitialize_registered_model = _reinitialize_registered_model
    default_cleanup_for_model = _default_cleanup_for_model


def __getattr__(name: str) -> Any:
    deprecated_exports = {
        "RegistryChanges": _RegistryChanges,
        "BindKwargsConfig": _BindKwargsConfig,
        "KwargBinding": _KwargBinding,
        "KwargValueSource": _KwargValueSource,
        "BoundModelReinitializer": _BoundModelReinitializer,
        "bind_kwargs": _bind_kwargs,
        "get_bind_kwargs": _get_bind_kwargs,
        "merge_registry_changes": _merge_registry_changes,
        "reinitialize_registered_model": _reinitialize_registered_model,
        "default_cleanup_for_model": _default_cleanup_for_model,
    }
    if name in deprecated_exports:
        warn(
            f"tensnap.bindings.mesa.model_reinit.{name} is deprecated; import {name} "
            "from tensnap.bindings.lifecycle instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return deprecated_exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "RegistryChanges",
    "BindKwargsConfig",
    "KwargBinding",
    "KwargValueSource",
    "BoundModelReinitializer",
    "bind_kwargs",
    "get_bind_kwargs",
    "merge_registry_changes",
    "reinitialize_registered_model",
    "cleanup_mesa_model_step",
    "default_cleanup_for_model",
]
