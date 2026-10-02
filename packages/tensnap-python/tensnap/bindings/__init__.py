"""Unified binder-layer entrypoints for attach and readback."""

from __future__ import annotations

from types import ModuleType
from typing import Any, TypeVar, cast
from warnings import warn

from tensnap.models.action import ActionMetadata as _ActionMetadata
from tensnap.models.chart import ChartGroupMetadata as _ChartGroupMetadata
from tensnap.models.environment import EnvironmentBinding
from tensnap.models.layer import LayerBinding
from tensnap.models.monitor import MonitorMetadata
from tensnap.models.parameter import Parameter
from tensnap.utils.layer_topology import order_layers

from .basic import *  # noqa: F403
from .basic.action import get_action_metadata_from_namespace
from .basic.chart import get_chart_metadata_from_namespace
from .basic.layer import BindLayerConfig
from .basic.monitor import get_monitor_metadata_from_namespace
from .basic.parameter import (
    BindParametersConfig,
    get_parameter_metadata_from_object,
)
from .basic.restore import get_scene_restore_binding
from .ownership import read_class_metadata

for _deprecated_name in ("ActionMetadata", "ChartGroupMetadata"):
    globals().pop(_deprecated_name, None)

_ENVIRONMENT_BINDING_ATTR = "_tensnap_environment_binding_config"
_LAYER_BINDINGS_ATTR = "_tensnap_layer_binding_configs"
_LAYER_CONFIGS_ATTR = "_tensnap_layer_binding_config_objects"
TMetadata = TypeVar("TMetadata")


def _binding_owner(value: Any) -> Any:
    if isinstance(value, type):
        return value
    if isinstance(value, ModuleType):
        return value
    return value.__class__


def _read_owner_metadata(
    value: Any, name: str, expected: type[TMetadata]
) -> TMetadata | None:
    if isinstance(value, ModuleType):
        metadata = getattr(value, name, None)
        return metadata if isinstance(metadata, expected) else None
    return read_class_metadata(value, name, expected)


def environment_binding(value: Any) -> EnvironmentBinding | None:
    return _read_owner_metadata(value, _ENVIRONMENT_BINDING_ATTR, EnvironmentBinding)


def layer_bindings(value: Any) -> list[LayerBinding[Any, Any, Any, Any]]:
    owner = _binding_owner(value)
    bindings: list[LayerBinding[Any, Any, Any, Any]] | None = None
    if not isinstance(value, type) and not isinstance(value, ModuleType):
        raw_configs = _read_owner_metadata(owner, _LAYER_CONFIGS_ATTR, list)
        if raw_configs:
            configs = cast(list[BindLayerConfig[Any, Any]], raw_configs)
            bindings = [config.get_binding_for_target(value) for config in configs]
    if bindings is None:
        raw_bindings = _read_owner_metadata(owner, _LAYER_BINDINGS_ATTR, list)
        bindings = list(
            cast(list[LayerBinding[Any, Any, Any, Any]], raw_bindings or [])
        )
    return order_layers(
        bindings,
        lambda layer: layer.layer_id,
        lambda layer: layer.dependency_layer_ids,
        lambda layer: layer.layer_type,
        allow_missing=True,
    )


def layer_configs(value: Any) -> list[BindLayerConfig[Any, Any]]:
    owner = _binding_owner(value)
    raw_configs = _read_owner_metadata(owner, _LAYER_CONFIGS_ATTR, list)
    return list(cast(list[BindLayerConfig[Any, Any]], raw_configs or []))


def bindings(
    value: Any,
) -> tuple[
    EnvironmentBinding | None,
    list[LayerBinding[Any, Any, Any, Any]],
]:
    return environment_binding(value), layer_bindings(value)


def actions(
    value: dict[str, Any] | ModuleType | object,
) -> list[tuple[str, Any, _ActionMetadata]]:
    if isinstance(value, dict):
        return get_action_metadata_from_namespace(value)
    if isinstance(value, ModuleType) or isinstance(value, type):
        return get_action_metadata_from_namespace(dict(vars(value)))

    discovered: list[tuple[str, Any, _ActionMetadata]] = []
    for name, func, metadata in get_action_metadata_from_namespace(
        dict(vars(value.__class__))
    ):
        discovered.append(
            (name, getattr(value, name) if func is not None else None, metadata)
        )
    return discovered


def charts(
    value: dict[str, Any] | ModuleType | object,
) -> list[tuple[str, Any, _ChartGroupMetadata]]:
    if isinstance(value, dict):
        return get_chart_metadata_from_namespace(value)
    if isinstance(value, ModuleType) or isinstance(value, type):
        return get_chart_metadata_from_namespace(dict(vars(value)))

    discovered: list[tuple[str, Any, _ChartGroupMetadata]] = []
    for name, func, metadata in get_chart_metadata_from_namespace(
        dict(vars(value.__class__))
    ):
        bound = (lambda target=value, f=func: f(target)) if func is not None else None
        discovered.append((name, bound, metadata))
    return discovered


def monitors(
    value: dict[str, Any] | ModuleType | object,
) -> list[tuple[str, Any, MonitorMetadata]]:
    if isinstance(value, dict):
        return get_monitor_metadata_from_namespace(value)
    if isinstance(value, ModuleType) or isinstance(value, type):
        return get_monitor_metadata_from_namespace(dict(vars(value)))

    discovered: list[tuple[str, Any, MonitorMetadata]] = []
    for name, func, metadata in get_monitor_metadata_from_namespace(
        dict(vars(value.__class__))
    ):
        discovered.append((name, lambda target=value, f=func: f(target), metadata))
    return discovered


def scene_restore_binding(value: Any) -> Any:
    """Read a model class's opt-in projected/checkpoint restore declaration."""
    return get_scene_restore_binding(value)


def parameters(
    value: dict[str, Any] | ModuleType | object,
    *cfg_suggest: BindParametersConfig,
) -> list[tuple[str, Parameter]]:
    return get_parameter_metadata_from_object(value, *cfg_suggest)


def __getattr__(name: str) -> Any:
    deprecated_exports = {
        "ActionMetadata": _ActionMetadata,
        "ChartGroupMetadata": _ChartGroupMetadata,
    }
    if name in deprecated_exports:
        warn(
            f"tensnap.bindings.{name} is deprecated; import {name} from "
            "tensnap.models instead.",
            DeprecationWarning,
            stacklevel=2,
        )
        return deprecated_exports[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
