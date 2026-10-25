"""Public scene restoration through declarative hooks, with no checkpoint payload."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock

import httpx
import msgpack
import pytest
from websockets.asyncio.client import connect

from examples.python_llm.common.config import LLMConfig
from examples.python_llm.common.llm import DecisionTape
from examples.python_llm.common.viz import build_scenario
from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.model import NamingConfig, NamingGame
from examples.python_llm.naming_game.viz import NamingView

MODELS = [(NamingGame, NamingView), (MiniCommons, CommonsView)]


def projection(scenario):
    environment = scenario.environments["main"]
    return {
        "time": scenario._time_step,
        "parameters": [
            {"id": name, "value": value}
            for name, value in scenario.dump_parameters().items()
        ],
        "envs": [
            {
                "id": "main",
                "type": environment.type,
                "layers": [
                    {
                        "layer_id": name,
                        "layer_type": registration.binding.layer_type,
                        "dependency_layer_ids": registration.binding.dependency_layer_ids,
                        "metadata": registration.binding.build_metadata(
                            registration.target
                        ),
                        "items": registration.binding.build_item_list(
                            registration.target
                        ),
                    }
                    for name, registration in environment.layers.items()
                ],
            }
        ],
    }


def layer(payload, name):
    return next(
        item for item in payload["envs"][0]["layers"] if item["layer_id"] == name
    )


async def restore(scenario, saved, request_id="projected"):
    payload = json.loads(json.dumps(saved))
    payload.update(request_id=request_id, model_id=scenario.model_id)
    assert "checkpoint" not in payload
    await scenario._on_scene_restore(None, payload)
    return scenario._scene_restore_results[request_id]


def legacy_projection(scenario):
    """The pre-restore scene format has no active config/policy or edge timing."""
    saved = copy.deepcopy(projection(scenario))
    metadata = layer(saved, "agents")["metadata"]
    metadata.pop("model_config", None)
    metadata.pop("active_policy", None)
    for projected in saved["envs"][0]["layers"]:
        if projected["layer_id"] == "interactions":
            for edge in projected["items"]:
                edge.pop("data", None)
    return saved


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
async def test_legacy_scene_restores_with_matching_launch_settings(factory, view_type):
    scenario, view = await build_scenario(factory(), view_type)
    scenario.server.send = AsyncMock()
    for _ in range(17):
        await scenario._advance_step()
    saved = legacy_projection(scenario)
    await scenario._advance_step()
    assert (await restore(scenario, saved))["status"] == "ok"
    assert legacy_projection(scenario) == saved
    await scenario._advance_step()
    assert view.model.tick == scenario._time_step == 18


@pytest.mark.asyncio
async def test_legacy_naming_rejects_edges_missing_from_all_retained_histories():
    model = NamingGame(NamingConfig(agents=4, memory=1))
    scenario, view = await build_scenario(model, NamingView)
    scenario.server.send = AsyncMock()
    # With one remembered interaction per player, older visible edges soon
    # outlive both endpoints' memories. The old snapshot cannot date them.
    for _ in range(100):
        await scenario._advance_step()
        remembered = {
            tuple(sorted((player.id, event["partner"])))
            for player in model.agents
            for event in player.history
        }
        if any(
            (edge.source, edge.target) not in remembered for edge in model.recent_edges
        ):
            break
    else:
        pytest.fail("Fixture did not produce a forgotten edge")
    before = view.capture()
    result = await restore(scenario, legacy_projection(scenario))
    assert result["status"] == "rejected"
    assert "lacks interaction timing" in result["error"]["message"]
    assert view.capture() == before


@pytest.mark.asyncio
async def test_legacy_commons_rejects_different_receiver_dimensions():
    source, _ = await build_scenario(MiniCommons(), CommonsView)
    await source._advance_step()
    target, view = await build_scenario(
        MiniCommons(CommonsConfig(width=10, height=8)), CommonsView
    )
    target.server.send = AsyncMock()
    before = view.capture()
    result = await restore(target, legacy_projection(source))
    assert result["status"] == "rejected"
    assert "dimensions" in result["error"]["message"]
    assert view.capture() == before


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
@pytest.mark.parametrize("tick", [0, 17, 90, 150])
async def test_scene_round_trip_and_continuation_without_checkpoint_hooks(
    factory, view_type, tick
):
    model = factory()
    scenario, _ = await build_scenario(model, view_type)
    # Prove projected restore itself needs no checkpoint support or capture.
    scenario.configure_scene_restore(scenario._scene_restore)
    assert "scene.restore.checkpoint" not in scenario.capabilities
    assert "scene.restore.projected" in scenario.capabilities
    scenario.server.send = AsyncMock()
    scenario.server.broadcast = AsyncMock()
    await scenario._ensure_initialized()
    for _ in range(tick):
        await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    for _ in range(7):
        await scenario._advance_step()
    rng = model.rng.getstate(), model.policy_rng.getstate()
    scenario.server.send.reset_mock()
    scenario.server.broadcast.reset_mock()
    assert (await restore(scenario, saved))["status"] == "ok"
    assert projection(scenario) == saved
    assert (model.rng.getstate(), model.policy_rng.getstate()) == rng
    assert model.tick == scenario._time_step == tick
    if factory is NamingGame:
        assert all(
            event["tick"] > tick - 4 * len(model.agents) for event in model.events
        )
    published = [call.args[1].value for call in scenario.server.send.call_args_list]
    published.extend(
        call.args[0].value for call in scenario.server.broadcast.call_args_list
    )
    assert "monitor_update" in published
    assert not any(name.startswith("chart_") for name in published)
    retained = copy.deepcopy(saved)
    await scenario._advance_step()
    assert model.tick == scenario._time_step == tick + 1
    assert saved == retained
    # Published restore data must not alias the retained input or provider cache.
    if factory is MiniCommons:
        model.resources[0][0] = 0
    model.agents[0].history.clear()
    assert saved == retained


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
async def test_restore_before_first_step_keeps_model_and_protocol_time_aligned(
    factory, view_type
):
    source, _ = await build_scenario(factory(), view_type)
    for _ in range(9):
        await source._advance_step()
    target, view = await build_scenario(factory(), view_type)
    target.server.send = AsyncMock()
    assert (await restore(target, projection(source)))["status"] == "ok"
    await target._advance_step()
    assert target._time_step == view.model.tick == 10


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
@pytest.mark.parametrize(
    "corruption",
    [
        "duplicate_agent",
        "missing_agent",
        "bad_position",
        "future_memory",
        "missing_layer",
        "wrong_dependency",
        "bad_parameter",
        "fractional_time",
    ],
)
async def test_invalid_scene_is_rejected_before_any_mutation(
    factory, view_type, corruption
):
    model = factory()
    scenario, view = await build_scenario(model, view_type)
    scenario.configure_scene_restore(scenario._scene_restore)
    scenario.server.send = AsyncMock()
    for _ in range(6):
        await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    agents = layer(saved, "agents")["items"]
    if corruption == "duplicate_agent":
        agents.append(copy.deepcopy(agents[0]))
    elif corruption == "missing_agent":
        agents.pop()
    elif corruption == "bad_position":
        agents[0]["x"] = "invalid"
    elif corruption == "future_memory":
        actor = next(item for item in agents if item["data"]["recent_interactions"])
        actor["data"]["recent_interactions"][-1]["tick"] = saved["time"] + 1
    elif corruption == "missing_layer":
        saved["envs"][0]["layers"].pop()
    elif corruption == "wrong_dependency":
        layer(saved, "agents")["dependency_layer_ids"] = {"agent": "missing"}
    elif corruption == "bad_parameter":
        saved["parameters"].append({"id": "seed", "value": -1})
    else:
        saved["time"] = 1.5
    before = view.capture()
    assert (await restore(scenario, saved))["status"] == "rejected"
    assert view.capture() == before
    assert model.tick == scenario._time_step == 6
    await scenario._advance_step()
    assert model.tick == scenario._time_step == 7


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption",
    [
        "missing_cell",
        "duplicate_cell",
        "bad_cell_id",
        "flipped_y",
        "bad_resource",
        "fertility",
        "dimensions",
    ],
)
async def test_commons_rejects_inconsistent_dense_grid(corruption):
    model = MiniCommons()
    scenario, view = await build_scenario(model, CommonsView)
    scenario.server.send = AsyncMock()
    await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    resources = layer(saved, "resources")
    cells = resources["items"]
    if corruption == "missing_cell":
        cells.pop()
    elif corruption == "duplicate_cell":
        cells.append(copy.deepcopy(cells[0]))
    elif corruption == "bad_cell_id":
        cells[0]["id"] = "cell:999:999"
    elif corruption == "flipped_y":
        cells[0]["y"] = 0
    elif corruption == "bad_resource":
        cells[0]["data"]["value"] = 4
    elif corruption == "fertility":
        cells[0]["data"]["fertile"] = not cells[0]["data"]["fertile"]
    else:
        resources["metadata"]["height"] += 1
    before = view.capture()
    assert (await restore(scenario, saved))["status"] == "rejected"
    assert view.capture() == before


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "corruption", ["contact", "duplicate_edge", "edge_tick", "score", "name"]
)
async def test_naming_rejects_inconsistent_graph(corruption):
    model = NamingGame()
    scenario, view = await build_scenario(model, NamingView)
    scenario.server.send = AsyncMock()
    for _ in range(8):
        await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    if corruption == "contact":
        layer(saved, "contacts")["items"].pop()
    elif corruption == "duplicate_edge":
        edges = layer(saved, "interactions")["items"]
        edges.append(copy.deepcopy(edges[0]))
    elif corruption == "edge_tick":
        layer(saved, "interactions")["items"][0]["data"]["tick"] = 9
    elif corruption == "score":
        layer(saved, "agents")["items"][0]["data"]["score"] += 1
    else:
        layer(saved, "agents")["items"][0]["data"]["name"] = "invented"
    before = view.capture()
    assert (await restore(scenario, saved))["status"] == "rejected"
    assert view.capture() == before


@pytest.mark.asyncio
async def test_commons_restores_top_down_positions_and_local_messages():
    model = MiniCommons(CommonsConfig(agents=2, rule="signal"))
    scenario, _ = await build_scenario(model, CommonsView)
    scenario.server.send = AsyncMock()
    for _ in range(7):
        await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    expected = copy.deepcopy(model.state())
    await scenario._advance_step()
    assert (await restore(scenario, saved))["status"] == "ok"
    assert model.state() == expected
    for player in model.agents:
        item = next(
            item for item in layer(saved, "agents")["items"] if item["id"] == player.id
        )
        assert (player.x, player.y) == (item["x"], model.config.height - 1 - item["y"])


@pytest.mark.asyncio
async def test_projected_restore_does_not_rewind_or_contact_live_provider():
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {"content": '{"name":"Q"}'},
                    }
                ],
                "usage": {"total_tokens": 2},
            },
        )

    provider = DecisionTape(
        LLMConfig(api_key="fixture"), transport=httpx.MockTransport(respond)
    )
    scenario, view = await build_scenario(NamingGame(provider=provider), NamingView)
    scenario.server.send = AsyncMock()
    await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    await scenario._advance_step()
    before = provider.status()
    assert (await restore(scenario, saved))["status"] == "ok"
    assert provider.status() == before
    assert len(calls) == 4
    assert view.model.provider is provider
    assert view.policy_status()["recent_changes"] == [
        {"after_tick": 1, "policy": "llm"}
    ]
    await scenario._advance_step()
    assert len(calls) == 6
    await provider.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
async def test_time_only_restore_rebases_policy_history(factory, view_type):
    scenario, view = await build_scenario(factory(), view_type)
    scenario.server.send = AsyncMock()
    for tick in (10, 0):
        result = await restore(scenario, {"time": tick}, f"time-{tick}")
        assert result["status"] == "ok"
        assert view.policy_status()["recent_changes"] == [
            {"after_tick": tick, "policy": "rule"}
        ]
        # Rewinding time must leave a self-consistent continuation checkpoint.
        saved = view.capture()
        view.restore(saved)
        assert view.capture() == saved


@pytest.mark.asyncio
async def test_active_config_and_pending_controls_survive_population_restore():
    source, view = await build_scenario(
        NamingGame(NamingConfig(agents=12, topology="ring")), NamingView
    )
    for _ in range(5):
        await source._advance_step()
    view.seed = 42
    view.scenario = "large-population"
    view.agent_count = 48
    saved = copy.deepcopy(projection(source))
    target, restored = await build_scenario(NamingGame(), NamingView)
    target.server.send = AsyncMock()
    assert (await restore(target, saved))["status"] == "ok"
    assert restored.model.config.agents == 12
    assert restored.model.config.seed == 7
    assert restored.agent_count == 48 and restored.seed == 42
    assert target.parameters["selected_agent"].max == 11
    await target.reset()
    assert restored.model.config.agents == 48
    assert restored.model.config.seed == 42


@pytest.mark.asyncio
async def test_restored_graph_positions_remain_valid_model_state():
    scenario, view = await build_scenario(NamingGame(), NamingView)
    scenario.server.send = AsyncMock()
    await scenario._advance_step()
    saved = copy.deepcopy(projection(scenario))
    layer(saved, "agents")["items"][0]["x"] += 0.25
    assert (await restore(scenario, saved))["status"] == "ok"
    assert view.model.agents[0].x == layer(saved, "agents")["items"][0]["x"]
    state = view.model.capture()
    view.model.restore(state)
    assert view.model.capture() == state


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
async def test_model_updates_do_not_mutate_the_actual_restore_payload(
    factory, view_type
):
    scenario, view = await build_scenario(factory(), view_type)
    scenario.server.send = AsyncMock()
    for _ in range(9):
        await scenario._advance_step()
    payload = copy.deepcopy(projection(scenario))
    payload.update(request_id="ownership", model_id=scenario.model_id)
    retained = copy.deepcopy(payload)
    await scenario._on_scene_restore(None, payload)
    assert scenario._scene_restore_results["ownership"]["status"] == "ok"
    for agent in view.model.agents:
        agent.history.clear()
    if factory is MiniCommons:
        view.model.resources[0][0] = 1
    else:
        view.model.agents[0].last_decision["note"] = "changed later"
    assert payload == retained


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type", MODELS)
@pytest.mark.parametrize("binary", [False, True])
async def test_projected_restore_over_real_websocket(factory, view_type, binary):
    scenario, view = await build_scenario(factory(), view_type, port=0)
    server = asyncio.create_task(scenario.run())

    async def receive_until(ws, predicate):
        messages = []
        while True:
            raw = await asyncio.wait_for(ws.recv(), timeout=3)
            message = (
                msgpack.unpackb(raw, raw=False)
                if isinstance(raw, bytes)
                else json.loads(raw)
            )
            messages.append(message)
            if predicate(message):
                return messages

    async def send(ws, kind, payload):
        message = {"type": kind, "payload": payload}
        await ws.send(
            msgpack.packb(message, use_bin_type=True) if binary else json.dumps(message)
        )

    try:
        for _ in range(100):
            if scenario.server.listening_addresses:
                break
            await asyncio.sleep(0.01)
        async with connect(f"ws://127.0.0.1:{scenario.server.port}") as ws:
            await receive_until(ws, lambda message: message["type"] == "simulator_info")
            await send(
                ws,
                "state_sync",
                {
                    "request_id": "sync",
                    "model_id": scenario.model_id,
                    "parameters": [],
                    "actions": [],
                    "envs": [],
                    "charts": [],
                    "monitors": [],
                },
            )
            await receive_until(ws, lambda message: message["type"] == "state_sync_end")
            await send(ws, "action_invoke", {"id": "step", "request_id": "first"})
            await receive_until(ws, lambda message: message["type"] == "action_result")
            saved = copy.deepcopy(projection(scenario))
            await send(ws, "action_invoke", {"id": "step", "request_id": "second"})
            await receive_until(ws, lambda message: message["type"] == "action_result")
            await send(
                ws,
                "scene_restore",
                {
                    **saved,
                    "request_id": "wire-restore",
                    "model_id": scenario.model_id,
                    "state_schema_version": "2",
                },
            )
            messages = await receive_until(
                ws, lambda message: message["type"] == "scene_restore_end"
            )
            assert messages[-1]["payload"]["status"] == "ok"
            assert projection(scenario) == saved
            assert not any(message["type"].startswith("chart_") for message in messages)
            await send(ws, "action_invoke", {"id": "step", "request_id": "continued"})
            await receive_until(ws, lambda message: message["type"] == "action_result")
            assert view.model.tick == scenario._time_step == 2
    finally:
        scenario.server.stop()
        await server
