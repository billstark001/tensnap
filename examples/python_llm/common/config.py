"""Read an explicitly selected dotenv file as data, never as shell code."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit


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
    max_tokens: int = 128
    timeout: float = 45
    temperature: float = 0.7
    extra_body: dict = field(default_factory=dict, repr=False)

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
        integer(self.max_tokens, "LLM_MAX_TOKENS", 16, 4096)
        if not math.isfinite(self.timeout) or not 0 < self.timeout <= 300:
            raise ValueError("LLM_TIMEOUT must be in (0, 300]")
        if not math.isfinite(self.temperature) or not 0 <= self.temperature <= 2:
            raise ValueError("LLM_TEMPERATURE must be in [0, 2]")
        if not isinstance(self.extra_body, dict) or set(self.extra_body) - {
            "thinking",
            "reasoning_effort",
        }:
            raise ValueError(
                "LLM_EXTRA_BODY only accepts thinking and reasoning_effort"
            )

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
        base_url = values.get("LLM_BASE_URL", "https://api.deepseek.com")
        default_extra = (
            '{"thinking":{"type":"disabled"}}'
            if urlsplit(base_url).hostname == "api.deepseek.com"
            else "{}"
        )
        try:
            kwargs = {
                "api_key": api_key,
                "base_url": base_url,
                "model": values.get("LLM_MODEL", "deepseek-flash"),
                "max_calls": int(values.get("LLM_MAX_CALLS", "32")),
                "max_tokens": int(values.get("LLM_MAX_TOKENS", "128")),
                "timeout": float(values.get("LLM_TIMEOUT", "45")),
                "temperature": float(values.get("LLM_TEMPERATURE", "0.7")),
                "extra_body": json.loads(values.get("LLM_EXTRA_BODY", default_extra)),
            }
        except (ValueError, TypeError):
            raise ValueError("Invalid numeric or JSON LLM configuration") from None
        kwargs.update(
            {key: value for key, value in overrides.items() if value is not None}
        )
        return cls(**kwargs)
