"""Offline HTTP fixtures exercise budgets, replay, and credential isolation."""

import json
from dataclasses import replace

import httpx
import pytest

from examples.python_llm.common.config import REQUEST_OPTIONS, LLMConfig
from examples.python_llm.common.llm import BudgetExceeded, DecisionError, DecisionTape
from examples.python_llm.naming_game.model import NamingConfig, NamingGame


@pytest.fixture(autouse=True)
def isolated_llm_environment(monkeypatch):
    for name in (
        *(f"LLM_{name.upper()}" for name in REQUEST_OPTIONS),
        "LLM_API_KEY",
        "DEEPSEEK_API_KEY",
        "API_SECRET",
        "OPENAI_API_KEY",
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_MAX_CALLS",
        "LLM_TIMEOUT",
        "LLM_EXTRA_BODY",
    ):
        monkeypatch.delenv(name, raising=False)


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


@pytest.mark.asyncio
async def test_default_wire_request_is_unchanged(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "fixture-private-key")
    requests = []

    def respond(request):
        requests.append(request)
        return completion({"name": "Q"})

    tape = DecisionTape(LLMConfig.load(), transport=httpx.MockTransport(respond))
    await tape.decide("Return JSON", {"tick": 0})
    assert str(requests[0].url) == "https://api.deepseek.com/chat/completions"
    assert requests[0].headers["authorization"] == "Bearer fixture-private-key"
    assert json.loads(requests[0].content) == {
        "model": "deepseek-flash",
        "messages": [
            {"role": "system", "content": "Return JSON"},
            {"role": "user", "content": '{"tick": 0}'},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.7,
        "max_tokens": 128,
        "stream": False,
        "thinking": {"type": "disabled"},
    }
    assert tape.status()["settings"]["output_token_limit"] == 128
    await tape.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("name", REQUEST_OPTIONS)
async def test_each_request_option_can_be_omitted_independently(name):
    config = LLMConfig(
        api_key="fixture",
        top_p=0.9,
        presence_penalty=0.2,
        frequency_penalty=-0.2,
    )
    if name == "max_completion_tokens":
        config = replace(config, max_tokens=None, max_completion_tokens=256)
    config = replace(config, **{name: None})
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return completion({"name": "Q"})

    tape = DecisionTape(config, transport=httpx.MockTransport(respond))
    await tape.decide("JSON", {})
    assert name not in requests[0]
    assert requests[0]["model"] == "deepseek-flash"
    assert len(requests[0]["messages"]) == 2
    if name != "temperature":
        assert requests[0]["temperature"] == 0.7
    if name not in ("max_tokens", "max_completion_tokens"):
        assert requests[0]["max_tokens"] == 128
    assert tape.status()["settings"]["request_options"][name] == "omitted"
    await tape.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response_format", ["text", "json_schema", "vendor/custom-format"]
)
async def test_any_response_format_string_is_forwarded_as_type(response_format):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return completion({"name": "Q"})

    tape = DecisionTape(
        LLMConfig(api_key="fixture", response_format=response_format),
        transport=httpx.MockTransport(respond),
    )
    assert await tape.decide("JSON", {}) == {"name": "Q"}
    assert requests[0]["response_format"] == {"type": response_format}
    await tape.close()


@pytest.mark.asyncio
async def test_minimal_gateway_request_omits_all_optional_fields(tmp_path):
    env = tmp_path / "gateway.env"
    env.write_text(
        "LLM_API_KEY=fixture\nLLM_BASE_URL=http://localhost:9999/v1\n"
        "LLM_EXTRA_BODY={}\n"
        + "".join(f"LLM_{name.upper()}=omit\n" for name in REQUEST_OPTIONS)
    )
    requests = []

    def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        # Emulate a gateway that rejects every optional field.
        if set(payload) != {"model", "messages"}:
            return httpx.Response(
                400, json={"error": {"code": "unsupported_parameter"}}
            )
        return completion({"name": "Q"})

    tape = DecisionTape(LLMConfig.load(env), transport=httpx.MockTransport(respond))
    assert await tape.decide("JSON", {}) == {"name": "Q"}
    assert len(requests) == 1
    settings = tape.status()["settings"]
    assert settings["output_token_limit"] is None
    assert settings["output_token_limit_note"] == "No output token limit sent by client"
    await tape.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response,options,expected,absent",
    [
        (
            httpx.Response(
                400,
                json={
                    "error": {
                        "param": "temperature",
                        "code": "unsupported_parameter",
                        "message": "fixture-private-key",
                        "type": "fixture-private-key",
                    }
                },
            ),
            {},
            ["temperature", "unsupported_parameter", "LLM_TEMPERATURE=omit"],
            ["cause undetermined"],
        ),
        (
            httpx.Response(
                400,
                json={
                    "error": {
                        "param": "response_format.type",
                        "code": "invalid_value",
                    }
                },
            ),
            {},
            ["response_format", "invalid_value", "LLM_RESPONSE_FORMAT=text or omit"],
            ["unsupported_parameter"],
        ),
        (
            httpx.Response(
                400,
                json={
                    "error": {
                        "message": "Unsupported parameter: 'max_tokens'; fixture-private-key",
                    }
                },
            ),
            {},
            ["Provider error references: max_tokens", "LLM_MAX_TOKENS=omit"],
            [],
        ),
        (
            httpx.Response(
                422,
                json={
                    "detail": [
                        {
                            "loc": ["body", "top_p"],
                            "type": "extra_forbidden",
                            "msg": "fixture-private-key",
                            "input": "fixture-private-key",
                        }
                    ]
                },
            ),
            {"top_p": 0.8},
            ["top_p", "extra_forbidden", "LLM_TOP_P=omit"],
            [],
        ),
        (
            httpx.Response(400, json={"error": {"param": "thinking"}}),
            {"extra_body": {"thinking": {"type": "disabled"}}},
            ["thinking", "LLM_EXTRA_BODY={}"],
            [],
        ),
        (
            httpx.Response(
                400,
                json={
                    "error": {
                        "param": "fixture-private-key",
                        "code": "fixture-private-key",
                        "message": "fixture-private-key",
                    }
                },
            ),
            {},
            ["cause undetermined", "Optional fields sent:"],
            ["Provider error references:"],
        ),
        (
            httpx.Response(400, text="fixture-private-key"),
            {},
            ["cause undetermined", "temperature", "max_tokens", "response_format"],
            ["Provider error references:"],
        ),
        (
            httpx.Response(
                400, text="Unsupported parameter: temperature; fixture-private-key"
            ),
            {},
            ["Provider error references: temperature", "LLM_TEMPERATURE=omit"],
            [],
        ),
        (
            httpx.Response(
                400, json="Unsupported parameter: max_tokens; fixture-private-key"
            ),
            {},
            ["Provider error references: max_tokens", "LLM_MAX_TOKENS=omit"],
            [],
        ),
        (
            httpx.Response(401, text="fixture-private-key"),
            {},
            ["API key", "access permissions"],
            ["Optional fields sent:"],
        ),
        (
            httpx.Response(404, text="fixture-private-key"),
            {},
            ["LLM_BASE_URL", "LLM_MODEL"],
            ["LLM_TEMPERATURE=omit"],
        ),
        (
            httpx.Response(429, text="fixture-private-key"),
            {},
            ["rate limits", "quota"],
            ["LLM_TEMPERATURE=omit"],
        ),
        (
            httpx.Response(503, text="fixture-private-key"),
            {},
            ["Provider/server failure"],
            ["LLM_TEMPERATURE=omit"],
        ),
    ],
)
async def test_http_errors_offer_safe_actionable_diagnostics(
    response, options, expected, absent, tmp_path
):
    calls = []

    def respond(request):
        calls.append(request)
        return response

    path = tmp_path / "failed.jsonl"
    tape = DecisionTape(
        LLMConfig(api_key="fixture-private-key", max_calls=1, **options),
        record=path,
        transport=httpx.MockTransport(respond),
    )
    with pytest.raises(DecisionError) as error:
        await tape.decide("JSON", {})
    message = str(error.value)
    assert f"HTTP {response.status_code}" in message
    assert all(fragment in message for fragment in expected)
    assert all(fragment not in message for fragment in absent)
    assert "fixture-private-key" not in message
    assert "no automatic retry" in message
    assert path.read_text() == ""
    assert tape.cursor == 0 and tape.live_calls == len(calls) == 1
    with pytest.raises(BudgetExceeded):
        await tape.decide("JSON", {})
    await tape.close()


@pytest.mark.asyncio
async def test_http_failure_rolls_back_an_entire_model_step():
    calls = []

    def respond(request):
        calls.append(request)
        if len(calls) == 1:
            return completion({"name": "Q"})
        return httpx.Response(400, json={"error": {"param": "temperature"}})

    tape = DecisionTape(
        LLMConfig(api_key="fixture"), transport=httpx.MockTransport(respond)
    )
    model = NamingGame(NamingConfig(agents=4), tape)
    before = model.capture()
    with pytest.raises(DecisionError, match="LLM_TEMPERATURE=omit"):
        await model.step()
    assert model.capture() == before
    assert len(calls) == tape.live_calls == 2
    await tape.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response,expected",
    [
        (completion({}, finish_reason="length"), "truncated (finish_reason=length)"),
        (completion({}, finish_reason="content_filter"), "did not finish normally"),
        (completion([]), "must return a JSON object"),
        (httpx.Response(200, json=[]), "malformed completion"),
        (httpx.Response(200, json={"usage": None}), "malformed completion"),
        (httpx.Response(200, json={"choices": [None]}), "malformed completion"),
        (
            httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {"content": "fixture-private-key"},
                        }
                    ]
                },
            ),
            "did not return valid JSON",
        ),
    ],
)
async def test_output_failures_explain_the_failure_without_echoing_content(
    response, expected
):
    tape = DecisionTape(
        LLMConfig(api_key="fixture-private-key", response_format=None),
        transport=httpx.MockTransport(lambda _: response),
    )
    with pytest.raises(DecisionError) as error:
        await tape.decide("JSON", {})
    assert expected in str(error.value)
    assert "fixture-private-key" not in str(error.value)
    assert tape.cursor == 0 and tape.live_calls == 1
    await tape.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "exception,expected",
    [(httpx.ReadTimeout, "LLM_TIMEOUT"), (httpx.ConnectError, "LLM_BASE_URL")],
)
async def test_transport_errors_are_actionable_and_never_echo_exception_text(
    exception, expected
):
    calls = []

    def respond(request):
        calls.append(request)
        raise exception("fixture-private-key", request=request)

    tape = DecisionTape(
        LLMConfig(api_key="fixture-private-key", max_calls=1),
        transport=httpx.MockTransport(respond),
    )
    with pytest.raises(DecisionError) as error:
        await tape.decide("JSON", {})
    assert expected in str(error.value)
    assert "fixture-private-key" not in str(error.value)
    assert tape.live_calls == len(calls) == 1 and tape.cursor == 0
    with pytest.raises(BudgetExceeded):
        await tape.decide("JSON", {})
    await tape.close()
