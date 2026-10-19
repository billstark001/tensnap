"""Offline HTTP fixtures exercise budgets, replay, and credential isolation."""

import json

import httpx
import pytest

from examples.python_llm.common.config import LLMConfig
from examples.python_llm.common.llm import BudgetExceeded, DecisionError, DecisionTape
from examples.python_llm.naming_game.model import NamingConfig, NamingGame


def completion(answer, tokens=20, finish_reason="stop"):
    return httpx.Response(
        200,
        json={
            "choices": [
                {
                    "finish_reason": finish_reason,
                    "message": {"content": json.dumps(answer)},
                }
            ],
            "usage": {"total_tokens": tokens},
        },
    )


def test_environment_file_is_data_and_config_repr_hides_secret(tmp_path, monkeypatch):
    for name in (
        "LLM_API_KEY",
        "DEEPSEEK_API_KEY",
        "API_SECRET",
        "OPENAI_API_KEY",
        "LLM_EXTRA_BODY",
    ):
        monkeypatch.delenv(name, raising=False)
    env = tmp_path / "provider.env"
    secret = "fixture-key-$(touch should-not-exist)"
    env.write_text(f"API_SECRET='{secret}'\nLLM_MAX_CALLS=3\n")
    config = LLMConfig.load(env)
    assert config.api_key == secret
    assert secret not in repr(config)
    assert config.max_calls == 3
    assert config.extra_body == {"thinking": {"type": "disabled"}}
    monkeypatch.setenv("LLM_MAX_CALLS", "2")
    assert LLMConfig.load(env).max_calls == 2


@pytest.mark.asyncio
async def test_budget_does_not_rewind_and_replay_needs_no_credentials(tmp_path):
    calls = []
    secret = "fixture-private-key"

    def respond(request):
        calls.append(request)
        assert request.headers["authorization"] == f"Bearer {secret}"
        return completion({"name": "Q"})

    path = tmp_path / "decisions.jsonl"
    live = DecisionTape(
        LLMConfig(api_key=secret, max_calls=4),
        record=path,
        transport=httpx.MockTransport(respond),
    )
    model = NamingGame(NamingConfig(agents=4), live)
    initial = model.capture()
    await model.step()
    await model.step()
    final = model.capture()
    model.restore(initial)
    await model.step()
    await model.step()
    assert model.capture() == final
    assert live.live_calls == 4 and len(calls) == 4 and live.replayed_calls == 4
    before = model.capture()
    with pytest.raises(BudgetExceeded):
        await model.step()
    assert model.capture() == before
    assert secret not in path.read_text()
    assert "Authorization" not in path.read_text()
    await live.close()

    replay = DecisionTape(replay=path)
    offline = NamingGame(NamingConfig(agents=4), replay)
    await offline.step()
    await offline.step()
    assert offline.capture() == final
    assert replay.live_calls == 0
    # Altering the seed changes the input fingerprint; replay cannot fabricate it.
    offline.reset(seed=8)
    with pytest.raises(DecisionError, match="no matching"):
        await offline.step()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(401, text="fixture-private-key echoed by remote"),
        completion(["not", "an", "object"]),
        completion({"name": "Q"}, finish_reason="length"),
    ],
)
async def test_failed_requests_are_counted_never_retried_and_errors_are_sanitized(
    response,
):
    calls = []

    def respond(request):
        calls.append(request)
        return response

    tape = DecisionTape(
        LLMConfig(api_key="fixture-private-key", max_calls=1),
        transport=httpx.MockTransport(respond),
    )
    with pytest.raises(DecisionError) as error:
        await tape.decide("JSON only", {})
    assert "fixture-private-key" not in str(error.value)
    with pytest.raises(BudgetExceeded):
        await tape.decide("JSON only", {})
    assert len(calls) == 1 and tape.cursor == 0
    await tape.close()


@pytest.mark.asyncio
async def test_changed_inputs_create_a_branch_without_overwriting_cached_future(
    tmp_path,
):
    tape = DecisionTape(
        LLMConfig(api_key="fixture", max_calls=3),
        transport=httpx.MockTransport(lambda _: completion({"name": "Q"})),
    )
    await tape.decide("JSON", {"branch": 1})
    tape.cursor = 0
    await tape.decide("JSON", {"branch": 2})
    tape.cursor = 0
    await tape.decide("JSON", {"branch": 1})
    assert tape.live_calls == 2 and tape.replayed_calls == 1
    await tape.close()
