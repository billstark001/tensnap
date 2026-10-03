"""Map, matrix, and columnar sources use the existing item wire contract."""

import asyncio
from unittest.mock import AsyncMock

import pytest

from tensnap import (
    SimulationScenario,
    SourceBatch,
    SourceChange,
    env,
    grid_layer,
    indexed_agent_layer,
    map_agent_layer,
    matrix_agent_layer,
    scene_restore,
    xy_key_codec,
)
from tensnap.bindings.basic.layer_kwargs import (
    LayerMetadataKwargs,
    split_layer_kwargs,
)
from tensnap.helper import broadcast_env_update
from tensnap.models import clone_environment_metadata_state
from tensnap.server import ServerToClientMessageType

MT = ServerToClientMessageType


def test_revisioned_map_source_projects_only_changed_entries() -> None:
    counts = {"items": 0, "project": 0}

    class Flags(dict):
        def items(self):
            counts["items"] += 1
            return super().items()

    def project(_model, key, value):
        counts["project"] += 1
        return {"color": "#000000" if value else "#ffffff"}

    @map_agent_layer(
        "flags",
        source="flags",
        project=project,
        revision="revision",
        changes="changes_since",
    )
    @env("world")
    class Model:
        def __init__(self):
            self.flags = Flags(a=False, b=True)
            self.revision = 0
            self.events = []

        def changes_since(self, previous):
            return SourceBatch(
                self.revision,
                [change for revision, change in self.events if revision > previous],
            )

    model = Model()
    scenario = SimulationScenario(model_id="sources.flags")
    scenario.add_environment(model)
    environment = scenario.environments["world"]
    scenario.server.broadcast = AsyncMock()
    initial = environment.build_state()
    asyncio.run(broadcast_env_update(scenario.server, environment, initial, None))
    assert counts == {"items": 1, "project": 2}

    model.flags["a"] = True
    model.revision = 1
    model.events.append((1, SourceChange("update", "a")))
    current = environment.build_state(include_items=False)
    asyncio.run(
        broadcast_env_update(
            scenario.server,
            environment,
            current,
            clone_environment_metadata_state(initial),
        )
    )
    assert counts == {"items": 1, "project": 3}
    item_updates = [
        call.args[1]["items"]
        for call in scenario.server.broadcast.call_args_list
        if call.args[0] == MT.ITEM_UPDATE
    ]
    assert item_updates == [[{"id": "a", "color": "#000000", "data": {"value": True}}]]

    model.revision = 2
    current = environment.build_state(include_items=False)
    scenario.server.broadcast.reset_mock()
    asyncio.run(
        broadcast_env_update(
            scenario.server,
            environment,
            current,
            clone_environment_metadata_state(initial),
        )
    )
    assert counts == {"items": 1, "project": 3}
    assert not any(
        call.args[0] in (MT.ITEM_CREATE, MT.ITEM_UPDATE, MT.ITEM_DELETE)
        for call in scenario.server.broadcast.call_args_list
    )

    model.flags["c"] = False
    del model.flags["b"]
    model.revision = 3
    model.events.extend(
        [
            (3, SourceChange("create", "c")),
            (3, SourceChange("delete", "b")),
        ]
    )
    scenario.server.broadcast.reset_mock()
    asyncio.run(
        broadcast_env_update(
            scenario.server,
            environment,
            current,
            clone_environment_metadata_state(initial),
        )
    )
    operations = [
        (call.args[0], call.args[1]["items"])
        for call in scenario.server.broadcast.call_args_list
        if call.args[0] in (MT.ITEM_CREATE, MT.ITEM_UPDATE, MT.ITEM_DELETE)
    ]
    assert operations == [
        (MT.ITEM_CREATE, [{"id": "c", "data": {"value": False}, "color": "#ffffff"}]),
        (MT.ITEM_DELETE, [{"id": "b"}]),
    ]


def test_scan_fallback_and_indexed_columns() -> None:
    @map_agent_layer("flags", source="flags")
    @indexed_agent_layer(
        "positions",
        keys="ids",
        read=lambda model, key: key,
        fields={"x": lambda model, key, _value: model.x[key], "y": "model.y"},
    )
    @env("world")
    class Model:
        def __init__(self):
            self.flags = {"a": False}
            self.ids = ["a"]
            self.x = {"a": 1}
            self.y = 2

    model = Model()
    scenario = SimulationScenario(model_id="sources.indexed")
    scenario.add_environment(model)
    flags = scenario.environments["world"].layers["flags"]
    positions = scenario.environments["world"].layers["positions"]
    assert positions.build_state()["agents"] == [{"id": "a", "x": 1, "y": 2}]
    flags.seed_item_deltas_from_state(flags.build_state())
    model.flags = {"a": True, "b": False}
    creates, updates, deletes = flags.build_item_deltas()
    assert creates == [{"id": "b", "data": {"value": False}}]
    assert updates == [{"id": "a", "data": {"value": True}}]
    assert deletes == []
    flags.commit_item_deltas()


def test_matrix_shape_and_projected_restore_validate_before_mutation() -> None:
    @scene_restore(validate=lambda _payload: None)
    @map_agent_layer("flags", source="flags")
    @matrix_agent_layer("cells", source="cells")
    @env("world")
    class Model:
        def __init__(self):
            self.flags = {"present": False}
            self.cells = [["open", "closed"], ["closed", "open"]]

    model = Model()
    scenario = SimulationScenario(model_id="sources.restore")
    scenario.add_all(model)
    scenario.server.send = AsyncMock()
    state = scenario.environments["world"].build_state()
    layers = [
        {
            "layer_id": layer["layer_id"],
            "layer_type": layer["layer_type"],
            **({"metadata": layer["data"]} if "data" in layer else {}),
            "items": layer.get("agents", []),
        }
        for layer in state["layers"]
    ]
    payload = {
        "request_id": "roundtrip",
        "model_id": "sources.restore",
        "envs": [{"id": "world", "type": "2d", "layers": layers}],
    }
    model.flags = {"changed": True}
    model.cells = [["changed"]]
    asyncio.run(scenario._on_scene_restore(None, payload))
    assert model.flags == {"present": False}
    assert model.cells == [["open", "closed"], ["closed", "open"]]
    assert scenario.server.send.call_args_list[-1].args[2]["status"] == "ok"

    bad = {**payload, "request_id": "invalid"}
    bad_layers = [dict(layer) for layer in layers]
    bad_layers[0]["items"] = [
        {"id": "cell:0:0", "x": 0, "y": 1, "data": {"value": "open"}}
    ]
    bad["envs"] = [{"id": "world", "type": "2d", "layers": bad_layers}]
    model.flags = {"still": False}
    model.cells = [["still"]]
    asyncio.run(scenario._on_scene_restore(None, bad))
    assert model.flags == {"still": False}
    assert model.cells == [["still"]]
    assert scenario.server.send.call_args_list[-1].args[2]["status"] == "rejected"

    duplicate = {**payload, "request_id": "duplicate-map"}
    duplicate_layers = [dict(layer) for layer in layers]
    flags_layer = next(
        layer for layer in duplicate_layers if layer["layer_id"] == "flags"
    )
    flags_layer["items"] = [*flags_layer["items"], *flags_layer["items"]]
    duplicate["envs"] = [{"id": "world", "type": "2d", "layers": duplicate_layers}]
    asyncio.run(scenario._on_scene_restore(None, duplicate))
    assert model.flags == {"still": False}
    assert model.cells == [["still"]]
    assert scenario.server.send.call_args_list[-1].args[2]["status"] == "rejected"


def test_failed_publication_keeps_source_cursor_for_retry() -> None:
    @map_agent_layer(
        "flags", source="flags", revision="revision", changes="changes_since"
    )
    @env("world")
    class Model:
        def __init__(self):
            self.flags = {"a": False}
            self.revision = 0

        def changes_since(self, previous):
            return SourceBatch(
                self.revision,
                [SourceChange("update", "a")] if previous == 0 else [],
            )

    model = Model()
    scenario = SimulationScenario(model_id="sources.retry")
    scenario.add_environment(model)
    environment = scenario.environments["world"]
    initial = environment.build_state()
    scenario.server.broadcast = AsyncMock()
    asyncio.run(broadcast_env_update(scenario.server, environment, initial, None))
    layer = environment.layers["flags"]
    assert layer.source_cursor == 0

    model.flags["a"] = True
    model.revision = 1
    current = environment.build_state(include_items=False)
    scenario.server.broadcast = AsyncMock(side_effect=RuntimeError("send failed"))
    with pytest.raises(RuntimeError, match="send failed"):
        asyncio.run(
            broadcast_env_update(
                scenario.server,
                environment,
                current,
                clone_environment_metadata_state(initial),
            )
        )
    assert layer.source_cursor == 0
    assert layer.last_items["a"]["data"]["value"] is False

    scenario.server.broadcast = AsyncMock()
    asyncio.run(
        broadcast_env_update(
            scenario.server,
            environment,
            current,
            clone_environment_metadata_state(initial),
        )
    )
    assert layer.source_cursor == 1
    assert scenario.server.broadcast.call_args_list[-1].args == (
        MT.ITEM_UPDATE,
        {
            "env_id": "world",
            "layer_id": "flags",
            "items": [{"id": "a", "data": {"value": True}}],
        },
    )


def test_sparse_matrix_false_is_absent_and_coordinates_are_inverted() -> None:
    @matrix_agent_layer("cells", source="cells", sparse_default=False)
    @env("world")
    class Model:
        def __init__(self):
            self.cells = [[False, True], [False, False]]

    model = Model()
    scenario = SimulationScenario(model_id="sources.sparse")
    scenario.add_environment(model)
    layer = scenario.environments["world"].layers["cells"]
    state = layer.build_state()
    assert state["data"] == {"width": 2, "height": 2, "coord_offset": "int"}
    assert state["agents"] == [
        {
            "id": "cell:0:1",
            "x": 1,
            "y": 1,
            "icon": "square",
            "size": 1.0,
            "data": {"value": True},
        }
    ]

    layer.seed_item_deltas_from_state(state)
    model.cells[0][1] = False
    model.cells[1][0] = True
    creates, updates, deletes = layer.build_item_deltas()
    assert creates == [
        {
            "id": "cell:1:0",
            "x": 0,
            "y": 0,
            "icon": "square",
            "size": 1.0,
            "data": {"value": True},
        }
    ]
    assert updates == []
    assert deletes == ["cell:0:1"]


def test_layer_kwargs_pep_728_extra_items_and_split() -> None:
    assert LayerMetadataKwargs.__extra_items__ is not None
    metadata, items, controls = split_layer_kwargs(
        {"width": 10, "item_projector": "project", "uniform": True},
        metadata_keys=("width", "height"),
        item_keys=frozenset({"item_projector"}),
        control_defaults={"uniform": False},
    )
    assert metadata == {"width": 10, "height": None}
    assert items == {"item_projector": "project"}
    assert controls == {"uniform": True}
    with pytest.raises(TypeError, match="unknown layer options: typo"):
        split_layer_kwargs({"typo": True}, metadata_keys=("width",))


def test_compact_source_layers_and_metadata_rules() -> None:
    @map_agent_layer(
        "patches",
        key_codec=xy_key_codec("patch"),
        fields={
            "x": lambda _model, key, _value: key[0],
            "y": lambda _model, key, _value: key[1],
        },
        color=lambda _model, _key, value: value,
        z_index=3,
        metadata={"temperature": 21},
    )
    @matrix_agent_layer("cells", color="#00ff00", z_index=4)
    @grid_layer("grid", width=2, metadata={"height": 1})
    @env("world")
    class Model:
        def __init__(self) -> None:
            self.patches = {(1, -2): "#ff0000"}
            self.cells = [[True, False]]

    scenario = SimulationScenario(model_id="sources.compact")
    scenario.add_environment(Model())
    layers = scenario.environments["world"].layers
    assert layers["patches"].build_state()["data"] == {
        "z_index": 3,
        "temperature": 21,
    }
    assert layers["patches"].build_state()["agents"] == [
        {
            "id": "patch:1:-2",
            "x": 1,
            "y": -2,
            "color": "#ff0000",
            "data": {"value": "#ff0000"},
        }
    ]
    assert layers["cells"].build_state()["data"] == {
        "width": 2,
        "height": 1,
        "coord_offset": "int",
        "z_index": 4,
    }
    assert layers["cells"].build_state()["agents"] == [
        {
            "id": "cell:0:0",
            "x": 0,
            "y": 0,
            "color": "#00ff00",
            "icon": "square",
            "size": 1.0,
            "data": {"value": True},
        },
        {
            "id": "cell:0:1",
            "x": 1,
            "y": 0,
            "color": "#00ff00",
            "icon": "square",
            "size": 1.0,
            "data": {"value": False},
        },
    ]
    assert layers["grid"].build_state()["data"] == {"width": 2, "height": 1}


def test_layer_option_conflicts_and_coordinate_codec() -> None:
    with pytest.raises(TypeError, match="layer metadata declared twice: width"):
        grid_layer("grid", width=2, metadata={"width": 3})
    with pytest.raises(TypeError, match="layer metadata declared twice: z_index"):
        map_agent_layer("patches", z_index=1, metadata={"z_index": 2})
    with pytest.raises(TypeError, match="derived layer metadata cannot be set: width"):
        matrix_agent_layer("cells", metadata={"width": 2})
    with pytest.raises(ValueError, match="visual field declared twice: color"):
        map_agent_layer("patches", fields={"color": "value"}, color="red")
    with pytest.raises(ValueError, match="project or visual field shortcuts"):
        matrix_agent_layer("cells", project=lambda *_: {}, color="red")

    codec = xy_key_codec("patch")
    assert codec.decode(codec.encode((-3, 4))) == (-3, 4)
    with pytest.raises(ValueError, match="noncanonical coordinate map ID"):
        codec.decode("patch:-0:4")
    with pytest.raises(ValueError, match="invalid coordinate map ID"):
        codec.decode("other:-3:4")


def test_coordinate_key_codec_restores_map_keys() -> None:
    @scene_restore(validate=lambda _payload: None)
    @map_agent_layer("patches", key_codec=xy_key_codec("patch"))
    @env("world")
    class Model:
        def __init__(self) -> None:
            self.patches = {(2, -1): "red"}

    model = Model()
    scenario = SimulationScenario(model_id="sources.coordinate-restore")
    scenario.add_all(model)
    scenario.server.send = AsyncMock()
    state = scenario.environments["world"].build_state()["layers"][0]
    model.patches = {(0, 0): "blue"}
    payload = {
        "request_id": "restore",
        "model_id": "sources.coordinate-restore",
        "envs": [
            {
                "id": "world",
                "type": "2d",
                "layers": [
                    {
                        "layer_id": "patches",
                        "layer_type": "agent",
                        "items": state["agents"],
                    }
                ],
            }
        ],
    }
    asyncio.run(scenario._on_scene_restore(None, payload))
    assert model.patches == {(2, -1): "red"}
    assert scenario.server.send.call_args_list[-1].args[2]["status"] == "ok"
