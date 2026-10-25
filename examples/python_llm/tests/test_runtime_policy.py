"""Policy changes apply at Step boundaries without rebuilding either model."""

import asyncio
import copy
import json
from unittest.mock import AsyncMock

import httpx
import msgpack
import pytest
from websockets.asyncio.client import connect

from examples.python_llm.common.config import LLMConfig
from examples.python_llm.common.llm import DecisionError, DecisionTape
from examples.python_llm.common.viz import build_scenario
from examples.python_llm.mini_commons_harvest.model import MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.model import NamingGame
from examples.python_llm.naming_game.viz import NamingView

MODELS = [(NamingGame, NamingView, 2), (MiniCommons, CommonsView, 1)]


def answer():
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"content": '{"name":"Q","action":"wait"}'},
                }
            ],
            "usage": {"total_tokens": 5},
        },
    )


def live_tape(respond, **kwargs):
    return DecisionTape(
        LLMConfig(api_key="fixture", max_calls=32),
        transport=httpx.MockTransport(respond),
        **kwargs,
    )


async def select(scenario, policy):
    await scenario.server.on_param_change(None, {"id": "policy", "value": policy})


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type,calls", MODELS)
async def test_switch_preserves_world_and_restores_inactive_cursor(
    factory, view_type, calls
):
    live = live_tape(lambda request: answer())
    model = factory()
    scenario, view = await build_scenario(model, view_type, providers={"llm": live})
    scenario.server.broadcast = AsyncMock()
    try:
        for _ in range(3):
            await scenario._advance_step()
        agents, rng, policy_rng = model.agents, model.rng, model.policy_rng
        before = model.capture()
        await select(scenario, "llm")
        assert model.capture() == before and live._client is None
        assert scenario.parameters["policy"].allow_runtime_change
        assert view.policy_status()["effective_when"] == "next_step"
        assert view.policy_status()["next_step_policy"] == "llm"
        await scenario._advance_step()
        assert live.live_calls == live.cursor == calls
        await select(scenario, "rule")
        await scenario._advance_step()
        assert model.agents is agents
        assert model.rng is rng and model.policy_rng is policy_rng
        assert live.cursor == calls and model.tick == 5

        # The inactive live cursor and the pending switch belong to the checkpoint.
        await select(scenario, "llm")
        saved = view.capture()
        scenario.server.send = AsyncMock()
        await scenario._on_scene_capture(None, {"request_id": "mixed-policy"})
        wire_saved = copy.deepcopy(scenario.server.send.call_args.args[2])
        await scenario._advance_step()
        expected = view.capture()
        assert live.live_calls == 2 * calls
        await scenario._on_scene_restore(
            None, {**wire_saved, "request_id": "restore-mixed-policy"}
        )
        assert scenario._scene_restore_results["restore-mixed-policy"]["status"] == "ok"
        assert view.capture() == saved
        assert model.provider is None and live.cursor == calls
        assert view.policy_status()["effective_when"] == "next_step"
        assert live.live_calls == 2 * calls
        await scenario._advance_step()
        assert view.capture() == expected
        assert live.live_calls == 2 * calls and live.replayed_calls == calls
        assert expected["controls"]["policy_changes"] == [
            {"after_tick": 0, "policy": "rule"},
            {"after_tick": 3, "policy": "llm"},
            {"after_tick": 4, "policy": "rule"},
            {"after_tick": 5, "policy": "llm"},
        ]
        expected["controls"]["policy_changes"][0]["policy"] = "changed externally"
        assert view.policy_status()["recent_changes"][0]["policy"] == "rule"
        await select(scenario, "rule")
        await scenario.reset()
        assert live.cursor == 0 and live.live_calls == 2 * calls
        assert view.policy_status()["recent_changes"] == [
            {"after_tick": 0, "policy": "rule"}
        ]
    finally:
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type,calls", MODELS)
@pytest.mark.parametrize("outcome", ["success", "error", "cancel"])
async def test_inflight_step_keeps_provider_and_rolls_back_failed_decisions(
    factory, view_type, calls, outcome
):
    entered, release = asyncio.Event(), asyncio.Event()
    requests = []

    async def respond(request):
        requests.append(request)
        if len(requests) == 1:
            entered.set()
            await release.wait()
        if outcome == "error" and len(requests) == calls:
            return httpx.Response(400, json={"error": {"param": "temperature"}})
        return answer()

    live = live_tape(respond)
    model = factory(provider=live)
    scenario, view = await build_scenario(model, view_type)
    scenario.server.broadcast = AsyncMock()
    before = model.capture()
    running = asyncio.create_task(scenario._advance_step())
    try:
        await asyncio.wait_for(entered.wait(), 3)
        await select(scenario, "rule")
        assert model.provider is live
        assert view.policy_status() == {
            "requested_policy": "rule",
            "current_step_policy": "llm",
            "current_step": 1,
            "next_step_policy": "rule",
            "effective_when": "next_step",
            "recent_changes": [{"after_tick": 0, "policy": "llm"}],
        }
        with pytest.raises(ValueError, match="completed Step"):
            view.capture()
        if outcome == "cancel":
            running.cancel()
            with pytest.raises(asyncio.CancelledError):
                await running
        else:
            release.set()
            if outcome == "error":
                with pytest.raises(DecisionError, match="HTTP 400"):
                    await running
            else:
                await running
                assert len(requests) == calls  # Both Naming decisions use LLM.
        if outcome != "success":
            assert model.capture() == before
            assert scenario._time_step == model.tick == 0
            assert live.cursor == 0
        else:
            assert scenario._time_step == model.tick == 1
        assert live.live_calls == (1 if outcome == "cancel" else calls)
        assert view.policy_status()["current_step_policy"] is None
        published = [
            call.args[1]["value"]["policy"]
            for call in scenario.server.broadcast.call_args_list
            if call.args[1].get("id") == "inference"
        ]
        assert published[-1]["current_step_policy"] is None
        spent = live.live_calls
        await scenario._advance_step()
        assert model.provider is None and live.live_calls == spent
        assert view.policy_status()["effective_when"] == "active"
    finally:
        release.set()
        if not running.done():
            running.cancel()
        await asyncio.gather(running, return_exceptions=True)
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type,calls", MODELS)
async def test_replay_transitions_require_reset(factory, view_type, calls, tmp_path):
    path = tmp_path / "decisions.jsonl"
    recording = live_tape(lambda request: answer(), record=path)
    try:
        await factory(provider=recording).step()
    finally:
        await recording.close()
    live = live_tape(lambda request: answer())
    replay = DecisionTape(replay=path)
    scenario, view = await build_scenario(
        factory(), view_type, providers={"llm": live, "replay": replay}
    )
    try:
        await select(scenario, "replay")
        assert view.policy_status()["effective_when"] == "reset"
        assert view.policy_status()["next_step_policy"] == "rule"
        await scenario._advance_step()
        assert view.active_policy == "rule" and replay.cursor == 0
        await scenario.reset()
        await select(scenario, "llm")
        assert view.policy_status()["effective_when"] == "reset"
        assert view.policy_status()["next_step_policy"] == "replay"
        await scenario._advance_step()
        assert replay.cursor == calls and live.live_calls == 0
        await scenario.reset()
        assert view.active_policy == "llm" and replay.cursor == live.cursor == 0
        assert replay.replayed_calls == calls
    finally:
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("provider_cursors", {"llm": True}),
        ("provider_cursors", {"llm": -1}),
        ("provider_cursors", {"llm": 0}),  # Disagrees with active cursor.
        ("provider_cursors", {"other": 0}),
        ("policy_apply_at", "immediately"),
        ("policy_changes", []),
        ("policy_changes", [{"after_tick": 2, "policy": "llm"}]),
        ("policy_changes", [{"after_tick": 0, "policy": "rule"}]),
        (
            "policy_changes",
            [{"after_tick": 1, "policy": "llm"}, {"after_tick": 0, "policy": "llm"}],
        ),
    ],
)
async def test_invalid_policy_checkpoint_is_atomic(field, value):
    live = live_tape(lambda request: answer())
    scenario, view = await build_scenario(NamingGame(provider=live), NamingView)
    try:
        await scenario._advance_step()
        before, usage = view.capture(), live.status()
        invalid = copy.deepcopy(before)
        invalid["controls"][field] = value
        with pytest.raises((ValueError, TypeError)):
            view.restore(invalid)
        assert view.capture() == before and live.status() == usage
    finally:
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("factory,view_type,calls", MODELS)
async def test_legacy_checkpoint_preserves_pending_reset(factory, view_type, calls):
    live = live_tape(lambda request: answer())
    scenario, view = await build_scenario(factory(), view_type, providers={"llm": live})
    try:
        await select(scenario, "llm")
        legacy = view.capture()
        for field in ("provider_cursors", "policy_changes", "policy_apply_at"):
            del legacy["controls"][field]
        view.restore(legacy)
        assert view.policy_status()["effective_when"] == "reset"
        await scenario._advance_step()
        assert view.active_policy == "rule" and live.live_calls == 0
        # A fresh selection opts into the new next-Step behavior.
        await select(scenario, "llm")
        await scenario._advance_step()
        assert live.live_calls == calls and view.active_policy == "llm"
    finally:
        await live.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("binary", [False, True])
async def test_wire_policy_status_and_same_connection_step_order(binary):
    entered, release = asyncio.Event(), asyncio.Event()

    async def respond(request):
        entered.set()
        await release.wait()
        return answer()

    live = live_tape(respond)
    scenario, view = await build_scenario(
        NamingGame(), NamingView, port=0, providers={"llm": live}
    )
    server = asyncio.create_task(scenario.run())

    async def send(ws, kind, payload):
        message = {"type": kind, "payload": payload}
        await ws.send(
            msgpack.packb(message, use_bin_type=True) if binary else json.dumps(message)
        )

    async def receive(ws, predicate):
        while True:
            raw = await asyncio.wait_for(ws.recv(), 3)
            message = (
                msgpack.unpackb(raw, raw=False)
                if isinstance(raw, bytes)
                else json.loads(raw)
            )
            if predicate(message):
                return message["payload"]

    async def policy_update(ws, predicate):
        return await receive(
            ws,
            lambda m: (
                m["type"] == "monitor_update"
                and m["payload"]["id"] == "inference"
                and predicate(m["payload"]["value"]["policy"])
            ),
        )

    try:
        for _ in range(100):
            if scenario.server.listening_addresses:
                break
            await asyncio.sleep(0.01)
        async with connect(f"ws://127.0.0.1:{scenario.server.port}") as ws:
            await receive(ws, lambda m: m["type"] == "simulator_info")
            await send(ws, "param_change", {"id": "policy", "value": "llm"})
            await policy_update(ws, lambda p: p["effective_when"] == "next_step")
            assert live._client is None and view.model.tick == 0
            await send(ws, "action_invoke", {"id": "step", "request_id": "live"})
            await policy_update(ws, lambda p: p["current_step_policy"] == "llm")
            await asyncio.wait_for(entered.wait(), 3)
            # The same socket processes this edit after the current action.
            await send(ws, "param_change", {"id": "policy", "value": "rule"})
            release.set()
            result = await receive(ws, lambda m: m["type"] == "action_result")
            assert "error" not in result
            pending = await policy_update(ws, lambda p: p["next_step_policy"] == "rule")
            assert pending["value"]["policy"]["current_step_policy"] is None
            assert live.live_calls == 2 and view.model.tick == 1
            await send(ws, "action_invoke", {"id": "step", "request_id": "rule"})
            await receive(ws, lambda m: m["type"] == "action_result")
            assert view.active_policy == "rule" and view.model.tick == 2
            assert live.live_calls == 2
    finally:
        release.set()
        scenario.server.stop()
        await server
        await live.close()
