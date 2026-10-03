"""Shared projection, identity, and restore mechanics for agent source layers."""

from __future__ import annotations

import ast
import re
from collections.abc import Callable, Mapping
from typing import Any, TypeAlias, cast

from typing_extensions import TypeVar as BackportedTypeVar

from tensnap.models import (
    AgentItemFields,
    AgentLayerMetadataFields,
    ProjectorFieldForInit,
)
from tensnap.models.layer import LayerBinding
from tensnap.models.source import KeyedSource, SourceBatch, SourceKey, SourceKeyCodec
from tensnap.utils.attr import AttrPathMap, validate_attr_path
from tensnap.utils.projection import ProjectionPlan

from .layer import BindLayerConfig
from .layer_kwargs import LayerMetadataOptions, merge_layer_metadata
from .layer_utils import (
    MetadataDictForInit,
    ProjectorAttrSelector,
    ProjectorDictFilterList,
    ProjectorLiteralValue,
)
from .restore_plan import _LayerRestore

TSourceMetadataKeys = BackportedTypeVar(
    "TSourceMetadataKeys", bound=str, default=AgentLayerMetadataFields
)

SourceSelector: TypeAlias = (
    str | Callable[..., Any] | ProjectorAttrSelector | ProjectorLiteralValue
    | int | float | bool | None
)
SourceProjector: TypeAlias = Callable[[Any, Any, Any], dict[str, Any]]
ContainerGetter: TypeAlias = str | Callable[[Any], Any]
ChangeGetter: TypeAlias = str | Callable[[Any, Any], SourceBatch | None]
_CELL_ID = re.compile(r"^cell:(0|[1-9][0-9]*):(0|[1-9][0-9]*)$")
_XY_COMPONENT = r"-?(?:0|[1-9][0-9]*)"
_XY_DIMENSIONS = 2
_MAX_SAFE_INTEGER = (1 << 53) - 1
_NO_DEFAULT = object()


def _identity(value: Any) -> Any:
    return value


def _map_id(key: Any) -> SourceKey:
    if isinstance(key, bool) or not isinstance(key, (str, int)):
        raise TypeError("map source keys must be strings or safe integers")
    if isinstance(key, int) and abs(key) > _MAX_SAFE_INTEGER:
        raise ValueError("map source integer key exceeds the JSON safe range")
    return key


def _cell_id(key: Any) -> str:
    row, col = key
    if not isinstance(row, int) or not isinstance(col, int) or row < 0 or col < 0:
        raise ValueError("matrix coordinates must be nonnegative integers")
    return f"cell:{row}:{col}"


def xy_key_codec(prefix: str) -> SourceKeyCodec[tuple[int, int]]:
    """Encode integer ``(x, y)`` map keys as stable ``prefix:x:y`` IDs."""
    if re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]*", prefix) is None:
        raise ValueError("coordinate key prefix must be a simple identifier")
    pattern = re.compile(rf"^{re.escape(prefix)}:({_XY_COMPONENT}):({_XY_COMPONENT})$")

    def encode(key: tuple[int, int]) -> str:
        if not isinstance(key, tuple) or len(key) != _XY_DIMENSIONS:
            raise TypeError("coordinate map key must be an (x, y) tuple")
        x, y = key
        if type(x) is not int or type(y) is not int:
            raise TypeError("coordinate map key values must be integers")
        if abs(x) > _MAX_SAFE_INTEGER or abs(y) > _MAX_SAFE_INTEGER:
            raise ValueError("coordinate map key exceeds the JSON safe range")
        return f"{prefix}:{x}:{y}"

    def decode(item_id: SourceKey) -> tuple[int, int]:
        match = pattern.fullmatch(item_id) if isinstance(item_id, str) else None
        if match is None:
            raise ValueError(f"invalid coordinate map ID: {item_id!r}")
        result = (int(match[1]), int(match[2]))
        if encode(result) != item_id:
            raise ValueError(f"noncanonical coordinate map ID: {item_id!r}")
        return result

    return SourceKeyCodec(encode, decode)


def _source_metadata(
    metadata: LayerMetadataOptions[TSourceMetadataKeys] | None,
    direct: Mapping[str, object],
    *,
    allowed: frozenset[str],
    derived: frozenset[str] = frozenset(),
) -> LayerMetadataOptions[TSourceMetadataKeys]:
    unknown = set(direct) - allowed
    if unknown:
        raise TypeError(f"unknown layer options: {', '.join(sorted(unknown))}")
    return merge_layer_metadata({}, direct, metadata, derived_keys=derived)


def _visual_shortcuts(
    project: SourceProjector | None,
    fields: Mapping[str, SourceSelector] | None,
    shortcuts: Mapping[str, object],
) -> SourceProjector:
    if project is not None and shortcuts:
        raise ValueError("use project or visual field shortcuts, not both")
    duplicate = set(fields or {}) & set(shortcuts)
    if duplicate:
        raise ValueError(f"visual field declared twice: {', '.join(sorted(duplicate))}")
    if project is not None:
        return project
    plan = _source_projection_plan(fields or {}, ("model", "key", "value"))
    for name, option in shortcuts.items():
        if callable(option):
            plan.callable(name, option)
        else:
            plan.literal(name, option)
    return cast(SourceProjector, plan.compile())


def _source_projection_plan(
    fields: Mapping[str, SourceSelector],
    arguments: tuple[str, ...],
    *,
    callable_arguments: tuple[str, ...] | None = None,
) -> ProjectionPlan:
    plan = ProjectionPlan(arguments)
    for name, selector in fields.items():
        if isinstance(selector, ProjectorLiteralValue):
            plan.literal(name, selector.data)
            continue
        if isinstance(selector, ProjectorAttrSelector):
            selector_text = selector.path
        elif callable(selector):
            plan.callable(name, selector, call_arguments=callable_arguments)
            continue
        elif isinstance(selector, str):
            selector_text = selector
        else:
            plan.literal(name, selector)
            continue
        roots: dict[str, ast.expr] = {
            arg: ast.Name(id=arg, ctx=ast.Load()) for arg in arguments
        }
        if callable_arguments is not None and "key" in callable_arguments:
            roots["key"] = ast.Name(id="key", ctx=ast.Load())
        if "key" in roots:
            roots["row"] = ast.Subscript(
                value=ast.Name(id="key", ctx=ast.Load()),
                slice=ast.Constant(0),
                ctx=ast.Load(),
            )
            roots["col"] = ast.Subscript(
                value=ast.Name(id="key", ctx=ast.Load()),
                slice=ast.Constant(1),
                ctx=ast.Load(),
            )
        root_match = re.match(r"^(model|key|value|row|col)(?=\.|\[|$)", selector_text)
        root = root_match.group() if root_match else "value"
        suffix = selector_text[len(root):] if root_match else f".{selector_text}"
        if root not in roots or (suffix and not validate_attr_path(f"base{suffix}")):
            raise ValueError(f"unsupported source selector: {selector_text!r}")
        expression: ast.expr = roots[root]
        if suffix:
            parsed = ast.parse(f"base{suffix}", mode="eval").body

            class ReplaceBase(ast.NodeTransformer):
                def __init__(self, base: ast.expr) -> None:
                    self.base = base

                def visit_Name(self, node: ast.Name) -> ast.expr:
                    return self.base if node.id == "base" else node

            expression = ReplaceBase(expression).visit(parsed)
        plan.expression(name, expression)
    return plan


def _resolve_changes(owner: type[Any], raw: ChangeGetter | None) -> Any:
    if isinstance(raw, str):
        result = getattr(owner, raw, None)
        if not callable(result):
            raise ValueError(f"cannot resolve source changes method {raw!r}")
        return result
    return raw


def _resolve_replacement(
    owner: type[Any],
    source: ContainerGetter | None,
    replace: str | Callable[[Any, Any], Any] | None,
) -> Callable[[Any, Any], Any] | None:
    if isinstance(replace, str):
        method = getattr(owner, replace, None)
        if not callable(method):
            raise ValueError(f"cannot resolve source replacement method {replace!r}")
        return cast(Callable[[Any, Any], Any], method)
    if replace is not None:
        return replace
    if isinstance(source, str) and source.isidentifier():
        return lambda model, value: setattr(model, source, value)
    return None


class BindSourceAgentLayerConfig(BindLayerConfig[TSourceMetadataKeys, AgentItemFields]):
    """Bind model-owned keyed data as agent items."""

    def __init__(  # noqa: PLR0913 - declarative source options are independent
        self,
        layer_id: str,
        source_factory: Callable[[type[Any]], KeyedSource],
        *,
        metadata: LayerMetadataOptions[TSourceMetadataKeys] | None = None,
        restore_prepare: Callable[[Any, dict[str, Any]], Any] | None = None,
        restore_replace: str | Callable[[Any, Any], Any] | None = None,
        source_name: ContainerGetter | None = None,
        matrix: bool = False,
    ) -> None:
        super().__init__(
            layer_id,
            "agent",
            ("id",),
            metadata=(
                cast(
                    MetadataDictForInit[TSourceMetadataKeys],
                    dict(cast(Mapping[str, ProjectorFieldForInit], metadata)),
                )
                if metadata
                else None
            ),
        )
        self._source_factory = source_factory
        self._restore_prepare = restore_prepare
        self._restore_replace = restore_replace
        self._source_name = source_name
        self._matrix = matrix

    def _build_binding(
        self,
        cls: type[Any],
        metadata_fields: ProjectorDictFilterList[TSourceMetadataKeys],
        metadata_default_fields: AttrPathMap[TSourceMetadataKeys],
        *,
        target: Any | None = None,
    ) -> LayerBinding[Any, TSourceMetadataKeys, Any, AgentItemFields]:
        source = self._source_factory(cls)
        metadata_projector = self._build_metadata_projector(
            cls, metadata_fields, metadata_default_fields, target=target
        )
        if self._matrix:
            user_metadata = metadata_projector

            def matrix_metadata(model: Any) -> dict[TSourceMetadataKeys, Any]:
                height, width = source.current_shape(model)
                result: dict[TSourceMetadataKeys, Any] = (
                    dict(user_metadata(model)) if user_metadata else {}
                )
                result.update(
                    cast(
                        dict[TSourceMetadataKeys, Any],
                        {"width": width, "height": height, "coord_offset": "int"},
                    )
                )
                return result

            metadata_projector = matrix_metadata

        restore = self.restore
        if restore is None and self._restore_prepare is not None and target is not None:
            replace = _resolve_replacement(
                cls, self._source_name, self._restore_replace
            )
            if replace is None:
                raise ValueError("restorable source needs a replacement setter")
            setter = replace
            prepare_restore = self._restore_prepare
            prepared: list[Any] = []

            def validate(layer: dict[str, Any]) -> None:
                if not self._matrix:
                    expected = (
                        metadata_projector(target)
                        if metadata_projector is not None
                        else None
                    )
                    incoming = layer.get("metadata")
                    if incoming is not None and not isinstance(incoming, dict):
                        raise ValueError("source layer metadata must be a dictionary")
                    if (incoming or None) != (expected or None):
                        raise ValueError(
                            "source layer metadata cannot be restored automatically"
                        )
                prepared[:] = [prepare_restore(target, layer)]

            def apply(_items: list[dict[str, Any]]) -> None:
                if not prepared:
                    raise ValueError("source restore was not prepared")
                replacement = prepared.pop()
                setter(target, replacement)

            restore = _LayerRestore(
                replace=apply, metadata=lambda _data: None, validate=validate
            )
        return LayerBinding(
            layer_id=self.layer_id,
            layer_type="agent",
            item_keys=("id",),
            metadata_projector=metadata_projector,
            restore=restore,
            source=source,
        )
