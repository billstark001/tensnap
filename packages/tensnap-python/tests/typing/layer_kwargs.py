"""Static contract for typed layer options; checked by mypy and Pyright."""

from collections.abc import Mapping
from typing import Literal

from typing_extensions import assert_type

from tensnap.bindings.basic.agent_layers import (
    BindSourceAgentLayerConfig,
    agent_layer,
    map_agent_layer,
    matrix_agent_layer,
    xy_key_codec,
)
from tensnap.bindings.basic.layer import edge_layer, trajectory_layer
from tensnap.bindings.basic.layer_kwargs import (
    AgentLayerKwargs,
    EdgeLayerKwargs,
    ItemLayerKwargs,
    TrajectoryLayerKwargs,
    split_item_layer_kwargs,
)
from tensnap.models import (
    AgentItemFields,
    AgentLayerMetadataFields,
    EdgeItemFields,
    ProjectorFieldForInit,
    SourceKeyCodec,
    TrajectoryConfigItemFields,
)


def agent_projector(_item: object) -> dict[AgentItemFields, object]:
    return {"id": 1}


def edge_projector(_item: object) -> dict[EdgeItemFields, object]:
    return {"source": 1, "target": 2}


def trajectory_projector(_item: object) -> dict[TrajectoryConfigItemFields, object]:
    return {"id": 1}


agent_options: AgentLayerKwargs = {
    "uniform": True,
    "item_projector": agent_projector,
    "item_iterable_projector": lambda _model: (1, 2),
    "item_id_getter": lambda _item: "bird-1",
    "item_changed_getter": lambda _item: True,
}
edge_options: EdgeLayerKwargs = {
    "agent_layer_id": "agents",
    "item_projector": edge_projector,
}
trajectory_options: TrajectoryLayerKwargs = {
    "agent_layer_id": "agents",
    "item_projector": trajectory_projector,
}

agent_layer("birds", item_projector=agent_projector, uniform=True)
agent_layer("birds", z_index=2, metadata={"temperature": 21})
edge_layer("links", item_projector=edge_projector, agent_layer_id="birds")
trajectory_layer("trails", item_projector=trajectory_projector, agent_layer_id="birds")

agent_metadata, agent_items, agent_controls = split_item_layer_kwargs(
    agent_options,
    metadata_keys=("width", "height"),
    control_defaults={"uniform": False},
)
assert_type(agent_items, ItemLayerKwargs[AgentItemFields])
assert_type(agent_controls["uniform"], bool)

edge_metadata, edge_items, edge_controls = split_item_layer_kwargs(
    edge_options,
    metadata_keys=("link_distance",),
    control_defaults={"agent_layer_id": "agents"},
)
assert_type(edge_items, ItemLayerKwargs[EdgeItemFields])
assert_type(edge_controls["agent_layer_id"], str)

trajectory_metadata, trajectory_items, _ = split_item_layer_kwargs(
    trajectory_options,
    metadata_keys=("length",),
    control_defaults={"agent_layer_id": "agents"},
)
assert_type(trajectory_items, ItemLayerKwargs[TrajectoryConfigItemFields])

source_metadata: Mapping[Literal["temperature"], ProjectorFieldForInit] = {
    "temperature": 1.0
}
assert_type(
    map_agent_layer("heat", z_index=2, metadata=source_metadata),
    BindSourceAgentLayerConfig[Literal["temperature"]],
)
assert_type(xy_key_codec("patch"), SourceKeyCodec[tuple[int, int]])
assert_type(
    matrix_agent_layer("cells", color="#ffffff", z_index=2),
    BindSourceAgentLayerConfig[AgentLayerMetadataFields],
)
