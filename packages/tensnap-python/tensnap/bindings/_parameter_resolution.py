"""Resolve one declaration per source field for model and constructor controls."""

from __future__ import annotations

import inspect
import sys
from collections.abc import Collection, Mapping, Sequence
from copy import deepcopy
from typing import Annotated, Any, get_args, get_origin, get_type_hints

from tensnap.models.parameter import Parameter, ParameterType, create_parameter

from ._parameter_declarations import UNSET, BindParameterConfig, BindParametersConfig


def type_hints(target: Any, names: Collection[str]) -> dict[str, Any]:
    """Resolve relevant annotations without swallowing name-resolution errors."""
    if not isinstance(target, type):
        target = inspect.unwrap(target)
    if not isinstance(target, type) and not hasattr(target, "__annotations__"):
        return {}

    if isinstance(target, type):
        result: dict[str, Any] = {}
        for cls in reversed(target.__mro__):
            result.update(
                _selected_hints(
                    cls, names, vars(sys.modules[cls.__module__]), dict(vars(cls))
                )
            )
        return result
    return _selected_hints(target, names, target.__globals__)


def _selected_hints(
    target: Any,
    names: Collection[str],
    globalns: dict[str, Any],
    localns: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Evaluate selected annotations in their actual declaration namespace."""

    def selected_annotations() -> None:
        pass

    selected_annotations.__annotations__ = {
        name: annotation
        for name, annotation in inspect.get_annotations(target).items()
        if name in names
    }
    return get_type_hints(
        selected_annotations,
        globalns=globalns,
        localns=localns,
        include_extras=True,
    )


def annotated_declarations(annotation: Any) -> tuple[BindParameterConfig[Any], ...]:
    """Extract parameter declarations from one Python annotation."""
    if get_origin(annotation) is not Annotated:
        return ()
    return tuple(
        item
        for item in get_args(annotation)[1:]
        if isinstance(item, BindParameterConfig)
    )


def _infer_type(annotation: Any, value: Any) -> ParameterType:
    if get_origin(annotation) is Annotated:
        annotation = get_args(annotation)[0]
    if annotation is bool or isinstance(value, bool):
        return "boolean"
    if annotation is str or isinstance(value, str):
        return "string"
    return "number"


def resolve_parameter(  # noqa: PLR0913 - Shared model/constructor resolution inputs.
    name: str,
    *,
    value: Any = UNSET,
    annotation: Any = None,
    declarations: Sequence[BindParameterConfig[Any]] = (),
    configs: Sequence[BindParametersConfig] = (),
    owner: Any = None,
    default_runtime_change: bool = True,
    custom: Mapping[str, Any] | None = None,
) -> Parameter:
    """Resolve metadata before inference, keeping callbacks outside copied data.

    Declarations are one priority tier. Conflicting IDs/types within that tier
    are ambiguous; ordered custom configurations are deliberate overrides.
    """
    types = {declaration.type for declaration in declarations}
    ids = {declaration.id for declaration in declarations if declaration.id}
    if len(types) > 1 or len(ids) > 1:
        raise ValueError(
            f"Ambiguous parameter declaration for source field {name!r}: "
            f"types={sorted(types)!r}, ids={sorted(ids)!r}"
        )

    fields: dict[str, Any] = {
        "id": name,
        "allow_runtime_change": default_runtime_change,
    }
    for declaration in declarations:
        fields.update(declaration._resolved_fields(owner))
    override = (
        BindParametersConfig.evaluate_custom_binding(configs, name)
        if custom is None
        else custom
    )
    fields.update(override)
    if value is UNSET:
        value = next(
            (
                declaration._resolve(declaration.default, owner)
                for declaration in reversed(declarations)
                if "default" in declaration._specified
            ),
            None,
        )
    if "type" not in fields:
        fields["type"] = _infer_type(annotation, value)
    fields["value"] = value
    # Only metadata is owned by the resolved definition. Bound methods and
    # closures remain the exact objects supplied by the caller.
    copied = {
        key: item if key in {"getter", "setter"} else deepcopy(item)
        for key, item in fields.items()
    }
    return create_parameter(**copied)


def validate_parameter_batch(parameters: Sequence[tuple[str, Parameter]]) -> None:
    """Reject source aliases and duplicate public IDs before registry mutation."""
    names: set[str] = set()
    ids: dict[str, str] = {}
    for name, parameter in parameters:
        if name in names:
            raise ValueError(
                f"Duplicate parameter declaration for source field {name!r}"
            )
        if parameter.id in ids:
            raise ValueError(
                f"Parameter id conflict: source fields {ids[parameter.id]!r} and "
                f"{name!r} both publish {parameter.id!r}"
            )
        names.add(name)
        ids[parameter.id] = name
