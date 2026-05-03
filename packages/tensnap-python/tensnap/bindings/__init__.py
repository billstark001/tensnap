"""Unified binder-layer entrypoints for attach and readback."""

from __future__ import annotations

from types import ModuleType
from typing import Any, cast

from tensnap.models.environment import EnvironmentBinding
from tensnap.models.layer import LayerBinding
from tensnap.models.parameter import Parameter

from .basic import *  # noqa: F403
from .basic.action import ActionMetadata, get_action_metadata_from_namespace
from .basic.chart import ChartGroupMetadata, get_chart_metadata_from_namespace
from .basic.layer import BindLayerConfig
from .basic.parameter import (
    BindParametersConfig,
    get_parameter_metadata_from_object,
)

_ENVIRONMENT_BINDING_ATTR = "_tensnap_environment_binding_config"
_LAYER_BINDINGS_ATTR = "_tensnap_layer_binding_configs"
_LAYER_CONFIGS_ATTR = "_tensnap_layer_binding_config_objects"


def _binding_owner(value: Any) -> Any:
    if isinstance(value, type):
        return value
    if isinstance(value, ModuleType):
        return value
    return value.__class__


def environment_binding(value: Any) -> EnvironmentBinding | None:
    owner = _binding_owner(value)
    binding = getattr(owner, _ENVIRONMENT_BINDING_ATTR, None)
    return binding if isinstance(binding, EnvironmentBinding) else None


def layer_bindings(value: Any) -> list[LayerBinding[Any, Any, Any, Any]]:
    owner = _binding_owner(value)
    raw_bindings = getattr(owner, _LAYER_BINDINGS_ATTR, [])
    return list(cast(list[LayerBinding[Any, Any, Any, Any]], raw_bindings))


def layer_configs(value: Any) -> list[BindLayerConfig[Any, Any]]:
    owner = _binding_owner(value)
    raw_configs = getattr(owner, _LAYER_CONFIGS_ATTR, [])
    return list(cast(list[BindLayerConfig[Any, Any]], raw_configs))


def bindings(value: Any) -> tuple[
    EnvironmentBinding | None,
    list[LayerBinding[Any, Any, Any, Any]],
]:
    return environment_binding(value), layer_bindings(value)


def actions(
    value: dict[str, Any] | ModuleType | object,
) -> list[tuple[str, Any, ActionMetadata]]:
    if isinstance(value, dict):
        return get_action_metadata_from_namespace(value)
    if isinstance(value, ModuleType) or isinstance(value, type):
        return get_action_metadata_from_namespace(dict(vars(value)))

    discovered: list[tuple[str, Any, ActionMetadata]] = []
    for name, func, metadata in get_action_metadata_from_namespace(
        dict(vars(value.__class__))
    ):
        discovered.append(
            (name, getattr(value, name) if func is not None else None, metadata)
        )
    return discovered


def charts(
    value: dict[str, Any] | ModuleType | object,
) -> list[tuple[str, Any, ChartGroupMetadata]]:
    if isinstance(value, dict):
        return get_chart_metadata_from_namespace(value)
    if isinstance(value, ModuleType) or isinstance(value, type):
        return get_chart_metadata_from_namespace(dict(vars(value)))

    discovered: list[tuple[str, Any, ChartGroupMetadata]] = []
    for name, func, metadata in get_chart_metadata_from_namespace(
        dict(vars(value.__class__))
    ):
        bound = (lambda target=value, f=func: f(target)) if func is not None else None
        discovered.append((name, bound, metadata))
    return discovered


def parameters(
    value: dict[str, Any] | ModuleType | object,
    cfg_suggest: BindParametersConfig | None = None,
) -> list[tuple[str, Parameter]]:
    return get_parameter_metadata_from_object(value, cfg_suggest=cfg_suggest)
