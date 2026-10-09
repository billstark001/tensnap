"""Agent layer bindings for entities, mappings, indexed values, and matrices."""

from __future__ import annotations

import ast
from collections.abc import Callable, Iterable, Mapping
from typing import Any, TypeVar, cast

from typing_extensions import Unpack

from tensnap.models import AgentItemFields, AgentLayerMetadataFields
from tensnap.models.source import KeyedSource, SourceKey, SourceKeyCodec

from ._agent_layer_source import (
    _CELL_ID,
    _NO_DEFAULT,
    BindSourceAgentLayerConfig,
    ChangeGetter,
    ContainerGetter,
    SourceProjector,
    SourceSelector,
    TSourceMetadataKeys,
    _cell_id,
    _identity,
    _map_id,
    _resolve_changes,
    _source_metadata,
    _source_projection_plan,
    _visual_shortcuts,
    xy_key_codec as xy_key_codec,  # noqa: PLC0414 - public module export
)
from .layer import BindAgentConfig, BindLayerConfig, BindUniformAgentConfig
from .layer_kwargs import (
    AgentLayerKwargs,
    LayerMetadataOptions,
    MatrixAgentLayerMetadataKwargs,
    SourceAgentLayerMetadataKwargs,
    split_item_layer_kwargs,
)
from .layer_utils import _identity_item_to_dict, resolve_layer_getter

TClass = TypeVar("TClass")


class BindAgentLayerConfig(BindLayerConfig[AgentLayerMetadataFields, AgentItemFields]):
    def __init__(
        self,
        layer_id: str = "agents",
        *,
        metadata: LayerMetadataOptions[AgentLayerMetadataFields] | None = None,
        **kwargs: Unpack[AgentLayerKwargs],
    ) -> None:
        metadata, items, controls = split_item_layer_kwargs(
            kwargs,
            metadata_keys=("width", "height", "coord_offset", "z_index"),
            metadata_options=metadata,
            control_defaults={"uniform": False},
        )
        resolved_iterable = items.get("item_iterable_projector")
        if resolved_iterable is None and items.get("items_projector") is None:
            resolved_iterable = layer_id
        items["item_iterable_projector"] = resolved_iterable

        super().__init__(
            layer_id,
            "agent",
            ("id",),
            metadata=metadata,
            **items,
            item_projector_name=(
                BindUniformAgentConfig.binding_name
                if controls["uniform"]
                else BindAgentConfig.binding_name
            ),
            inferred_item_projector=cast(
                Callable[[Any], dict[AgentItemFields, Any]],
                _identity_item_to_dict,
            ),
        )

    def __call__(self, cls: type[TClass]) -> type[TClass]:
        return self.attach(cls, [], {})


agent_layer = BindAgentLayerConfig


def map_agent_layer(  # noqa: PLR0913 - declarative source options are independent
    layer_id: str,
    *,
    source: ContainerGetter | None = None,
    project: SourceProjector | None = None,
    fields: Mapping[str, SourceSelector] | None = None,
    color: str | Callable[[Any, Any, Any], str] | None = None,
    icon: str | Callable[[Any, Any, Any], str] | None = None,
    size: int | float | Callable[[Any, Any, Any], int | float] | None = None,
    metadata: LayerMetadataOptions[TSourceMetadataKeys] | None = None,
    revision: ContainerGetter | None = None,
    changes: ChangeGetter | None = None,
    encode_key: Callable[[Any], SourceKey] = _map_id,
    decode_key: Callable[[SourceKey], Any] = _identity,
    key_codec: SourceKeyCodec[Any] | None = None,
    encode_value: Callable[[Any], Any] = _identity,
    decode_value: Callable[[Any], Any] = _identity,
    restore: bool = True,
    replace: str | Callable[[Any, Any], Any] | None = None,
    **metadata_kwargs: Unpack[SourceAgentLayerMetadataKwargs],
) -> BindSourceAgentLayerConfig[TSourceMetadataKeys]:
    """Bind mapping entries directly, with optional revisioned changes."""
    if (revision is None) != (changes is None):
        raise ValueError("revision and changes must be declared together")
    if key_codec is not None:
        if encode_key is not _map_id or decode_key is not _identity:
            raise ValueError("use key_codec or encode_key/decode_key, not both")
        encode_key, decode_key = key_codec.encode, key_codec.decode
    source_selector = layer_id if source is None else source
    shortcuts = {
        name: option
        for name, option in (("color", color), ("icon", icon), ("size", size))
        if option is not None
    }
    visual = _visual_shortcuts(project, fields, shortcuts)
    layer_metadata = _source_metadata(
        metadata,
        metadata_kwargs,
        allowed=frozenset(SourceAgentLayerMetadataKwargs.__annotations__),
    )

    def factory(owner: type[Any]) -> KeyedSource:
        get = resolve_layer_getter(owner, source_selector)
        assert get is not None
        get_revision = resolve_layer_getter(owner, revision)
        get_changes = _resolve_changes(owner, changes)

        def project_entry(model: Any, key: Any, value: Any) -> dict[str, Any]:
            record = dict(visual(model, key, value))
            if restore:
                data = record.get("data", {})
                if not isinstance(data, dict):
                    raise TypeError("source projector data must be a dictionary")
                record["data"] = {**data, "value": encode_value(value)}
            return record

        setattr(  # noqa: B010 - callable metadata is attached at runtime
            project_entry,
            "inline_diagnostics",
            getattr(visual, "inline_diagnostics", {}),
        )

        return KeyedSource(
            entries=lambda model: get(model).items(),
            read=lambda model, key: get(model)[key],
            encode_key=encode_key,
            project=project_entry,
            revision=get_revision,
            changes=get_changes,
        )

    def prepare(_model: Any, layer: dict[str, Any]) -> dict[Any, Any]:
        result: dict[Any, Any] = {}
        for item in layer.get("items", []):
            item_id = item.get("id")
            key = decode_key(item_id)
            if encode_key(key) != item_id or key in result:
                raise ValueError(f"invalid or duplicate map key: {item_id!r}")
            data = item.get("data")
            if not isinstance(data, dict) or "value" not in data:
                raise ValueError(f"map item {item_id!r} has no data.value")
            result[key] = decode_value(data["value"])
        return result

    return BindSourceAgentLayerConfig(
        layer_id,
        factory,
        metadata=layer_metadata,
        restore_prepare=prepare if restore else None,
        restore_replace=replace,
        source_name=source_selector,
    )


def indexed_agent_layer(  # noqa: PLR0913 - independent source accessors
    layer_id: str,
    *,
    keys: ContainerGetter,
    read: str | Callable[[Any, Any], Any],
    project: SourceProjector | None = None,
    fields: Mapping[str, SourceSelector] | None = None,
    color: str | Callable[[Any, Any, Any], str] | None = None,
    icon: str | Callable[[Any, Any, Any], str] | None = None,
    size: int | float | Callable[[Any, Any, Any], int | float] | None = None,
    metadata: LayerMetadataOptions[TSourceMetadataKeys] | None = None,
    revision: ContainerGetter | None = None,
    changes: ChangeGetter | None = None,
    encode_key: Callable[[Any], SourceKey] = _map_id,
    **metadata_kwargs: Unpack[SourceAgentLayerMetadataKwargs],
) -> BindSourceAgentLayerConfig[TSourceMetadataKeys]:
    """Bind stable IDs to columnar or indexed state without entity objects.

    Projected restore is explicit for this general storage form; attach a
    ``@layer_restore`` inverse when its columns can be reconstructed.
    """
    if (revision is None) != (changes is None):
        raise ValueError("revision and changes must be declared together")
    shortcuts = {
        name: option
        for name, option in (("color", color), ("icon", icon), ("size", size))
        if option is not None
    }
    projector = _visual_shortcuts(project, fields, shortcuts)
    layer_metadata = _source_metadata(
        metadata,
        metadata_kwargs,
        allowed=frozenset(SourceAgentLayerMetadataKwargs.__annotations__),
    )

    def factory(owner: type[Any]) -> KeyedSource:
        get_keys = resolve_layer_getter(owner, keys)
        assert get_keys is not None
        if isinstance(read, str):
            get_value = getattr(owner, read, None)
            if not callable(get_value):
                raise ValueError(f"cannot resolve source reader {read!r}")
        else:
            get_value = read
        get_revision = resolve_layer_getter(owner, revision)
        get_changes = _resolve_changes(owner, changes)
        return KeyedSource(
            entries=lambda model: (
                (key, get_value(model, key)) for key in get_keys(model)
            ),
            read=get_value,
            encode_key=encode_key,
            project=projector,
            revision=get_revision,
            changes=get_changes,
        )

    return BindSourceAgentLayerConfig(layer_id, factory, metadata=layer_metadata)


def matrix_agent_layer(  # noqa: PLR0913, PLR0915 - independent source/restore options
    layer_id: str,
    *,
    source: ContainerGetter | None = None,
    project: Callable[[Any, int, int, Any], dict[str, Any]] | None = None,
    fields: Mapping[str, SourceSelector] | None = None,
    color: str | Callable[[Any, int, int, Any], str] | None = None,
    icon: str | Callable[[Any, int, int, Any], str] | None = None,
    size: int | float | Callable[[Any, int, int, Any], int | float] | None = None,
    metadata: LayerMetadataOptions[AgentLayerMetadataFields] | None = None,
    revision: ContainerGetter | None = None,
    changes: ChangeGetter | None = None,
    sparse_default: Any = _NO_DEFAULT,
    encode_value: Callable[[Any], Any] = _identity,
    decode_value: Callable[[Any], Any] = _identity,
    restore: bool = True,
    replace: str | Callable[[Any, Any], Any] | None = None,
    **metadata_kwargs: Unpack[MatrixAgentLayerMetadataKwargs],
) -> BindSourceAgentLayerConfig[AgentLayerMetadataFields]:
    """Bind a rectangular row-indexed matrix; logical row zero is at the top."""
    if (revision is None) != (changes is None):
        raise ValueError("revision and changes must be declared together")
    if project is not None and fields is not None:
        raise ValueError("use project or fields, not both")
    shortcuts = {
        name: option
        for name, option in (("color", color), ("icon", icon), ("size", size))
        if option is not None
    }
    if project is not None and shortcuts:
        raise ValueError("use project or visual field shortcuts, not both")
    duplicate = set(fields or {}) & set(shortcuts)
    if duplicate:
        raise ValueError(f"visual field declared twice: {', '.join(sorted(duplicate))}")
    field_plan = _source_projection_plan(
        fields or {},
        ("model", "row", "col", "value"),
        callable_arguments=("model", "key", "value"),
    )
    field_plan.local(
        "key",
        ast.Tuple(
            elts=[
                ast.Name(id="row", ctx=ast.Load()),
                ast.Name(id="col", ctx=ast.Load()),
            ],
            ctx=ast.Load(),
        ),
    )
    for name, option in shortcuts.items():
        if callable(option):
            field_plan.callable(name, option)
        else:
            field_plan.literal(name, option)
    field_project = field_plan.compile()
    source_selector = layer_id if source is None else source
    layer_metadata = _source_metadata(
        metadata,
        metadata_kwargs,
        allowed=frozenset(MatrixAgentLayerMetadataKwargs.__annotations__),
        derived=frozenset({"width", "height", "coord_offset"}),
    )

    def factory(owner: type[Any]) -> KeyedSource:
        get = resolve_layer_getter(owner, source_selector)
        assert get is not None
        get_revision = resolve_layer_getter(owner, revision)
        get_changes = _resolve_changes(owner, changes)

        def shape(model: Any) -> tuple[int, int]:
            matrix = get(model)
            height = len(matrix)
            width = len(matrix[0]) if height else 0
            return height, width

        def entries(model: Any) -> Iterable[tuple[tuple[int, int], Any]]:
            matrix = get(model)
            height, width = shape(model)
            for row in range(height):
                if len(matrix[row]) != width:
                    raise ValueError("matrix source must be rectangular")
                for col in range(width):
                    yield (row, col), matrix[row][col]

        def project_cell(model: Any, key: Any, value: Any) -> dict[str, Any]:
            row, col = key
            height = len(get(model))
            record = (
                dict(project(model, row, col, value))
                if project is not None
                else dict(field_project(model, row, col, value))
            )
            record.setdefault("icon", "square")
            record.setdefault("size", 1.0)
            x, y = col, height - 1 - row
            if ("x" in record and record["x"] != x) or (
                "y" in record and record["y"] != y
            ):
                raise ValueError("matrix projector cannot change cell coordinates")
            record.update(x=x, y=y)
            if restore:
                data = record.get("data", {})
                if not isinstance(data, dict):
                    raise TypeError("source projector data must be a dictionary")
                record["data"] = {**data, "value": encode_value(value)}
            return record

        setattr(  # noqa: B010 - callable metadata is attached at runtime
            project_cell,
            "inline_diagnostics",
            getattr(field_project, "inline_diagnostics", {}),
        )

        return KeyedSource(
            entries=entries,
            read=lambda model, key: get(model)[key[0]][key[1]],
            encode_key=_cell_id,
            project=project_cell,
            revision=get_revision,
            changes=get_changes,
            shape=shape,
            omit=(
                None
                if sparse_default is _NO_DEFAULT
                else lambda _model, _key, value: value == sparse_default
            ),
        )

    def prepare(_model: Any, layer: dict[str, Any]) -> list[list[Any]]:
        metadata = layer.get("metadata")
        if not isinstance(metadata, dict):
            raise ValueError("matrix restore requires width and height metadata")
        width, height = metadata.get("width"), metadata.get("height")
        if metadata.get("coord_offset") != "int":
            raise ValueError("matrix coord_offset must be 'int'")
        if type(width) is not int or type(height) is not int or width < 0 or height < 0:
            raise ValueError("matrix width and height must be nonnegative integers")
        matrix = [[sparse_default] * width for _ in range(height)]
        seen: set[tuple[int, int]] = set()
        for item in layer.get("items", []):
            match = _CELL_ID.fullmatch(str(item.get("id", "")))
            if match is None:
                raise ValueError("matrix item has an invalid id")
            row, col = map(int, match.groups())
            if row >= height or col >= width or (row, col) in seen:
                raise ValueError("matrix item is out of bounds or duplicated")
            if item.get("x") != col or item.get("y") != height - 1 - row:
                raise ValueError("matrix item coordinates do not match its id")
            data = item.get("data")
            if not isinstance(data, dict) or "value" not in data:
                raise ValueError("matrix item has no data.value")
            value = decode_value(data["value"])
            if sparse_default is not _NO_DEFAULT and value == sparse_default:
                raise ValueError(
                    "sparse default must be represented by an omitted cell"
                )
            matrix[row][col] = value
            seen.add((row, col))
        if sparse_default is _NO_DEFAULT and len(seen) != width * height:
            raise ValueError("dense matrix restore is missing cells")
        return matrix

    return BindSourceAgentLayerConfig(
        layer_id,
        factory,
        metadata=layer_metadata,
        restore_prepare=prepare if restore else None,
        restore_replace=replace,
        source_name=source_selector,
        matrix=True,
    )
