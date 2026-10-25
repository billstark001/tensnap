"""Read an explicitly selected dotenv file as data, never as shell code."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

# These fields are optional on the wire, independently of their local defaults.
REQUEST_OPTIONS = (
    "temperature",
    "max_tokens",
    "response_format",
    "stream",
    "max_completion_tokens",
    "top_p",
    "presence_penalty",
    "frequency_penalty",
)


def _number(value, name, convert):
    try:
        if isinstance(value, bool):
            raise TypeError
        if convert is int and isinstance(value, float) and not value.is_integer():
            raise ValueError
        return convert(value)
    except (ValueError, TypeError, OverflowError):
        raise ValueError(
            f"Invalid numeric {name}; expected {convert.__name__}"
        ) from None


def _optional(value, name, convert):
    if isinstance(value, str) and value.strip().lower() == "omit":
        return None
    if convert is str:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{name} must be a nonempty string or omit")
        return value.strip()
    return _number(value, name, convert)


def _range(value, name, low, high):
    if value is not None and (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"{name} must be in [{low}, {high}] or omit")


def integer(value: object, name: str, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be an integer in [{low}, {high}]")
    if not math.isfinite(value) or int(value) != value or not low <= value <= high:
        raise ValueError(f"{name} must be an integer in [{low}, {high}]")
    return int(value)


def probability(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"{name} must be between zero and one")
    if not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{name} must be between zero and one")
    return float(value)


@dataclass(frozen=True)
class LLMConfig:
    api_key: str = field(repr=False)
    base_url: str = "https://api.deepseek.com"
    model: str = "deepseek-flash"
    max_calls: int = 32
    max_tokens: int | None = 128
    timeout: float = 45
    temperature: float | None = 0.7
    extra_body: dict = field(default_factory=dict, repr=False)
    response_format: str | None = "json_object"
    stream: bool | None = False
    max_completion_tokens: int | None = None
    top_p: float | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None

    def __post_init__(self) -> None:
        url = urlsplit(self.base_url)
        if url.scheme not in ("http", "https") or not url.hostname:
            raise ValueError("LLM_BASE_URL must be an HTTP(S) URL")
        if url.username or url.password or url.query or url.fragment:
            raise ValueError(
                "LLM_BASE_URL cannot contain credentials, query, or fragment"
            )
        if not self.api_key or not self.model:
            raise ValueError(
                "Set LLM_API_KEY (or DEEPSEEK_API_KEY/API_SECRET) and LLM_MODEL"
            )
        integer(self.max_calls, "LLM_MAX_CALLS", 1, 10000)
        for name in ("max_tokens", "max_completion_tokens"):
            if getattr(self, name) is not None:
                integer(getattr(self, name), f"LLM_{name.upper()}", 16, 4096)
        if self.max_tokens is not None and self.max_completion_tokens is not None:
            raise ValueError(
                "Choose one output limit: set LLM_MAX_TOKENS=omit when using "
                "LLM_MAX_COMPLETION_TOKENS (or --max-tokens omit)"
            )
        if not math.isfinite(self.timeout) or not 0 < self.timeout <= 300:
            raise ValueError("LLM_TIMEOUT must be in (0, 300]")
        _range(self.temperature, "LLM_TEMPERATURE", 0, 2)
        _range(self.top_p, "LLM_TOP_P", 0, 1)
        _range(self.presence_penalty, "LLM_PRESENCE_PENALTY", -2, 2)
        _range(self.frequency_penalty, "LLM_FREQUENCY_PENALTY", -2, 2)
        if self.response_format is not None and (
            not isinstance(self.response_format, str)
            or not self.response_format.strip()
        ):
            raise ValueError("LLM_RESPONSE_FORMAT must be a nonempty string or omit")
        if self.stream is not None and self.stream is not False:
            raise ValueError(
                "LLM_STREAM must be false or omit; streaming is unsupported"
            )
        if not isinstance(self.extra_body, dict) or set(self.extra_body) - {
            "thinking",
            "reasoning_effort",
        }:
            raise ValueError(
                "LLM_EXTRA_BODY only accepts thinking and reasoning_effort"
            )

    def request_options(self) -> dict:
        """Only explicitly enabled options; omitted fields never become JSON null."""
        options = {
            name: getattr(self, name)
            for name in REQUEST_OPTIONS
            if getattr(self, name) is not None
        }
        if "response_format" in options:
            options["response_format"] = {"type": options["response_format"]}
        return {**options, **self.extra_body}

    def effective_settings(self) -> dict:
        """Public settings: never include credentials, URLs or extra-body values."""
        limit = (
            self.max_tokens
            if self.max_tokens is not None
            else self.max_completion_tokens
        )
        return {
            "model": self.model,
            "request_options": {
                name: getattr(self, name)
                if getattr(self, name) is not None
                else "omitted"
                for name in REQUEST_OPTIONS
            },
            "extra_body_fields": sorted(self.extra_body),
            "omitted_fields": [
                name for name in REQUEST_OPTIONS if getattr(self, name) is None
            ],
            "timeout_seconds": self.timeout,
            "output_token_limit": limit,
            "output_token_limit_note": "Requested from provider"
            if limit is not None
            else "No output token limit sent by client",
            "max_calls": self.max_calls,
        }

    @classmethod
    def load(
        cls, env_file: Path | None = None, *, required: bool = True, **overrides
    ) -> LLMConfig | None:
        values = {}
        if env_file is not None:
            from dotenv import dotenv_values

            if not env_file.is_file():
                raise ValueError("The specified environment file does not exist")
            values.update(dotenv_values(env_file, interpolate=False))
        # Existing environment values take precedence over file values.
        values.update(os.environ)
        api_key = (
            values.get("LLM_API_KEY")
            or values.get("DEEPSEEK_API_KEY")
            or values.get("API_SECRET")
            or values.get("OPENAI_API_KEY", "")
        )
        if overrides.get("api_key") is not None:
            api_key = overrides["api_key"]
        if not api_key and not required:
            return None

        def setting(name, default):
            override = overrides.get(name)
            return (
                override
                if override is not None
                else values.get(f"LLM_{name.upper()}", default)
            )

        base_url = setting("base_url", "https://api.deepseek.com")
        default_extra = (
            '{"thinking":{"type":"disabled"}}'
            if urlsplit(base_url).hostname == "api.deepseek.com"
            else "{}"
        )
        kwargs = {
            "api_key": api_key,
            "base_url": base_url,
            "model": setting("model", "deepseek-flash"),
            "max_calls": _number(setting("max_calls", "32"), "LLM_MAX_CALLS", int),
            "timeout": _number(setting("timeout", "45"), "LLM_TIMEOUT", float),
        }
        for name, default, convert in (
            ("max_tokens", "128", int),
            ("temperature", "0.7", float),
            ("response_format", "json_object", str),
            ("max_completion_tokens", "omit", int),
            ("top_p", "omit", float),
            ("presence_penalty", "omit", float),
            ("frequency_penalty", "omit", float),
        ):
            kwargs[name] = _optional(
                setting(name, default), f"LLM_{name.upper()}", convert
            )
        stream = setting("stream", "false")
        if stream is False or (
            isinstance(stream, str) and stream.strip().lower() == "false"
        ):
            kwargs["stream"] = False
        elif isinstance(stream, str) and stream.strip().lower() == "omit":
            kwargs["stream"] = None
        else:
            raise ValueError(
                "LLM_STREAM must be false or omit; streaming is unsupported"
            )
        try:
            extra = setting("extra_body", default_extra)
            kwargs["extra_body"] = (
                json.loads(extra) if isinstance(extra, str) else extra
            )
        except (ValueError, TypeError):
            raise ValueError(
                "Invalid JSON LLM_EXTRA_BODY; expected an object"
            ) from None
        return cls(**kwargs)
