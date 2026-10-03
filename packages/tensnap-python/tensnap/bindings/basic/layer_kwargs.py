"""Typed keyword groups and one splitter for declarative layer builders."""

from __future__ import annotations

from collections.abc import Callable, Hashable, Iterable, Mapping
from typing import Any, Generic, Literal, TypeAlias, TypeVar, cast

from typing_extensions import TypedDict

from tensnap.models import (
    AgentItemFields,
    EdgeItemFields,
    ProjectorField,
    ProjectorFieldForInit,
    TrajectoryConfigItemFields,
)
from tensnap.models.layer import DynamicAttrProjector, ItemsProjector
from tensnap.utils.attr import AttrProjector

TItemKeys = TypeVar("TItemKeys", bound=str)
TMetadataKeys = TypeVar("TMetadataKeys", bound=str)
TControl = TypeVar("TControl")
TValue = TypeVar("TValue")

LayerItemProjectorForInit: TypeAlias = (
    AttrProjector[Any, TItemKeys]
    | DynamicAttrProjector[Any, Any, TItemKeys]
    | type[object]
    | str
)
LayerItemsProjectorForInit: TypeAlias = ItemsProjector[Any, TItemKeys] | str
ItemGetterForInit: TypeAlias = (
    Callable[[Any], TValue] | ProjectorField | Literal[False] | None
)


# mypy 2.3 does not model PEP 728's extra_items argument; Pyright checks it.
class LayerMetadataKwargs(TypedDict, extra_items=ProjectorFieldForInit):  # type: ignore[call-arg]
    """Extensible selector map for custom layer metadata (PEP 728)."""


# Keep custom metadata usable in mypy until it implements extra_items. Pyright
# checks the PEP 728 branch; all alternatives constrain metadata values.
LayerMetadataOptions: TypeAlias = (
    LayerMetadataKwargs
    | Mapping[TMetadataKeys, ProjectorFieldForInit]
    | Mapping[str, ProjectorFieldForInit]
)


class ItemLayerKwargs(TypedDict, Generic[TItemKeys], total=False):
    item_iterable_projector: ItemGetterForInit[Iterable[object]]
    item_projector: LayerItemProjectorForInit[TItemKeys] | None
    item_dynamic_projector: DynamicAttrProjector[Any, Any, TItemKeys] | str | None
    item_id_getter: ItemGetterForInit[Hashable]
    item_changed_getter: ItemGetterForInit[bool]
    items_projector: LayerItemsProjectorForInit[TItemKeys] | None


class BackgroundLayerKwargs(TypedDict, total=False, closed=True):
    background: ProjectorFieldForInit
    interpolation: ProjectorFieldForInit
    z_index: ProjectorFieldForInit


class GridLayerKwargs(TypedDict, total=False, closed=True):
    width: ProjectorFieldForInit
    height: ProjectorFieldForInit
    x_origin: ProjectorFieldForInit
    x_unit: ProjectorFieldForInit
    x_interval: ProjectorFieldForInit
    x_ratio: ProjectorFieldForInit
    y_origin: ProjectorFieldForInit
    y_unit: ProjectorFieldForInit
    y_interval: ProjectorFieldForInit
    y_ratio: ProjectorFieldForInit
    stroke_color: ProjectorFieldForInit
    z_index: ProjectorFieldForInit


class AgentLayerKwargs(ItemLayerKwargs[AgentItemFields], total=False, closed=True):
    uniform: bool
    width: ProjectorFieldForInit
    height: ProjectorFieldForInit
    coord_offset: ProjectorFieldForInit
    z_index: ProjectorFieldForInit


class SourceAgentLayerMetadataKwargs(TypedDict, total=False, closed=True):
    width: ProjectorFieldForInit
    height: ProjectorFieldForInit
    coord_offset: ProjectorFieldForInit
    z_index: ProjectorFieldForInit


class MatrixAgentLayerMetadataKwargs(TypedDict, total=False, closed=True):
    z_index: ProjectorFieldForInit


class EdgeLayerKwargs(ItemLayerKwargs[EdgeItemFields], total=False, closed=True):
    link_distance: ProjectorFieldForInit
    charge_strength: ProjectorFieldForInit
    centering_strength: ProjectorFieldForInit
    collision_radius: ProjectorFieldForInit
    max_component_distance: ProjectorFieldForInit
    component_spacing: ProjectorFieldForInit
    z_index: ProjectorFieldForInit
    agent_layer_id: str


class TrajectoryLayerKwargs(
    ItemLayerKwargs[TrajectoryConfigItemFields], total=False, closed=True
):
    length: ProjectorFieldForInit
    width: ProjectorFieldForInit
    color: ProjectorFieldForInit
    z_index: ProjectorFieldForInit
    on_agent_delete: ProjectorFieldForInit
    on_state_sync: ProjectorFieldForInit
    on_reset: ProjectorFieldForInit
    agent_layer_id: str


ITEM_KWARGS = frozenset(ItemLayerKwargs.__annotations__)


def merge_layer_metadata(
    defaults: Mapping[TMetadataKeys, ProjectorFieldForInit],
    direct: Mapping[str, object],
    metadata: LayerMetadataOptions[TMetadataKeys] | None,
    *,
    derived_keys: frozenset[str] = frozenset(),
) -> dict[TMetadataKeys, ProjectorFieldForInit]:
    """Combine fixed shortcuts and extensible metadata without precedence rules."""
    if metadata is not None and not isinstance(metadata, Mapping):
        raise TypeError("metadata must be a mapping")
    nested = cast(Mapping[str, ProjectorFieldForInit], metadata or {})
    reserved = set(nested) & derived_keys
    if reserved:
        raise TypeError(
            f"derived layer metadata cannot be set: {', '.join(sorted(reserved))}"
        )
    duplicate = set(nested) & set(direct)
    if duplicate:
        raise TypeError(
            f"layer metadata declared twice: {', '.join(sorted(duplicate))}"
        )
    result = dict(defaults)
    result.update(cast(Mapping[TMetadataKeys, ProjectorFieldForInit], nested))
    result.update(cast(Mapping[TMetadataKeys, ProjectorFieldForInit], direct))
    return result


def split_layer_kwargs(
    kwargs: Mapping[str, object],
    *,
    metadata_keys: tuple[TMetadataKeys, ...] = (),
    metadata_options: LayerMetadataOptions[TMetadataKeys] | None = None,
    item_keys: frozenset[str] = frozenset(),
    control_defaults: Mapping[str, TControl] | None = None,
) -> tuple[
    dict[TMetadataKeys, ProjectorFieldForInit], dict[str, object], dict[str, TControl]
]:
    """Validate and split a large layer kwargs set once at registration.

    Every metadata key is present in the result, including omitted keys with
    ``None``. That preserves the existing same-name field inference behavior.
    """

    controls = dict(control_defaults or {})
    allowed = set(metadata_keys) | item_keys | controls.keys()
    unknown = set(kwargs) - allowed
    if unknown:
        raise TypeError(f"unknown layer options: {', '.join(sorted(unknown))}")
    inferred_metadata = cast(
        dict[TMetadataKeys, ProjectorFieldForInit],
        {key: kwargs.get(key) for key in metadata_keys},
    )
    direct_metadata = {key: kwargs[key] for key in metadata_keys if key in kwargs}
    metadata = merge_layer_metadata(
        inferred_metadata,
        cast(Mapping[str, object], direct_metadata),
        metadata_options,
    )
    items = {key: kwargs.get(key) for key in item_keys}
    overrides = {key: kwargs[key] for key in controls if key in kwargs}
    controls.update(cast(dict[str, TControl], overrides))
    return metadata, items, controls


def split_item_layer_kwargs(
    kwargs: ItemLayerKwargs[TItemKeys],
    *,
    metadata_keys: tuple[TMetadataKeys, ...],
    metadata_options: LayerMetadataOptions[TMetadataKeys] | None = None,
    control_defaults: Mapping[str, TControl],
) -> tuple[
    dict[TMetadataKeys, ProjectorFieldForInit],
    ItemLayerKwargs[TItemKeys],
    dict[str, TControl],
]:
    """Preserve the item-key parameter through the common splitter."""
    metadata, items, controls = split_layer_kwargs(
        kwargs,
        metadata_keys=metadata_keys,
        metadata_options=metadata_options,
        item_keys=ITEM_KWARGS,
        control_defaults=control_defaults,
    )
    return metadata, cast(ItemLayerKwargs[TItemKeys], items), controls
