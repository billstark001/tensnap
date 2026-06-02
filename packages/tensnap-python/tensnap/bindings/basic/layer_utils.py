from __future__ import annotations

import re
from collections.abc import Callable, Hashable
from dataclasses import dataclass
from numbers import Number
from typing import Any, Generic, Literal, TypeAlias, TypeVar, cast

from tensnap.models import (
    ProjectorField,
    ProjectorFieldDirective,
    ProjectorFieldForInit,
)
from tensnap.utils.attr import (
    AttrGetter,
    AttrPathMap,
    AttrProjector,
    make_attr_getter,
    make_attr_projector,
)
from tensnap.utils.css import is_css_predefined_color_value, is_css_color_literal

TField = TypeVar("TField", bound=str)

ProjectorDictForInit: TypeAlias = dict[TField, ProjectorFieldForInit]
MetadataDictForInit: TypeAlias = dict[TField, ProjectorFieldForInit]
ProjectorDictFilterList: TypeAlias = list[
    tuple[Callable[[type[Any]], bool], AttrPathMap[TField]]
]
_JSON_LIKE_MIN_LENGTH = 2


class ProjectorAuto(ProjectorFieldDirective):
    def __repr__(self) -> str:
        return "AUTO"


class ProjectorSkip(ProjectorFieldDirective):
    def __repr__(self) -> str:
        return "SKIP"


@dataclass(frozen=True, slots=True)
class ProjectorAttrSelector(ProjectorFieldDirective):
    path: str


@dataclass(frozen=True, slots=True)
class ProjectorLiteralValue(ProjectorFieldDirective):
    data: Any


@dataclass(frozen=True, slots=True)
class ResolvedProjectorFieldSpec(Generic[TField]):
    kind: Literal["selector", "literal", "callable"]
    value: str | Callable[[Any], Any] | Any


AUTO = ProjectorAuto()
SKIP = ProjectorSkip()


def auto() -> ProjectorAuto:
    return AUTO


def skip() -> ProjectorSkip:
    return SKIP


def attr(path: str) -> ProjectorAttrSelector:
    return ProjectorAttrSelector(path)


def value(v: Any) -> ProjectorLiteralValue:
    return ProjectorLiteralValue(v)


_ICON_LITERAL_VALUES = {
    "arrow",
    "circle",
    "square",
    "triangle",
    "diamond",
    "star",
    "hexagon",
    "cross",
    "plus",
    "pentagon",
}
_STRING_LITERAL_MATCHERS: dict[str, Callable[[str], bool]] = {
    "coord_offset": lambda raw: raw in {"int", "float"},
    "interpolation": lambda raw: raw in {"nearest", "linear"},
    "style": lambda raw: raw in {"solid", "dashed", "dotted"},
    "icon": lambda raw: raw in _ICON_LITERAL_VALUES or raw.startswith("asset:"),
    "color": is_css_predefined_color_value,
}
_BOOLEAN_LITERAL_FIELDS = frozenset({"directed"})


def _is_json_like_literal(raw_value: str) -> bool:
    stripped = raw_value.strip()
    if len(stripped) < _JSON_LIKE_MIN_LENGTH:
        return False
    return (
        (stripped[0] == "{" and stripped[-1] == "}")
        or (stripped[0] == "[" and stripped[-1] == "]")
        or (stripped[0] == '"' and stripped[-1] == '"')
    )


def _is_special_literal_string(field: str, raw_value: str) -> bool:
    matcher = _STRING_LITERAL_MATCHERS.get(field)
    if matcher is not None and matcher(raw_value):
        return True
    return is_css_color_literal(raw_value) or _is_json_like_literal(raw_value)


def _target_dynamic_field_names(target: Any) -> tuple[str, ...]:
    names: set[str] = set()
    if hasattr(target, "__dict__"):
        names.update(vars(target).keys())

    raw_slots = getattr(target.__class__, "__slots__", ())
    slots = (raw_slots,) if isinstance(raw_slots, str) else tuple(raw_slots)
    for slot in slots:
        if slot in {"__dict__", "__weakref__"}:
            continue
        if hasattr(target, slot):
            names.add(slot)

    return tuple(sorted(names))


def _target_has_field(cls: type[Any], field: str, target: Any | None) -> bool:
    if target is not None:
        dynamic_names = _target_dynamic_field_names(target)
        if field in dynamic_names:
            return True
        try:
            if field in dir(target):
                return True
        except Exception:
            pass

    annotations = getattr(cls, "__annotations__", {})
    return hasattr(cls, field) or field in annotations


def _resolve_selector_projector_field_spec(
    cls: type[Any], selector: str
) -> ResolvedProjectorFieldSpec[str]:
    if "." not in selector and "[" not in selector:
        maybe_callable = getattr(cls, selector, None)
        if callable(maybe_callable):
            return ResolvedProjectorFieldSpec("callable", maybe_callable)
    return ResolvedProjectorFieldSpec("selector", selector)


def _infer_same_name_projector_field_spec(
    cls: type[Any], field: str, *, target: Any | None
) -> ResolvedProjectorFieldSpec[str] | None:
    if not _target_has_field(cls, field, target):
        return None
    return _resolve_selector_projector_field_spec(cls, field)


def _resolve_raw_projector_field_spec(  # noqa: PLR0911
    cls: type[Any],
    field: str,
    raw_value: ProjectorFieldForInit,
) -> ResolvedProjectorFieldSpec[str] | ProjectorAuto | None:
    if raw_value is AUTO:
        return AUTO
    if raw_value is SKIP:
        return None
    if raw_value is None:
        return AUTO
    if isinstance(raw_value, ProjectorAttrSelector):
        return _resolve_selector_projector_field_spec(cls, raw_value.path)
    if isinstance(raw_value, ProjectorLiteralValue):
        return ResolvedProjectorFieldSpec("literal", raw_value.data)
    if isinstance(raw_value, bool):
        if field in _BOOLEAN_LITERAL_FIELDS:
            return ResolvedProjectorFieldSpec("literal", raw_value)
        if raw_value is False:
            return None
        return _resolve_selector_projector_field_spec(cls, field)
    if callable(raw_value):
        return ResolvedProjectorFieldSpec("callable", raw_value)
    if isinstance(raw_value, str):
        if _is_special_literal_string(field, raw_value):
            return ResolvedProjectorFieldSpec("literal", raw_value)
        return _resolve_selector_projector_field_spec(cls, raw_value)
    if isinstance(raw_value, Number):
        return ResolvedProjectorFieldSpec("literal", raw_value)
    raise TypeError(
        f"Field {field!r} on {cls.__name__} does not support values of type "
        f"{type(raw_value).__name__}; use value(...) for non-scalar literals."
    )


def resolve_projector_field_specs(
    cls: type[Any],
    projector_dict_init: ProjectorDictForInit[TField] | MetadataDictForInit[TField],
    fields: ProjectorDictFilterList[TField],
    default_fields: AttrPathMap[TField],
    *,
    target: Any | None = None,
) -> dict[TField, ResolvedProjectorFieldSpec[TField]]:
    projector_dict: dict[TField, ResolvedProjectorFieldSpec[TField]] = {}
    infer_fields: list[TField] = []

    for field, raw_value in projector_dict_init.items():
        resolved = _resolve_raw_projector_field_spec(cls, field, raw_value)
        if resolved is None:
            continue
        if resolved is AUTO:
            infer_fields.append(field)
            continue
        projector_dict[field] = cast(ResolvedProjectorFieldSpec[TField], resolved)

    def add_defaults(defaults: AttrPathMap[TField]) -> None:
        for field in list(infer_fields):
            selector = defaults.get(field, None)
            if selector is not None:
                projector_dict[field] = cast(
                    ResolvedProjectorFieldSpec[TField],
                    _resolve_selector_projector_field_spec(cls, selector),
                )
                infer_fields.remove(field)

    for check_fn, defaults in fields:
        if not infer_fields:
            break
        if not check_fn(cls):
            continue
        add_defaults(defaults)
    add_defaults(default_fields)

    for field in infer_fields:
        inferred = _infer_same_name_projector_field_spec(cls, field, target=target)
        if inferred is not None:
            projector_dict[field] = cast(ResolvedProjectorFieldSpec[TField], inferred)
    return projector_dict


def make_field_spec_projector(
    field_specs: dict[TField, ResolvedProjectorFieldSpec[TField]],
) -> AttrProjector[Any, TField]:
    selector_mapping: dict[TField, str] = {}
    hashable_literals: dict[TField, Any] = {}
    dynamic_literals: dict[TField, Any] = {}
    callables: dict[TField, Callable[[Any], Any]] = {}

    for field, spec in field_specs.items():
        if spec.kind == "selector":
            selector_mapping[field] = cast(str, spec.value)
        elif spec.kind == "callable":
            callables[field] = cast(Callable[[Any], Any], spec.value)
        elif isinstance(spec.value, Hashable):
            hashable_literals[field] = spec.value
        else:
            dynamic_literals[field] = spec.value

    base_projector: AttrProjector[Any, TField] | None = None
    if selector_mapping or hashable_literals:
        base_projector = cast(
            AttrProjector[Any, TField],
            make_attr_projector([], selector_mapping, hashable_literals),
        )

    if not dynamic_literals and not callables:
        if base_projector is not None:
            return base_projector

        def empty_projector(_target: Any) -> dict[TField, Any]:
            return {}

        return empty_projector

    def projector(target: Any) -> dict[TField, Any]:
        result: dict[TField, Any] = (
            dict(base_projector(target)) if base_projector is not None else {}
        )
        for field, literal in dynamic_literals.items():
            result[field] = literal
        for field, getter in callables.items():
            result[field] = getter(target)
        return result

    return projector


def make_projector_for_target(  # noqa: PLR0913
    cls: type[Any],
    projector_dict_init: ProjectorDictForInit[TField] | MetadataDictForInit[TField],
    fields: ProjectorDictFilterList[TField],
    default_fields: AttrPathMap[TField],
    *,
    required_fields: tuple[TField, ...] = (),
    target: Any | None = None,
) -> AttrProjector[Any, TField]:
    field_specs = resolve_projector_field_specs(
        cls,
        projector_dict_init,
        fields,
        default_fields,
        target=target,
    )
    missing_fields = [field for field in required_fields if field not in field_specs]
    assert not missing_fields, f"Missing required projector fields: {missing_fields}"
    return make_field_spec_projector(field_specs)


def resolve_layer_getter(
    cls: type[Any],
    raw_value: AttrGetter[Any] | ProjectorField | bool | ProjectorFieldDirective | None,
) -> AttrGetter[Any] | None:
    # Resolution order: sentinel, direct callable, class callable, attr getter.
    if (
        raw_value is None
        or raw_value is False
        or raw_value is AUTO
        or raw_value is SKIP
    ):
        return None
    if raw_value is True:
        raise TypeError(
            f"Layer iterable projector on {cls.__name__} does not support True."
        )
    if isinstance(raw_value, ProjectorAttrSelector):
        raw_value = raw_value.path
    if isinstance(raw_value, ProjectorLiteralValue):
        raise TypeError(
            f"Layer getter on {cls.__name__} does not support literal values."
        )
    if not isinstance(raw_value, str):
        if callable(raw_value):
            return cast(AttrGetter[Any], raw_value)
        raise TypeError(
            f"Layer getter on {cls.__name__} does not support "
            f"{type(raw_value).__name__} values."
        )
    maybe_callable = getattr(cls, raw_value, None)
    if callable(maybe_callable):
        return cast(AttrGetter[Any], maybe_callable)
    return make_attr_getter(raw_value)
