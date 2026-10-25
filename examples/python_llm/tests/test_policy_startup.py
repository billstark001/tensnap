"""Startup credentials enable policy selection without starting paid decisions."""

import json
from unittest.mock import AsyncMock

import httpx
import pytest

from examples.python_llm.common import cli, viz
from examples.python_llm.common.config import REQUEST_OPTIONS, LLMConfig
from examples.python_llm.common.llm import DecisionTape
from examples.python_llm.mini_commons_harvest.__main__ import (
    add_arguments as commons_arguments,
)
from examples.python_llm.mini_commons_harvest.model import CommonsConfig, MiniCommons
from examples.python_llm.mini_commons_harvest.viz import CommonsView
from examples.python_llm.naming_game.__main__ import add_arguments as naming_arguments
from examples.python_llm.naming_game.model import NamingConfig, NamingGame
from examples.python_llm.naming_game.viz import NamingView

MODELS = [
    ("naming_game", NamingGame, NamingConfig, NamingView, naming_arguments, 2),
    (
        "mini_commons_harvest",
        MiniCommons,
        CommonsConfig,
        CommonsView,
        commons_arguments,
        1,
    ),
]
API_KEYS = ("LLM_API_KEY", "DEEPSEEK_API_KEY", "API_SECRET", "OPENAI_API_KEY")


@pytest.fixture(autouse=True)
def isolated_credentials(monkeypatch):
    for name in [
        *API_KEYS,
        "LLM_BASE_URL",
        "LLM_MODEL",
        "LLM_EXTRA_BODY",
        "LLM_MAX_CALLS",
        "LLM_TIMEOUT",
        *(f"LLM_{name.upper()}" for name in REQUEST_OPTIONS),
    ]:
        monkeypatch.delenv(name, raising=False)


def test_optional_configuration_requires_a_key_and_validates_supplied_settings(
    tmp_path,
):
    config = tmp_path / "provider.env"
    config.write_text("LLM_MODEL=fixture-model\n")
    assert LLMConfig.load(config, required=False) is None
    with pytest.raises(ValueError, match="LLM_API_KEY"):
        LLMConfig.load(config)
    config.write_text("LLM_API_KEY=fixture-key\nLLM_MAX_CALLS=invalid\n")
    with pytest.raises(ValueError, match="Invalid numeric"):
        LLMConfig.load(config, required=False)


@pytest.mark.parametrize("alias", API_KEYS)
def test_optional_configuration_accepts_all_key_aliases(alias, monkeypatch):
    monkeypatch.setenv(alias, "fixture-key")
    assert LLMConfig.load(required=False).api_key == "fixture-key"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,model_type,config_type,view_type,arguments,calls_per_step", MODELS
)
@pytest.mark.parametrize("source", ["environment", "env-file"])
async def test_rule_server_credentials_enable_llm_without_initial_requests(
    kind,
    model_type,
    config_type,
    view_type,
    arguments,
    calls_per_step,
    source,
    monkeypatch,
    tmp_path,
):
    options = [
        "serve",
        "--max-calls",
        "4",
        "--record",
        str(tmp_path / "decisions.jsonl"),
    ]
    secret = "fixture-startup-key"
    if source == "environment":
        monkeypatch.setenv("LLM_API_KEY", secret)
    else:
        env_file = tmp_path / "provider.env"
        env_file.write_text(f"API_SECRET={secret}\n")
        options += ["--env-file", str(env_file)]
    args = cli.parser(kind, config_type(), arguments).parse_args(options)
    calls, tapes = [], []

    def respond(request):
        assert request.headers["authorization"] == f"Bearer {secret}"
        calls.append(request)
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps({"name": "Q", "action": "wait"})
                        },
                    }
                ],
                "usage": {"total_tokens": 5},
            },
        )

    def tape_factory(*args, **kwargs):
        tape = DecisionTape(*args, **kwargs, transport=httpx.MockTransport(respond))
        tapes.append(tape)
        return tape

    async def inspect_server(kind, model, port, view_type, *, providers):
        assert model.provider is None
        tape = providers["llm"]
        assert tape._client is None and not calls
        scenario, view = await viz.build_scenario(model, view_type, providers=providers)
        await scenario._advance_step()
        assert not calls and tape._client is None
        scenario.server.send = AsyncMock()
        await scenario._on_param_change(None, {"id": "policy", "value": "llm"})
        scenario.server.send.assert_not_awaited()
        assert view.policy == "llm" and model.provider is None
        assert not calls
        await scenario.reset()
        assert model.provider is tape
        await scenario._advance_step()
        assert len(calls) == tape.live_calls == calls_per_step
        assert tape.config.max_calls == 4
        assert secret not in json.dumps(view.capture())
        assert secret not in json.dumps(view.inference())
        scenario.parameters["policy"].setter("rule")
        await scenario.reset()
        await scenario._advance_step()
        assert model.provider is None and len(calls) == calls_per_step
        scenario.parameters["policy"].setter("llm")
        await scenario.reset()
        await scenario._advance_step()
        assert model.provider is tape
        assert len(calls) == tape.live_calls == calls_per_step
        assert tape.replayed_calls == calls_per_step

    monkeypatch.setattr(cli, "DecisionTape", tape_factory)
    monkeypatch.setattr(viz, "serve", inspect_server)
    assert (
        await cli.execute(kind, model_type, config_type, lambda: view_type, args) == 0
    )
    assert tapes[0]._client.is_closed
    assert secret not in args.record.read_text()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,model_type,config_type,view_type,arguments,_calls", MODELS
)
async def test_rule_server_without_credentials_rejects_llm_selection(
    kind,
    model_type,
    config_type,
    view_type,
    arguments,
    _calls,
    monkeypatch,
):
    args = cli.parser(kind, config_type(), arguments).parse_args(["serve"])

    async def inspect_server(kind, model, port, view_type, *, providers):
        assert providers == {} and model.provider is None
        scenario, view = await viz.build_scenario(model, view_type, providers=providers)
        before = view.capture()
        with pytest.raises(ValueError, match="credentials are not configured"):
            scenario.parameters["policy"].setter("llm")
        assert view.capture() == before
        assert view.policy == "rule"

    monkeypatch.setattr(viz, "serve", inspect_server)
    assert (
        await cli.execute(kind, model_type, config_type, lambda: view_type, args) == 0
    )


@pytest.mark.asyncio
async def test_simultaneous_live_and_replay_providers_restore_the_correct_mode(
    tmp_path,
):
    path = tmp_path / "empty.jsonl"
    path.write_text("")
    live = DecisionTape(LLMConfig(api_key="fixture"))
    replay = DecisionTape(replay=path)
    model = NamingGame(provider=replay)
    scenario, view = await viz.build_scenario(
        model, NamingView, providers={"llm": live, "replay": replay}
    )
    replay_saved = view.capture()
    scenario.parameters["policy"].setter("llm")
    pending = view.capture()
    await scenario.reset()
    assert model.provider is live
    live_saved = view.capture()
    view.restore(replay_saved)
    assert model.provider is replay and view.policy == "replay"
    view.restore(live_saved)
    assert model.provider is live and view.policy == "llm"
    view.restore(pending)
    assert model.provider is replay and view.policy == "llm"
    # Old view checkpoints retain their original single-provider behavior.
    del replay_saved["controls"]["active_policy"]
    view.restore(replay_saved)
    assert model.provider is replay
    assert live._client is None
    assert set(view.inference()["available_policies"]) == {"rule", "llm", "replay"}


@pytest.mark.asyncio
async def test_headless_rule_execution_does_not_load_provider_credentials(monkeypatch):
    args = cli.parser("naming_game", NamingConfig(), naming_arguments).parse_args(
        ["run", "--steps", "1"]
    )

    def unexpected_load(*args, **kwargs):
        raise AssertionError("Headless rules should not load provider configuration")

    monkeypatch.setattr(cli.LLMConfig, "load", unexpected_load)
    assert (
        await cli.execute(
            "naming_game", NamingGame, NamingConfig, lambda: NamingView, args
        )
        == 0
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("active_policy", ["rule", "llm"])
async def test_startup_and_inference_show_effective_settings_without_requests(
    active_policy, monkeypatch, capsys
):
    live = DecisionTape(
        LLMConfig(
            api_key="fixture-private-key",
            temperature=None,
            max_tokens=None,
            response_format=None,
            extra_body={"thinking": {"private": "fixture-private-extra"}},
        )
    )
    model = NamingGame(provider=live if active_policy == "llm" else None)
    captured = []
    build_scenario = viz.build_scenario

    async def capture_scenario(*args, **kwargs):
        scenario, view = await build_scenario(*args, **kwargs)
        scenario.run = AsyncMock()
        captured.append((scenario, view))
        return scenario, view

    monkeypatch.setattr(viz, "build_scenario", capture_scenario)
    await viz.serve("naming_game", model, 8765, NamingView, providers={"llm": live})
    output = capsys.readouterr().out
    settings = json.loads(output.split("LLM effective settings: ", 1)[1])
    assert settings["request_options"]["temperature"] == "omitted"
    assert settings["output_token_limit"] is None
    assert "No output token limit sent by client" in output
    assert "fixture-private" not in output
    scenario, view = captured[0]
    scenario.run.assert_awaited_once()
    assert view.inference()["settings"] == settings
    assert view.inference()["active_policy"] == active_policy
    assert live._client is None and live.live_calls == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kind,model_type,config_type,view_type,arguments,calls_per_step", MODELS
)
async def test_cli_provider_options_reach_wire_and_headless_report(
    kind,
    model_type,
    config_type,
    view_type,
    arguments,
    calls_per_step,
    monkeypatch,
    tmp_path,
    capsys,
):
    env = tmp_path / "provider.env"
    env.write_text(
        "LLM_API_KEY=fixture-private-key\nLLM_TEMPERATURE=0.2\n"
        "LLM_MAX_TOKENS=128\nLLM_EXTRA_BODY={}\n"
    )
    monkeypatch.setenv("LLM_TEMPERATURE", "0.5")
    args = cli.parser(kind, config_type(), arguments).parse_args(
        [
            "run",
            "--policy",
            "llm",
            "--env-file",
            str(env),
            "--steps",
            "1",
            "--temperature",
            "omit",
            "--max-tokens",
            "omit",
            "--max-completion-tokens",
            "256",
            "--response-format",
            "vendor/custom",
            "--stream",
            "omit",
            "--top-p",
            "0.8",
            "--presence-penalty",
            "0.2",
            "--frequency-penalty",
            "-0.2",
        ]
    )
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "stop",
                        "message": {
                            "content": json.dumps({"name": "Q", "action": "wait"}),
                        },
                    }
                ]
            },
        )

    def tape_factory(*args, **kwargs):
        return DecisionTape(*args, **kwargs, transport=httpx.MockTransport(respond))

    monkeypatch.setattr(cli, "DecisionTape", tape_factory)
    assert (
        await cli.execute(kind, model_type, config_type, lambda: view_type, args) == 0
    )
    assert len(requests) == calls_per_step
    for payload in requests:
        assert "temperature" not in payload and "max_tokens" not in payload
        assert "stream" not in payload and "thinking" not in payload
        assert payload["max_completion_tokens"] == 256
        assert payload["response_format"] == {"type": "vendor/custom"}
        assert payload["top_p"] == 0.8
        assert payload["presence_penalty"] == 0.2
        assert payload["frequency_penalty"] == -0.2
    output = capsys.readouterr().out
    report = json.loads(output)
    assert report["inference"]["settings"]["output_token_limit"] == 256
    assert (
        report["inference"]["settings"]["request_options"]["temperature"] == "omitted"
    )
    assert "fixture-private-key" not in output
