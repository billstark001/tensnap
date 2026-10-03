"""Agent layer bindings for entity objects and model-owned keyed data."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping
from typing import Any, TypeAlias, TypeVar, cast

from typing_extensions import TypeVar as BackportedTypeVar, Unpack

from tensnap.models import (
    AgentItemFields,
    AgentLayerMetadataFields,
    ProjectorFieldForInit,
)
from tensnap.models.layer import LayerBinding
from tensnap.models.source import KeyedSource, SourceBatch, SourceKey, SourceKeyCodec
from tensnap.utils.attr import AttrPathMap, make_attr_getter

from .layer import BindAgentConfig, BindLayerConfig, BindUniformAgentConfig
from .layer_kwargs import (
    AgentLayerKwargs,
    LayerMetadataOptions,
    MatrixAgentLayerMetadataKwargs,
    SourceAgentLayerMetadataKwargs,
    merge_layer_metadata,
    split_item_layer_kwargs,
)
from .layer_utils import (
    MetadataDictForInit,
    ProjectorDictFilterList,
    _identity_item_to_dict,
    resolve_layer_getter,
)
from .restore_plan import _LayerRestore

TClass = TypeVar("TClass")
TSourceMetadataKeys = BackportedTypeVar(
    "TSourceMetadataKeys", bound=str, default=AgentLayerMetadataFields
)

SourceSelector: TypeAlias = str | Callable[[Any, Any, Any], Any]
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
    base = _compile_projector(project, fields)

    def visual(model: Any, key: Any, value: Any) -> dict[str, Any]:
        record = dict(base(model, key, value))
        for name, option in shortcuts.items():
            record[name] = option(model, key, value) if callable(option) else option
        return record

    return visual


def _compile_selector(  # noqa: PLR0911 - one direct accessor per selector root
    selector: SourceSelector,
) -> Callable[[Any, Any, Any], Any]:
    if callable(selector):
        return selector
    if selector == "model":
        return lambda model, _key, _value: model
    if selector == "key":
        return lambda _model, key, _value: key
    if selector == "value":
        return lambda _model, _key, value: value
    if selector == "row":
        return lambda _model, key, _value: key[0]
    if selector == "col":
        return lambda _model, key, _value: key[1]
    root, separator, path = selector.partition(".")
    if not separator or root not in ("model", "key", "value", "row", "col"):
        raise ValueError(f"unsupported source selector: {selector!r}")
    getter: Callable[[Any], Any] = make_attr_getter(path)
    base = _compile_selector(root)
    return lambda model, key, value: getter(base(model, key, value))


def _compile_projector(
    project: SourceProjector | None,
    fields: Mapping[str, SourceSelector] | None,
) -> SourceProjector:
    if project is not None and fields is not None:
        raise ValueError("use project or fields, not both")
    if project is not None:
        return project
    compiled = {
        name: _compile_selector(selector) for name, selector in (fields or {}).items()
    }
    return lambda model, key, value: {
        name: selector(model, key, value) for name, selector in compiled.items()
    }


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
    field_project = _compile_projector(None, fields) if fields is not None else None
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
            height, _ = shape(model)
            record = (
                dict(project(model, row, col, value))
                if project is not None
                else dict(field_project(model, key, value))
                if field_project
                else {}
            )
            for name, option in shortcuts.items():
                record[name] = (
                    option(model, row, col, value) if callable(option) else option
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
