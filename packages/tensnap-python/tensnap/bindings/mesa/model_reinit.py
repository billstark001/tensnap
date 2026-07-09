"""Mesa-specific reset helpers plus deprecated lifecycle re-exports."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from warnings import warn

from tensnap.bindings.lifecycle import (
    BindKwargsConfig as _BindKwargsConfig,
)
from tensnap.bindings.lifecycle import (
    BoundModelReinitializer as _BoundModelReinitializer,
)
from tensnap.bindings.lifecycle import (
    KwargBinding as _KwargBinding,
)
from tensnap.bindings.lifecycle import (
    KwargValueSource as _KwargValueSource,
)
from tensnap.bindings.lifecycle import (
    RegistryChanges as _RegistryChanges,
)
from tensnap.bindings.lifecycle import (
    bind_kwargs as _bind_kwargs,
)
from tensnap.bindings.lifecycle import (
    default_cleanup_for_model as _default_cleanup_for_model,
)
from tensnap.bindings.lifecycle import (
    get_bind_kwargs as _get_bind_kwargs,
)
from tensnap.bindings.lifecycle import (
    merge_registry_changes as _merge_registry_changes,
)
from tensnap.bindings.lifecycle import (
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
    "BindKwargsConfig",
    "BoundModelReinitializer",
    "KwargBinding",
    "KwargValueSource",
    "RegistryChanges",
    "bind_kwargs",
    "cleanup_mesa_model_step",
    "default_cleanup_for_model",
    "get_bind_kwargs",
    "merge_registry_changes",
    "reinitialize_registered_model",
]
