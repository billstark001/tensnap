"""A small OpenAI-compatible client with a replayable decision tape.

Only model prompts, JSON answers and usage enter the tape. Headers, credentials,
provider error bodies and reasoning content are never recorded or displayed.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any

from .config import LLMConfig, integer


class DecisionError(RuntimeError):
    """A public, credential-free inference or output-validation error."""


class BudgetExceeded(DecisionError):
    pass


class DecisionTape:
    """Cache by logical call index AND request fingerprint, preserving branches.

    Restoring the cursor reuses an already observed future when inputs match.
    Different inputs form another branch. Paid usage never rewinds. A recording
    can supply the same cache in a fresh process without contacting a provider.
    """

    def __init__(
        self,
        config: LLMConfig | None = None,
        *,
        record: Path | None = None,
        replay: Path | None = None,
        transport: Any = None,
    ) -> None:
        self.config = config
        self.record_path = record
        self.cursor = 0
        self.live_calls = 0
        self.replayed_calls = 0
        self.total_tokens = 0
        self._client = None
        self._transport = transport
        self._records: dict[tuple[int, str], dict] = {}
        if replay is not None:
            if config is not None:
                raise ValueError("Replay must not have live API configuration")
            for line in replay.read_text().splitlines():
                if not line.strip():
                    continue
                item = json.loads(line)
                key = (
                    integer(item["index"], "tape index", 0, 10**9),
                    item["fingerprint"],
                )
                if not isinstance(item["response"], dict):
                    raise TypeError("Invalid decision tape response")
                if key in self._records and self._records[key] != item:
                    raise ValueError("Conflicting decisions in replay tape")
                self._records[key] = item
        if record is not None:
            record.parent.mkdir(parents=True, exist_ok=True)
            # Prevent accidentally mixing independent recordings.
            with record.open("x", encoding="utf-8"):
                pass
            record.chmod(0o600)

    @property
    def mode(self) -> str:
        return "llm" if self.config is not None else "replay"

    @property
    def identity(self) -> dict:
        if self.config is not None:
            return {"model": self.config.model, "temperature": self.config.temperature}
        return {"model": "recorded"}

    def status(self) -> dict:
        return {
            "mode": self.mode,
            "cursor": self.cursor,
            "live_calls": self.live_calls,
            "replayed_calls": self.replayed_calls,
            "total_tokens": self.total_tokens,
            "max_calls": self.config.max_calls if self.config else 0,
        }

    async def decide(self, system: str, observation: dict) -> dict:
        request = {"system": system, "observation": observation}
        serialized = json.dumps(request, sort_keys=True, ensure_ascii=False)
        if len(serialized) > 16000:
            raise DecisionError("Decision prompt exceeds the 16,000 character limit")
        fingerprint = hashlib.sha256(serialized.encode()).hexdigest()
        key = (self.cursor, fingerprint)
        if key in self._records:
            self.cursor += 1
            self.replayed_calls += 1
            return copy.deepcopy(self._records[key]["response"])
        if self.config is None:
            raise DecisionError(
                f"Replay has no matching decision at index {self.cursor}"
            )
        cfg = self.config
        if self.live_calls >= cfg.max_calls:
            raise BudgetExceeded(
                f"Live request budget exhausted ({cfg.max_calls}); no request sent"
            )
        import httpx

        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=cfg.timeout,
                transport=self._transport,
                follow_redirects=False,
            )
        self.live_calls += 1  # Failed requests also consume the budget. No retries.
        try:
            response = await self._client.post(
                cfg.base_url.rstrip("/") + "/chat/completions",
                headers={"Authorization": f"Bearer {cfg.api_key}"},
                json={
                    "model": cfg.model,
                    "messages": [
                        {"role": "system", "content": system},
                        {
                            "role": "user",
                            "content": json.dumps(observation, ensure_ascii=False),
                        },
                    ],
                    "response_format": {"type": "json_object"},
                    "temperature": cfg.temperature,
                    "max_tokens": cfg.max_tokens,
                    "stream": False,
                    **cfg.extra_body,
                },
            )
        except httpx.HTTPError:
            raise DecisionError(
                "LLM transport failed; no automatic retry was attempted"
            ) from None
        if response.status_code != 200:
            raise DecisionError(
                f"LLM returned HTTP {response.status_code}; response body withheld"
            )
        try:
            body = response.json()
            usage = body.get("usage", {})
            tokens = integer(usage.get("total_tokens", 0), "usage tokens", 0, 10**9)
            self.total_tokens += tokens
            choice = body["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("incomplete")
            answer = json.loads(choice["message"]["content"])
            if not isinstance(answer, dict):
                raise TypeError("non-object")
        except (ValueError, TypeError, KeyError, IndexError):
            raise DecisionError(
                "LLM must return a complete JSON object; no retry attempted"
            ) from None
        item = {
            "index": self.cursor,
            "fingerprint": fingerprint,
            "request": request,
            "response": answer,
            "model": cfg.model,
            "total_tokens": tokens,
        }
        self._records[key] = item
        if self.record_path is not None:
            with self.record_path.open("a", encoding="utf-8") as stream:
                stream.write(json.dumps(item, ensure_ascii=False) + "\n")
        self.cursor += 1
        return copy.deepcopy(answer)

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()


def text_field(answer: dict, key: str, limit: int | None = 160) -> str:
    value = answer.get(key, "")
    if not isinstance(value, str):
        raise DecisionError(f"Decision {key} must be a string")
    if limit is not None and len(value) > limit:
        raise DecisionError(
            f"Decision {key} must be a string of at most {limit} characters"
        )
    return value


def display_text(value: str, limit: int = 160) -> str:
    """Shorten presentation only; callers keep the original model/tape text."""
    return value if len(value) <= limit else value[: limit - 1] + "…"
