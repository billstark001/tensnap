"""Static candidate discovery, followed by one shared parameter resolution pass."""

from __future__ import annotations

import inspect
from collections.abc import Callable, Mapping, Sequence
from types import ModuleType
from typing import Any, cast

from tensnap.bindings.mesa.utils import is_mesa_model_class
from tensnap.models.chart import ChartGroupMetadata
from tensnap.models.monitor import MonitorMetadata
from tensnap.models.parameter import Parameter
from tensnap.utils.member_metadata import class_members, read_member_metadata

from ._parameter_declarations import UNSET, BindParameterConfig, BindParametersConfig
from ._parameter_resolution import (
    annotated_declarations,
    resolve_parameter,
    type_hints,
    validate_parameter_batch,
)

_MESA_DEFAULTS = BindParametersConfig(
    exclude=["agent_id_counter", "time", "running", "steps"], include_explicit=True
)


def registration_parameter_configs(
    target: Any, *suggestions: BindParametersConfig
) -> tuple[BindParametersConfig, ...]:
    """Share the explicit-only registration policy with lifecycle planning."""
    if suggestions or BindParametersConfig.get_configs(type(target)):
        return suggestions
    return (BindParametersConfig.EXPLICIT_ONLY,)


def _is_observation(member: Any) -> bool:
    return (
        read_member_metadata(member, "_tensnap_chart", ChartGroupMetadata) is not None
        or read_member_metadata(member, "_tensnap_monitor", MonitorMetadata) is not None
    )


def _declarations(member: Any, annotation: Any) -> tuple[BindParameterConfig[Any], ...]:
    field = annotated_declarations(annotation)
    if isinstance(member, BindParameterConfig):
        field = (member, *field)
    return field


def _current_value(
    name: str,
    member: Any,
    owner: Any,
    instance_fields: Mapping[str, Any],
    custom: Mapping[str, Any],
) -> Any:
    """Read the selected value once, honoring an explicit accessor first."""
    if custom.get("getter") is not None:
        return custom["getter"]()
    if owner is not None:
        return getattr(owner, name, UNSET)
    value = instance_fields.get(name, member)
    return UNSET if isinstance(value, BindParameterConfig) else value


def _discover(  # noqa: PLR0913 - Explicit adapters keep scanning separate from resolution.
    namespace: Mapping[str, Any],
    configs: Sequence[BindParametersConfig],
    *,
    owner: Any = None,
    annotations: Mapping[str, Any] | None = None,
    initializer: Any = None,
    instance_fields: Mapping[str, Any] | None = None,
) -> list[tuple[str, Parameter]]:
    annotations = annotations or {}
    initializer = inspect.unwrap(initializer) if initializer is not None else None
    init_names = (
        inspect.get_annotations(initializer)
        if initializer is not None and hasattr(initializer, "__annotations__")
        else {}
    )
    instance_fields = instance_fields or {}
    names = dict.fromkeys([*namespace, *annotations, *instance_fields])
    for config in configs:
        names.update(dict.fromkeys(config.custom_bindings))
    parameters: list[tuple[str, Parameter]] = []
    for name in names:
        if name.startswith("__") and name.endswith("__"):
            continue
        member = namespace.get(name, UNSET)
        declarations = _declarations(member, annotations.get(name))
        explicit = bool(declarations) or any(
            name in config.custom_bindings for config in configs
        )
        if not any(
            BindParametersConfig.evaluate_is_included(configs, name, explicit=kind)
            for kind in (explicit, explicit or name in init_names)
        ):
            continue
        # Inspect roles before evaluating a property: observation getters can
        # be expensive or stateful, and inclusion selectors do not change roles.
        observation = _is_observation(member) or (
            isinstance(member, property) and member.fset is None
        )
        if not declarations and observation and name in init_names:
            declarations = annotated_declarations(
                type_hints(initializer, {name}).get(name)
            )
            explicit = explicit or bool(declarations)
        if observation and not explicit:
            continue
        custom = BindParametersConfig.evaluate_custom_binding(configs, name)
        value = _current_value(name, member, owner, instance_fields, custom)
        if not explicit and (
            value is UNSET
            or (value is not None and not isinstance(value, (int, float, str)))
        ):
            continue
        if not declarations and name in init_names:
            declarations = annotated_declarations(
                type_hints(initializer, {name}).get(name)
            )
            explicit = explicit or bool(declarations)
        if not BindParametersConfig.evaluate_is_included(
            configs, name, explicit=explicit
        ):
            continue
        parameters.append(
            (
                name,
                resolve_parameter(
                    name,
                    value=value,
                    declarations=declarations,
                    owner=owner,
                    custom=custom,
                ),
            )
        )
    validate_parameter_batch(parameters)
    return parameters


def get_parameter_metadata_from_namespace(
    namespace: dict[str, Any],
    *cfg_suggest: BindParametersConfig,
    owner: Any = None,
) -> list[tuple[str, Parameter]]:
    """Discover namespace controls with optional live instance readback."""
    return _discover(namespace, cfg_suggest, owner=owner)


def get_parameter_metadata_from_object(
    obj: Any, *cfg_suggest: BindParametersConfig
) -> list[tuple[str, Parameter]]:
    """Resolve source fields once, before creating or registering controls."""
    provider = getattr(obj, "__tensnap_parameter_metadata__", None)
    if callable(provider):
        parameters = cast(Callable[..., list[tuple[str, Parameter]]], provider)(
            *cfg_suggest
        )
        validate_parameter_batch(parameters)
        return parameters
    if isinstance(obj, dict):
        return get_parameter_metadata_from_namespace(obj, *cfg_suggest)
    if isinstance(obj, ModuleType):
        return get_parameter_metadata_from_namespace(vars(obj), *cfg_suggest)

    cls = obj if isinstance(obj, type) else type(obj)
    configs = [*cfg_suggest, *BindParametersConfig.get_configs(cls)]
    if is_mesa_model_class(cls):
        configs.insert(0, _MESA_DEFAULTS)
    try:
        instance_fields = {} if isinstance(obj, type) else vars(obj)
    except TypeError:
        instance_fields = {}
    members = class_members(cls)
    annotation_names = {
        name for base in cls.__mro__ for name in inspect.get_annotations(base)
    }
    relevant = {
        name
        for name in {*members, *instance_fields, *annotation_names}
        if not (name.startswith("__") and name.endswith("__"))
        and any(
            BindParametersConfig.evaluate_is_included(configs, name, explicit=explicit)
            for explicit in (False, True)
        )
    }
    return _discover(
        members,
        configs,
        owner=None if isinstance(obj, type) else obj,
        annotations=type_hints(cls, relevant),
        initializer=cls.__init__,
        instance_fields=instance_fields,
    )


def validate_parameter_accessors(
    target: Any, parameters: Sequence[tuple[str, Parameter]]
) -> None:
    """Reject known read-only descriptors before committing any registration."""
    if isinstance(target, (dict, ModuleType)):
        return
    for name, parameter in parameters:
        if parameter.setter is not None:
            continue
        member = inspect.getattr_static(type(target), name, None)
        readonly = (isinstance(member, property) and member.fset is None) or (
            isinstance(member, BindParameterConfig) and member.fset is None
        )
        if readonly:
            raise ValueError(
                f"Parameter {parameter.id!r} (source field {name!r}) has no setter; "
                "supply a setter or declare a monitor"
            )
