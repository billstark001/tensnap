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
    TYPE_CHECKING,
    Tuple,
    TypeAlias,
    TypedDict,
    TypeVar,
    Union,
    cast,
)

from typing_extensions import NotRequired

from tensnap.utils.attr import (
    make_attr_projector,
    make_attr_getter,
    AttrProjector,
    AttrGetter,
)
from tensnap.utils.object import dict_diff

if TYPE_CHECKING:
    from .environment import EnvironmentLayerState

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


# region Message Payloads


class EnvLayerCreatePayload(TypedDict, Generic[TLayerFieldKeys]):
    env_id: str
    layer_id: str
    layer_type: str
    dependency_layer_ids: NotRequired[Dict[str, str]]
    data: NotRequired[Dict[TLayerFieldKeys, Any]]


class EnvLayerUpdatePayload(TypedDict, Generic[TLayerFieldKeys]):
    env_id: str
    layer_id: str
    data: Dict[TLayerFieldKeys, Any]


class EnvLayerDeletePayload(TypedDict):
    env_id: str
    layer_id: str


# endregion


# region Environment Layer


@dataclass(slots=True)
class LayerBinding(Generic[TLayer, TLayerFieldKeys, TItem, TItemFieldKeys]):

    layer_id: str
    layer_type: str
    item_keys: Tuple[TItemFieldKeys, ...]
    dependency_layer_ids: Dict[str, str] = field(default_factory=dict)

    metadata_projector: AttrProjector[TLayer, TLayerFieldKeys] | None = None

    iterable_getter: AttrGetter[TLayer] | None = None
    item_projector: AttrProjector[TItem, TItemFieldKeys] | None = None
    item_dynamic_projector: (
        DynamicAttrProjector[TLayer, TItem, TItemFieldKeys] | None
    ) = None
    item_id_getter: AttrGetter[TItem] | None = None
    item_changed_getter: AttrGetter[TItem] | None = None
    items_projector: ItemsProjector[TLayer, TItemFieldKeys] | None = None

    item_projection_type: ItemProjectionType = field(init=False)
    has_item_diffing: bool = field(init=False)

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

        self.has_item_diffing = (
            self.item_id_getter is not None and self.item_changed_getter is not None
        ) and self.item_projection_type != _ITEM_PROJ_TYPE_ITEMS

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

    def get_item_id_naive(self, item: Dict[TItemFieldKeys, Any]) -> Tuple[Any, ...]:
        return tuple(item.get(key) for key in self.item_keys)

    def build_item_list_diff(
        self,
        layer: TLayer,
        last_items: Dict[Any, Dict[TItemFieldKeys, Any]],
    ):
        assert (
            self.has_item_diffing
        ), "Item diffing is not enabled for this LayerBinding."
        assert (
            self.item_id_getter is not None
            and self.item_changed_getter is not None
            and self.iterable_getter is not None
        )
        items = self.iterable_getter(layer)
        created: List[Dict[TItemFieldKeys, Any]] = []
        updated: List[Dict[TItemFieldKeys, Any]] = []
        deleted: List[Any] = []
        projector: AttrProjector[TItem, TItemFieldKeys] = (
            self.item_projector
            if self.item_projection_type == _ITEM_PROJ_TYPE_STATIC
            else (lambda item: self.item_dynamic_projector(layer, item))  # type: ignore
        )  # type: ignore
        current_ids = set()
        current_items: Dict[Any, Dict[TItemFieldKeys, Any]] = {
            k: v for k, v in last_items.items()
        }
        for item in items:
            item_id = self.item_id_getter(item)
            current_ids.add(item_id)
            item_changed = self.item_changed_getter(item)
            if item_id not in last_items:
                p = projector(item)
                created.append(p)
                current_items[item_id] = p
            elif item_changed:
                p = projector(item)
                updated.append(p)
                current_items[item_id] = p
        for item_id in last_items:
            if item_id not in current_ids:
                deleted.append(item_id)
                current_items.pop(item_id, None)
        return created, updated, deleted, current_items

    def build_item_list_diff_naive(
        self,
        layer: TLayer,
        last_items: Dict[Any, Dict[TItemFieldKeys, Any]],
    ):
        projected_items = self.build_item_list(layer)
        created: List[Dict[TItemFieldKeys, Any]] = []
        updated: List[Dict[TItemFieldKeys, Any]] = []
        deleted: List[Any] = []
        current_ids = set()
        current_items: Dict[Any, Dict[TItemFieldKeys, Any]] = {
            k: v for k, v in last_items.items()
        }
        for item in projected_items:
            item_id = self.get_item_id_naive(item)
            current_ids.add(item_id)
            if item_id not in last_items:
                created.append(item)
                current_items[item_id] = item
            else:
                diff = dict_diff(last_items[item_id], item)
                if diff:
                    for key in self.item_keys:
                        diff[key] = item.get(key)
                    updated.append(diff)
                current_items[item_id] = item
        for item_id in last_items:
            if item_id not in current_ids:
                deleted.append(item_id)
                current_items.pop(item_id, None)
        return created, updated, deleted, current_items

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


def layer_items_field_name(layer_type: str) -> str:
    if layer_type == "agent":
        return "agents"
    if layer_type == "edge":
        return "edges"
    return "items"


@dataclass(slots=True)
class LayerRegistration(Generic[TLayer, TLayerFieldKeys, TItem, TItemFieldKeys]):
    """Scenario-owned layer entry that binds a layer rule to its current target."""

    binding: LayerBinding[TLayer, TLayerFieldKeys, TItem, TItemFieldKeys]
    target: TLayer
    last_items: Dict[Any, Dict[TItemFieldKeys, Any]] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return self.binding.layer_id

    @property
    def layer_type(self) -> str:
        return self.binding.layer_type

    def set_target(self, target: TLayer) -> None:
        self.target = target

    def reset_diff_state(self) -> None:
        self.last_items.clear()

    def build_state(self) -> "EnvironmentLayerState":
        layer: Dict[str, Any] = {
            "layer_id": self.binding.layer_id,
            "layer_type": self.binding.layer_type,
        }
        if self.binding.dependency_layer_ids:
            layer["dependency_layer_ids"] = dict(self.binding.dependency_layer_ids)

        metadata = self.binding.build_metadata(self.target)
        if metadata:
            layer["data"] = metadata

        items = self.binding.build_item_list(self.target)
        if items:
            layer[layer_items_field_name(self.binding.layer_type)] = items

        return cast("EnvironmentLayerState", layer)

    def build_create_payload(self, env_id: str) -> EnvLayerCreatePayload[TLayerFieldKeys]:
        return self.binding.build_create_payload(env_id, self.target)

    def build_update_payload(self, env_id: str) -> EnvLayerUpdatePayload[TLayerFieldKeys]:
        return self.binding.build_update_payload(env_id, self.target)

    def build_delete_payload(self, env_id: str) -> EnvLayerDeletePayload:
        return self.binding.build_delete_payload(env_id)

    def build_item_deltas(
        self,
    ) -> tuple[
        List[Dict[TItemFieldKeys, Any]],
        List[Dict[TItemFieldKeys, Any]],
        List[Any],
    ]:
        if self.binding.has_item_diffing:
            created, updated, deleted, current_items = self.binding.build_item_list_diff(
                self.target,
                self.last_items,
            )
        else:
            (
                created,
                updated,
                deleted,
                current_items,
            ) = self.binding.build_item_list_diff_naive(
                self.target,
                self.last_items,
            )

        self.last_items = current_items
        return created, updated, deleted

    def build_item_delete_payloads(
        self, deleted_item_ids: List[Any]
    ) -> List[Dict[TItemFieldKeys, Any]]:
        payloads: List[Dict[TItemFieldKeys, Any]] = []
        for item_id in deleted_item_ids:
            if isinstance(item_id, tuple):
                item_values = item_id
            elif len(self.binding.item_keys) == 1:
                item_values = (item_id,)
            else:
                item_values = tuple(item_id)

            payloads.append(
                {
                    key: value
                    for key, value in zip(self.binding.item_keys, item_values)
                }
            )
        return payloads


# endregion

# region Layer Field Definitions


AgentLayerMetadataFields: TypeAlias = Literal[
    "width", "height", "coord_offset", "z_index"
]
EdgeLayerMetadataFields: TypeAlias = Literal[
    "link_distance",
    "charge_strength",
    "centering_strength",
    "collision_radius",
    "max_component_distance",
    "component_spacing",
    "z_index",
]
TrajectoryLayerMetadataFields: TypeAlias = Literal[
    "length", "width", "color", "z_index"
]
GridLayerMetadataFields: TypeAlias = Literal[
    "width",
    "height",
    "x_origin",
    "x_unit",
    "x_interval",
    "x_ratio",
    "y_origin",
    "y_unit",
    "y_interval",
    "y_ratio",
    "stroke_color",
    "z_index",
]
BackgroundLayerMetadataFields: TypeAlias = Literal[
    "background", "interpolation", "z_index"
]

# endregion

# region Item Field Definitions


UniformAgentItemFields: TypeAlias = Literal["id", "color", "icon", "size", "data"]

AgentItemFields: TypeAlias = Union[
    UniformAgentItemFields,
    Literal["x", "y", "heading"],
]

EdgeItemFields: TypeAlias = Literal[
    "source", "target", "directed", "style", "width", "color"
]

TrajectoryConfigItemFields: TypeAlias = Literal["id", "length", "width", "color"]


# endregion
