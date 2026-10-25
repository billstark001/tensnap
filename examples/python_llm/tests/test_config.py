"""Provider options, omission semantics and configuration precedence."""

from pathlib import Path

import pytest

from examples.python_llm.common.config import REQUEST_OPTIONS, LLMConfig


@pytest.fixture(autouse=True)
def isolated_configuration(monkeypatch):
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
    monkeypatch.setenv("LLM_API_KEY", "fixture")


def test_cli_overrides_environment_overrides_env_file_and_defaults(
    tmp_path, monkeypatch
):
    env = tmp_path / "provider.env"
    env.write_text(
        "LLM_TEMPERATURE=0.1\nLLM_MAX_TOKENS=64\nLLM_TOP_P=0.3\n"
        "LLM_RESPONSE_FORMAT=json_object\nLLM_EXTRA_BODY={}\n"
    )
    monkeypatch.setenv("LLM_TEMPERATURE", "0.5")
    monkeypatch.setenv("LLM_MAX_TOKENS", "invalid-but-overridden")
    monkeypatch.setenv("LLM_RESPONSE_FORMAT", "text")
    config = LLMConfig.load(env, temperature="omit", max_tokens="256")
    assert config.temperature is None
    assert config.max_tokens == 256
    assert config.top_p == 0.3
    assert config.response_format == "text"
    assert config.stream is False
    assert config.extra_body == {}
    # CLI defaults (None) must not erase file/environment settings.
    assert LLMConfig.load(env, temperature=None, max_tokens="omit").temperature == 0.5


@pytest.mark.parametrize("name", REQUEST_OPTIONS)
def test_environment_omit_is_distinct_from_unset(name, monkeypatch):
    monkeypatch.setenv(f"LLM_{name.upper()}", "omit")
    config = LLMConfig.load()
    assert getattr(config, name) is None
    assert name not in config.request_options()
    assert config.effective_settings()["request_options"][name] == "omitted"


def test_additional_sampling_options_and_alternative_token_limit(monkeypatch):
    for name, value in {
        "MAX_TOKENS": "omit",
        "MAX_COMPLETION_TOKENS": "512",
        "TOP_P": "0.8",
        "PRESENCE_PENALTY": "0",
        "FREQUENCY_PENALTY": "-0.5",
        "STREAM": "omit",
    }.items():
        monkeypatch.setenv(f"LLM_{name}", value)
    config = LLMConfig.load()
    options = config.request_options()
    assert "max_tokens" not in options and "stream" not in options
    assert options["max_completion_tokens"] == 512
    assert options["top_p"] == 0.8
    assert options["presence_penalty"] == 0
    assert options["frequency_penalty"] == -0.5
    assert config.effective_settings()["output_token_limit"] == 512


@pytest.mark.parametrize(
    "name,value",
    [
        ("MAX_TOKENS", ""),
        ("MAX_TOKENS", "none"),
        ("MAX_TOKENS", "null"),
        ("MAX_TOKENS", "1.5"),
        ("MAX_TOKENS", "0"),
        ("MAX_TOKENS", "4097"),
        ("TEMPERATURE", ""),
        ("TEMPERATURE", "nan"),
        ("TEMPERATURE", "inf"),
        ("TEMPERATURE", "2.1"),
        ("TOP_P", "1.1"),
        ("TOP_P", "-0.1"),
        ("PRESENCE_PENALTY", "2.1"),
        ("FREQUENCY_PENALTY", "-2.1"),
        ("MAX_COMPLETION_TOKENS", "invalid"),
        ("RESPONSE_FORMAT", ""),
        ("RESPONSE_FORMAT", "   "),
        ("STREAM", "true"),
        ("STREAM", "0"),
        ("STREAM", ""),
        ("MAX_CALLS", "omit"),
        ("TIMEOUT", "omit"),
        ("EXTRA_BODY", "{"),
    ],
)
def test_invalid_settings_name_the_variable_without_echoing_values(
    name, value, monkeypatch
):
    monkeypatch.setenv(f"LLM_{name}", value)
    with pytest.raises(ValueError, match=f"LLM_{name}"):
        LLMConfig.load()


def test_output_limit_names_must_not_conflict(monkeypatch):
    monkeypatch.setenv("LLM_MAX_COMPLETION_TOKENS", "256")
    with pytest.raises(ValueError, match="LLM_MAX_TOKENS=omit"):
        LLMConfig.load()


@pytest.mark.parametrize("value", [True, "", "omit", -1, float("nan")])
def test_direct_numeric_configuration_is_validated(value):
    with pytest.raises((ValueError, TypeError), match="LLM_TEMPERATURE"):
        LLMConfig(api_key="fixture", temperature=value)


def test_extra_body_cannot_reintroduce_omitted_standard_fields():
    with pytest.raises(ValueError, match="LLM_EXTRA_BODY only accepts"):
        LLMConfig(api_key="fixture", temperature=None, extra_body={"temperature": 0.7})


def test_effective_settings_exclude_secrets_urls_and_extra_values():
    config = LLMConfig(
        api_key="fixture-private-key",
        base_url="https://private-host.invalid",
        extra_body={"thinking": {"private": "fixture-private-extra"}},
    )
    settings = config.effective_settings()
    assert settings["extra_body_fields"] == ["thinking"]
    assert "fixture-private" not in str(settings)
    assert "private-host" not in str(settings)
    assert "fixture-private-key" not in repr(config)


def test_env_example_retains_default_request_options():
    example = Path(__file__).resolve().parents[1] / ".env.example"
    assert (
        LLMConfig.load(example).request_options() == LLMConfig.load().request_options()
    )


def test_custom_format_named_omitted_is_distinguishable_from_omission():
    settings = LLMConfig(
        api_key="fixture", response_format="omitted"
    ).effective_settings()
    assert settings["request_options"]["response_format"] == "omitted"
    assert "response_format" not in settings["omitted_fields"]
