from __future__ import annotations

from dataclasses import dataclass, field
from typing import (
    TYPE_CHECKING,
    Any,
    Literal,
    Protocol,
    TypeAlias,
    cast,
)

from typing_extensions import NotRequired, TypedDict

if TYPE_CHECKING:
    from .layer import LayerRegistration

# region Types

EnvironmentType: TypeAlias = Literal["uniform", "2d"]


class EnvironmentLayerState(TypedDict):
    """Protocol snapshot for one environment layer."""

    layer_id: str
    layer_type: str
    dependency_layer_ids: NotRequired[dict[str, str]]
    data: NotRequired[dict[str, Any]]
    items: NotRequired[list[dict[str, Any]]]
    agents: NotRequired[list[dict[str, Any]]]
    edges: NotRequired[list[dict[str, Any]]]


class EnvironmentState(TypedDict):
    """Protocol snapshot for one environment."""

    id: str
    type: EnvironmentType
    layers: list[EnvironmentLayerState]


class EnvCreatePayload(TypedDict):
    id: str
    type: EnvironmentType


class EnvDeletePayload(TypedDict):
    id: str


class EnvironmentRegistrationProtocol(Protocol):
    binding: EnvironmentBinding
    layers: dict[str, LayerRegistration[Any, Any, Any, Any]]

    def build_state(self) -> EnvironmentState: ...


# endregion

# region Models


@dataclass(slots=True)
class EnvironmentBinding:
    id: str
    type: EnvironmentType

    def build_create_payload(self) -> EnvCreatePayload:
        return EnvCreatePayload(
            id=self.id,
            type=self.type,
        )

    def build_delete_payload(self) -> EnvDeletePayload:
        return EnvDeletePayload(id=self.id)


@dataclass(slots=True)
class EnvironmentRegistration:
    """Scenario-owned environment entry with a dedicated layer registry."""

    binding: EnvironmentBinding
    layers: dict[str, LayerRegistration[Any, Any, Any, Any]] = field(
        default_factory=dict
    )

    @property
    def id(self) -> str:
        return self.binding.id

    @property
    def type(self) -> EnvironmentType:
        return self.binding.type

    def add_layer(self, layer: LayerRegistration[Any, Any, Any, Any]) -> None:
        self.layers[layer.binding.layer_id] = layer

    def remove_layer(self, layer_id: str) -> None:
        self.layers.pop(layer_id, None)

    def clear_layers(self) -> None:
        self.layers.clear()

    def build_state(self, *, include_items: bool = True) -> EnvironmentState:
        return {
            "id": self.binding.id,
            "type": self.binding.type,
            "layers": [
                layer.build_state(include_items=include_items)
                for layer in self.layers.values()
            ],
        }

    def seed_item_deltas_from_state(self, state: EnvironmentState) -> None:
        """Prime layer item diff caches from an already projected snapshot."""

        state_layers = {layer["layer_id"]: layer for layer in state["layers"]}
        for layer_id, registration in self.layers.items():
            layer_state = state_layers.get(layer_id)
            if layer_state is not None:
                registration.seed_item_deltas_from_state(layer_state)


def clone_environment_metadata_state(state: EnvironmentState) -> EnvironmentState:
    """Return a detached environment snapshot without projected item payloads."""

    layers: list[EnvironmentLayerState] = []
    for layer in state["layers"]:
        layer_copy: dict[str, Any] = {
            "layer_id": layer["layer_id"],
            "layer_type": layer["layer_type"],
        }
        if "dependency_layer_ids" in layer:
            layer_copy["dependency_layer_ids"] = dict(layer["dependency_layer_ids"])
        if "data" in layer:
            layer_copy["data"] = dict(layer["data"])
        layers.append(cast(EnvironmentLayerState, layer_copy))

    return {
        "id": state["id"],
        "type": state["type"],
        "layers": layers,
    }


def clone_environment_state(state: EnvironmentState) -> EnvironmentState:
    """Return a detached environment snapshot copy."""

    layers: list[EnvironmentLayerState] = []
    for layer in state["layers"]:
        layer_copy: dict[str, Any] = {
            "layer_id": layer["layer_id"],
            "layer_type": layer["layer_type"],
        }
        if "dependency_layer_ids" in layer:
            layer_copy["dependency_layer_ids"] = dict(layer["dependency_layer_ids"])
        if "data" in layer:
            layer_copy["data"] = dict(layer["data"])
        if "items" in layer:
            layer_copy["items"] = [dict(item) for item in layer["items"]]
        if "agents" in layer:
            layer_copy["agents"] = [dict(item) for item in layer["agents"]]
        if "edges" in layer:
            layer_copy["edges"] = [dict(item) for item in layer["edges"]]
        layers.append(cast(EnvironmentLayerState, layer_copy))

    return {
        "id": state["id"],
        "type": state["type"],
        "layers": layers,
    }


# endregion
