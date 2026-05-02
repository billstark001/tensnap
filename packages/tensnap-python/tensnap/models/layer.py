from collections.abc import Callable
from dataclasses import dataclass, field
import inspect
from typing import (
    Any,
    Dict,
    Generic,
    List,
    Literal,
    Protocol,
    TypeAlias,
    TypedDict,
    TypeVar,
    cast,
)

from typing_extensions import NotRequired

from tensnap.utils.attr import (
    make_attr_projector,
    make_attr_getter,
    AttrProjector,
    AttrGetter,
)

TObj = TypeVar("TObj")
TKey = TypeVar("TKey", bound=str)


TLayer = TypeVar("TLayer")
TItem = TypeVar("TItem")
TLayerFieldKeys = TypeVar("TLayerFieldKeys", bound=str)
TItemFieldKeys = TypeVar("TItemFieldKeys", bound=str)


DynamicAttrProjector: TypeAlias = Callable[[TLayer, TObj], Dict[TKey, Any]]
ItemsProjector: TypeAlias = Callable[[TLayer], List[Dict[TKey, Any]]]

_ITEM_PROJ_TYPE_ITEMS = 0
_ITEM_PROJ_TYPE_DYNAMIC = 1
_ITEM_PROJ_TYPE_STATIC = 2

ItemProjectionType: TypeAlias = Literal[0, 1, 2]


# region Environment Layer

class EnvLayerCreatePayload(TypedDict, Generic[TLayerFieldKeys]):
    env_id: str
    layer_id: str
    layer_type: str
    dependency_layer_ids: NotRequired[List[str]]
    data: NotRequired[Dict[TLayerFieldKeys, Any]]


class EnvLayerUpdatePayload(TypedDict, Generic[TLayerFieldKeys]):
    env_id: str
    layer_id: str
    data: Dict[TLayerFieldKeys, Any]


class EnvLayerDeletePayload(TypedDict):
    env_id: str
    layer_id: str


@dataclass(slots=True)
class LayerBinding(Generic[TLayer, TLayerFieldKeys, TItem, TItemFieldKeys]):

    layer_id: str
    layer_type: str
    dependency_layer_ids: List[str] = field(default_factory=list)

    metadata_projector: AttrProjector[TLayer, TLayerFieldKeys] | None = None

    iterable_getter: AttrGetter[TLayer] | None = None
    item_projector: AttrProjector[TItem, TItemFieldKeys] | None = None
    item_dynamic_projector: (
        DynamicAttrProjector[TLayer, TItem, TItemFieldKeys] | None
    ) = None
    item_changed_getter: AttrGetter[TItem] | None = None
    items_projector: ItemsProjector[TLayer, TItemFieldKeys] | None = None

    item_projection_type: ItemProjectionType = field(init=False)

    def __post_init__(self):
        has_iterable = self.iterable_getter is not None
        has_item_proj = self.item_projector is not None
        has_dynamic_proj = self.item_dynamic_projector is not None
        has_items_proj = self.items_projector is not None

        # all available combinations
        use_item_proj = has_iterable and has_item_proj
        use_dynamic_proj = has_iterable and has_dynamic_proj
        use_items_proj = has_items_proj

        possible_combinations = sum([use_item_proj, use_dynamic_proj, use_items_proj])
        if possible_combinations == 0:
            raise ValueError(
                f"LayerBinding {self.layer_id} must have one of the following:\n"
                "- iterable_getter + item_projector\n"
                "- iterable_getter + item_dynamic_projector\n"
                "- items_projector"
            )
        if possible_combinations > 1:
            raise ValueError(
                f"LayerBinding {self.layer_id} has multiple item projection methods defined. "
                "Only one of the following is allowed:\n"
                "- iterable_getter + item_projector\n"
                "- iterable_getter + item_dynamic_projector\n"
                "- items_projector"
            )

        if use_item_proj:
            self.item_projection_type = _ITEM_PROJ_TYPE_STATIC
        elif use_dynamic_proj:
            self.item_projection_type = _ITEM_PROJ_TYPE_DYNAMIC
        else:
            self.item_projection_type = _ITEM_PROJ_TYPE_ITEMS

    def build_metadata(self, layer: TLayer) -> Dict[TLayerFieldKeys, Any] | None:
        if self.metadata_projector is None:
            return None
        return self.metadata_projector(layer)

    def build_item_list(self, layer: TLayer) -> List[Dict[TItemFieldKeys, Any]]:
        if self.item_projection_type == _ITEM_PROJ_TYPE_ITEMS:
            assert self.items_projector is not None
            return self.items_projector(layer)

        assert self.iterable_getter is not None
        items = self.iterable_getter(layer)
        if self.item_projection_type == _ITEM_PROJ_TYPE_STATIC:
            assert self.item_projector is not None
            return [self.item_projector(item) for item in items]
        assert self.item_dynamic_projector is not None
        return [self.item_dynamic_projector(layer, item) for item in items]



    def build_create_payload(
        self, env_id: str, layer: TLayer
    ) -> EnvLayerCreatePayload[TLayerFieldKeys]:
        payload: EnvLayerCreatePayload[TLayerFieldKeys] = {
            "env_id": env_id,
            "layer_id": self.layer_id,
            "layer_type": self.layer_type,
        }
        if self.dependency_layer_ids:
            payload["dependency_layer_ids"] = self.dependency_layer_ids
        metadata = self.build_metadata(layer)
        if metadata:
            payload["data"] = metadata
        return payload

    def build_update_payload(
        self, env_id: str, layer: TLayer
    ) -> EnvLayerUpdatePayload[TLayerFieldKeys]:
        metadata = self.build_metadata(layer)
        if metadata is None:
            raise ValueError(
                f"Cannot build update payload for layer {self.layer_id} without metadata."
            )
        return {
            "env_id": env_id,
            "layer_id": self.layer_id,
            "data": metadata,
        }

    def build_delete_payload(self, env_id: str) -> EnvLayerDeletePayload:
        return {
            "env_id": env_id,
            "layer_id": self.layer_id,
        }

# endregion