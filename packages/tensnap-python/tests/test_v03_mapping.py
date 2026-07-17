"""Exact v0.3 binding projections, including fields that must stay omitted."""

from __future__ import annotations

import json
import subprocess
from typing import Annotated
from pathlib import Path

from tensnap import SimulationScenario
import tensnap.bindings as binding_api
from tensnap.bindings import (
    BindParameterConfig,
    BindParametersConfig,
    agent,
    agent_layer,
    action,
    chart,
    env,
    layer_bindings,
    parameters,
)
from tensnap.protocol import layer_create_payload


REPO_ROOT = Path(__file__).resolve().parents[3]


def _parse_simulator_messages(messages: list[dict]) -> None:
    """Keep native binding fixtures pinned to the protocol package schema."""
    script = """
const { SimulatorToRendererMessageSchema } = await import(process.argv[1]);
for (const message of JSON.parse(process.argv[2])) SimulatorToRendererMessageSchema.parse(message);
"""
    schemas_url = (REPO_ROOT / "packages/protocol/dist/schemas.js").resolve().as_uri()
    subprocess.run(
        ["node", "--input-type=module", "-e", script, schemas_url, json.dumps(messages)],
        check=True,
        capture_output=True,
        text=True,
    )


def test_python_mapping_is_exact_and_chart_helpers_never_become_parameters():
    class ConstructorConfig:
        def __init__(
            self,
            width: Annotated[
                int,
                BindParameterConfig("number", min=1, max=20, step=1),
            ] = 8,
            height: Annotated[int, BindParameterConfig("number")] = 6,
        ):
            self.width = width
            self.height = height
            self.internal = {"not": "a parameter"}

    constructor_parameters = parameters(
        ConstructorConfig(),
        BindParametersConfig(include=["width", "height"], exclude=["height"]),
    )
    assert [(name, parameter.to_dict()) for name, parameter in constructor_parameters] == [
        (
            "width",
            {
                "id": "width",
                "type": "number",
                "label": "Width",
                "allow_runtime_change": True,
                "min": 1,
                "max": 20,
                "step": 1,
                "value": 8,
            },
        )
    ]

    class Model:
        speed = 2.5
        enabled = True
        opaque = {"must": "not leak"}

        @chart("population", "Population")
        def get_tensnap_chart_data_0(self):
            return 3

        @action(
            "nudge",
            "Nudge",
            scope="agent",
            kwargs=[
                {
                    "name": "amount",
                    "type": "number",
                    "min": 0,
                    "max": 4,
                    "default": 1,
                }
            ],
        )
        def nudge(self, *, target, amount):
            assert target["agent_id"] == "a"
            return amount

    model = Model()
    discovered = parameters(
        model,
        BindParametersConfig(
            include=["speed", "enabled", "get_tensnap_chart_data_0"]
        ),
    )
    assert [(name, parameter.to_dict()) for name, parameter in discovered] == [
        (
            "speed",
            {
                "id": "speed",
                "type": "number",
                "label": "Speed",
                "allow_runtime_change": True,
                "value": 2.5,
            },
        ),
        (
            "enabled",
            {
                "id": "enabled",
                "type": "boolean",
                "label": "Enabled",
                "allow_runtime_change": True,
                "value": True,
            },
        ),
    ]

    action_metadata = binding_api.actions(model)[0][2]
    assert action_metadata.to_dict() == {
        "id": "nudge",
        "label": "Nudge",
        "scope": "agent",
        "kwargs": [
            {
                "name": "amount",
                "type": "number",
                "min": 0,
                "max": 4,
                "default": 1,
            }
        ],
    }

    chart_metadata = binding_api.charts(model)[0][2]
    assert chart_metadata.to_dict() == {"id": "population", "label": "Population"}

    @agent(x="position[0]", y="position[1]", color="#16A34A")
    class Bird:
        def __init__(self, bird_id: str, position: tuple[int, int]):
            self.id = bird_id
            self.position = position
            self.hidden = "must not leak"

    @agent_layer(
        "birds",
        item_iterable_projector="birds",
        width=None,
        height=None,
        coord_offset="float",
    )
    @env(id="aviary")
    class Aviary:
        def __init__(self):
            self.width = 20
            self.height = 10
            self.birds = [Bird("a", (2, 3))]

    aviary = Aviary()
    bird_layer = layer_bindings(aviary)[0]
    assert bird_layer.build_metadata(aviary) == {
        "width": 20,
        "height": 10,
        "coord_offset": "float",
    }
    assert bird_layer.build_item_list(aviary) == [
        {"id": "a", "x": 2, "y": 3, "color": "#16A34A"}
    ]

    layer_payload = layer_create_payload(
        "world",
        {
            "layer_id": "edges",
            "layer_type": "edge",
            "dependency_layer_ids": {"agent": "agents"},
            "data": {"link_distance": 20},
        },
    )
    assert layer_payload == {
        "env_id": "world",
        "layer_id": "edges",
        "layer_type": "edge",
        "dependency_layer_ids": {"agent": "agents"},
        "metadata": {"link_distance": 20},
    }

    scenario = SimulationScenario(model_id="mapping.python")
    info = scenario.server.simulator_info_payload
    assert info is not None
    _parse_simulator_messages(
        [
            {"type": "simulator_info", "payload": info},
            {"type": "param_create", "payload": constructor_parameters[0][1].to_dict()},
            {"type": "action_create", "payload": action_metadata.to_dict()},
            {"type": "chart_create", "payload": chart_metadata.to_dict()},
            {"type": "env_layer_create", "payload": layer_payload},
        ]
    )
