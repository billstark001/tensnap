"""A small OpenAI-compatible client with a replayable decision tape.

Only model prompts, JSON answers and usage enter the tape. Headers, credentials,
raw provider error bodies and reasoning content are never recorded or displayed.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .config import REQUEST_OPTIONS, LLMConfig, integer


class DecisionError(RuntimeError):
    """A public, credential-free inference or output-validation error."""


class BudgetExceeded(DecisionError):
    pass


_ERROR_CODES = {
    "unsupported_parameter",
    "unsupported_value",
    "unknown_parameter",
    "invalid_parameter",
    "invalid_value",
    "invalid_request_error",
    "extra_forbidden",
    "model_not_found",
    "invalid_api_key",
    "insufficient_quota",
    "rate_limit_exceeded",
}


def _http_error(response, options: dict) -> str:
    """Extract known diagnostics, never echo arbitrary remote text or values."""
    fields, codes = set(), set()
    sent = {"model", "messages", *options}

    def parameter(value):
        if isinstance(value, str):
            parts = value.removeprefix("body.").split(".")
            if parts[0] in sent:
                fields.add(parts[0])

    def inspect(error):
        if isinstance(error, str):
            message = error
        elif isinstance(error, dict):
            parameter(error.get("param"))
            location = error.get("loc")
            if isinstance(location, list):
                for part in location:
                    parameter(part)
            for key in ("code", "type"):
                if isinstance(error.get(key), str) and error[key] in _ERROR_CODES:
                    codes.add(error[key])
            message = error.get("message", error.get("msg", ""))
        else:
            return
        # Several local servers put the parameter only in a textual error.
        # Report a reference, not a diagnosis of an unsupported parameter.
        if isinstance(message, str):
            for name in sent:
                if re.search(rf"(?<!\w){re.escape(name)}(?!\w)", message):
                    fields.add(name)

    if len(response.content) <= 65536:
        try:
            body = response.json()
        except ValueError:
            inspect(response.text)
            body = None
        if isinstance(body, str):
            inspect(body)
        if isinstance(body, dict):
            inspect(body.get("error", body))
            detail = body.get("detail")
            if isinstance(detail, list):
                for error in detail[:8]:
                    inspect(error)
            else:
                inspect(detail)

    parts = [f"LLM returned HTTP {response.status_code}."]
    if codes:
        parts.append(f"Provider error code/type: {', '.join(sorted(codes))}.")
    if response.status_code in (400, 422):
        if fields:
            parts.append(f"Provider error references: {', '.join(sorted(fields))}.")
            for name in sorted(fields):
                if name in REQUEST_OPTIONS:
                    alternative = "text or " if name == "response_format" else ""
                    parts.append(
                        f"Check provider support and value; set LLM_{name.upper()}="
                        f"{alternative}omit to change or exclude this field."
                    )
                elif name in ("thinking", "reasoning_effort"):
                    parts.append(
                        f"Check {name} in LLM_EXTRA_BODY; remove it or use "
                        "LLM_EXTRA_BODY={} to exclude extra fields."
                    )
        else:
            parts.append(
                "No recognized parameter error was returned; cause undetermined."
            )
        names = sorted(options)
        parts.append(
            "Optional fields sent: " + (", ".join(names) if names else "none") + "."
        )
        if not fields:
            parts.append(
                "Check provider support for these fields; LLM_<FIELD>=omit excludes "
                "a standard option, and LLM_EXTRA_BODY={} clears extra fields."
            )
    elif response.status_code in (401, 403):
        parts.append("Check the configured API key and provider access permissions.")
    elif response.status_code == 404:
        parts.append("Check LLM_BASE_URL and LLM_MODEL against the provider endpoint.")
    elif response.status_code == 429:
        parts.append("Check provider rate limits and account quota.")
    elif response.status_code >= 500:
        parts.append("Provider/server failure; check provider availability and logs.")
    parts.append("Raw response body withheld; no automatic retry was attempted.")
    return " ".join(parts)


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
            **({"settings": self.config.effective_settings()} if self.config else {}),
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
        options = cfg.request_options()
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
                    **options,
                },
            )
        except httpx.TimeoutException:
            raise DecisionError(
                "LLM request timed out; check provider availability and LLM_TIMEOUT; "
                "no automatic retry was attempted"
            ) from None
        except httpx.ConnectError:
            raise DecisionError(
                "LLM connection failed; check LLM_BASE_URL and network access; "
                "no automatic retry was attempted"
            ) from None
        except httpx.HTTPError:
            raise DecisionError(
                "LLM transport failed; no automatic retry was attempted"
            ) from None
        if response.status_code != 200:
            raise DecisionError(_http_error(response, options))
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise TypeError("non-object completion")
            usage = body.get("usage", {})
            if not isinstance(usage, dict):
                raise TypeError("non-object usage")
            tokens = integer(usage.get("total_tokens", 0), "usage tokens", 0, 10**9)
            self.total_tokens += tokens
            choice = body["choices"][0]
            if not isinstance(choice, dict):
                raise TypeError("non-object choice")
            finish_reason = choice.get("finish_reason")
            content = choice["message"]["content"]
        except (ValueError, TypeError, KeyError, IndexError):
            raise DecisionError(
                "LLM returned a malformed completion response or invalid usage; "
                "expected choices[0].message.content; no retry attempted"
            ) from None
        if finish_reason == "length":
            raise DecisionError(
                "LLM output was truncated (finish_reason=length); check the output "
                "token limit and provider limits; no retry attempted"
            )
        if finish_reason != "stop":
            raise DecisionError(
                "LLM completion did not finish normally (expected finish_reason=stop); "
                "no retry attempted"
            )
        try:
            answer = json.loads(content)
        except (ValueError, TypeError):
            raise DecisionError(
                "LLM did not return valid JSON; a JSON object is required even when "
                "LLM_RESPONSE_FORMAT=text or omit; no retry attempted"
            ) from None
        if not isinstance(answer, dict):
            raise DecisionError("LLM must return a JSON object; no retry attempted")
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
