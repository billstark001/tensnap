"""CNY reservations and shared exact-input tapes for a bounded live pilot.

The ledger belongs to one asyncio event loop. Its state changes contain no
await, so concurrent HTTP transports reserve funds before any network dispatch.
No credentials, headers or raw HTTP error bodies enter either journal.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import httpx

from .config import integer
from .llm import BudgetExceeded, DecisionError, DecisionTape

MILLION = Decimal(1000000)
PRICING = {
    "source": "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
    "checked_date": "2026-10-19",
    "model": "deepseek-flash",
    "model_version_listed": "DeepSeek-V4.1-Flash-1017",
    "peak_input_miss_cny_per_million": "2",
    "peak_input_hit_cny_per_million": "0.04",
    "peak_output_cny_per_million": "8",
    "safety_multiplier": "1.25",
    "input_bound": "UTF-8 content bytes + 1024 framing tokens for two text messages",
    "discount_policy": "Ignore all cache/time discounts for the spending guard",
}


def now():
    return datetime.now(timezone.utc).isoformat()


def append(path, item):
    with path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(item, ensure_ascii=False) + "\n")


def new_private(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.touch(exist_ok=False, mode=0o600)


class CNYLedger:
    def __init__(self, path: Path, limit="9.5", max_calls=5000):
        self.path = path
        self.limit = Decimal(limit)
        if not self.limit.is_finite() or not 0 < self.limit <= Decimal("9.5"):
            raise ValueError("The pilot spending guard must be in (0, 9.5] CNY")
        self.max_calls = integer(max_calls, "max_calls", 1, 5000)
        self.calls = 0
        self.spent = Decimal(0)
        self.peak_upper = Decimal(0)
        self.pending = {}
        self.unknown_usage = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.halted = False
        new_private(path)
        append(
            path,
            {
                "event": "start",
                "utc": now(),
                "limit_cny": str(self.limit),
                "pricing": PRICING,
            },
        )

    def reserve(self, request, branch):
        body = json.loads(request.content)
        if (
            str(request.url) != "https://api.deepseek.com/chat/completions"
            or body.get("model") != "deepseek-flash"
            or body.get("thinking") != {"type": "disabled"}
            or body.get("stream") is not False
            or "tools" in body
        ):
            raise DecisionError(
                "The CNY guard supports only text Flash with thinking disabled"
            )
        messages = body["messages"]
        if len(messages) != 2 or any(
            not isinstance(m.get("content"), str) for m in messages
        ):
            raise DecisionError("The CNY guard requires two text messages")
        input_bound = (
            sum(len(message["content"].encode("utf-8")) for message in messages) + 1024
        )
        output_bound = integer(body["max_tokens"], "max_tokens", 16, 192)
        peak = (Decimal(input_bound) * 2 + Decimal(output_bound) * 8) / MILLION
        reserved = peak * Decimal("1.25")
        if (
            self.halted
            or self.calls >= self.max_calls
            or self.spent + sum(self.pending.values()) + reserved > self.limit
        ):
            raise BudgetExceeded("Global CNY/call budget exhausted; no request sent")
        self.calls += 1
        identity = self.calls
        self.pending[identity] = reserved
        append(
            self.path,
            {
                "event": "reserve",
                "utc": now(),
                "id": identity,
                "branch": branch,
                "input_bound": input_bound,
                "output_bound": output_bound,
                "reserved_cny": str(reserved),
            },
        )
        return identity, input_bound, output_bound

    def settle(self, ticket, response=None, error=None):
        identity, input_bound, output_bound = ticket
        reserved = self.pending.pop(identity)
        usage, resolved = None, None
        if response is not None:
            try:
                body = response.json()
                usage = body.get("usage")
                resolved = body.get("model")
                if not isinstance(resolved, str):
                    resolved = None
            except (ValueError, AttributeError):
                pass
        known = False
        if isinstance(usage, dict):
            try:
                inputs = integer(usage["prompt_tokens"], "prompt usage", 0, input_bound)
                outputs = integer(
                    usage["completion_tokens"], "completion usage", 0, output_bound
                )
                integer(
                    usage["total_tokens"],
                    "total usage",
                    inputs + outputs,
                    inputs + outputs,
                )
                known = True
            except (KeyError, ValueError):
                # A bound violation halts further calls; missing usage is charged
                # at the full reservation, including failed/uncertain requests.
                if "prompt_tokens" in usage and "completion_tokens" in usage:
                    self.halted = True
        if known:
            peak = (Decimal(inputs) * 2 + Decimal(outputs) * 8) / MILLION
            debit = peak * Decimal("1.25")
            self.prompt_tokens += inputs
            self.completion_tokens += outputs
        else:
            self.unknown_usage += 1
            debit, peak = reserved, reserved / Decimal("1.25")
        self.spent += debit
        self.peak_upper += peak
        append(
            self.path,
            {
                "event": "settle",
                "utc": now(),
                "id": identity,
                "status": response.status_code if response is not None else None,
                "error_type": error,
                "usage": usage if known else None,
                "resolved_model": resolved,
                "peak_cost_upper_cny": str(peak),
                "guard_debit_cny": str(debit),
                "unknown_usage": not known,
            },
        )

    def status(self):
        return {
            "currency": "CNY",
            "limit_cny": str(self.limit),
            "live_requests": self.calls,
            "max_calls": self.max_calls,
            "guard_debit_cny": str(self.spent),
            "peak_cost_upper_cny": str(self.peak_upper),
            "reserved_cny": str(sum(self.pending.values())),
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "unknown_usage_requests": self.unknown_usage,
            "halted": self.halted,
        }


class GuardedTransport(httpx.AsyncBaseTransport):
    def __init__(self, ledger, branch, inner=None):
        self.ledger, self.branch = ledger, branch
        self.inner = inner if inner is not None else httpx.AsyncHTTPTransport(retries=0)

    async def handle_async_request(self, request):
        ticket = self.ledger.reserve(request, self.branch)
        try:
            response = await self.inner.handle_async_request(request)
            await response.aread()
        except BaseException as exc:
            self.ledger.settle(ticket, error=type(exc).__name__)
            raise
        self.ledger.settle(ticket, response=response)
        return response

    async def aclose(self):
        await self.inner.aclose()


class TapePool:
    """Couple identical potential responses at an index; changed inputs branch."""

    def __init__(self, path, ledger):
        self.path, self.ledger = path, ledger
        self.records, self.locks = {}, {}
        new_private(path)

    def client(self, config, branch, inner=None):
        return PooledTape(self, config, branch, inner)


class PooledTape(DecisionTape):
    def __init__(self, pool, config, branch, inner=None):
        super().__init__(config, transport=GuardedTransport(pool.ledger, branch, inner))
        self.pool, self.branch = pool, branch
        self._records = pool.records
        self.trace = []

    async def decide(self, system, observation):
        request = {"system": system, "observation": observation}
        fingerprint = hashlib.sha256(
            json.dumps(request, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()
        key = (self.cursor, fingerprint)
        lock = self.pool.locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = key in self.pool.records
            try:
                answer = await super().decide(system, observation)
            except DecisionError as exc:
                self.trace.append(
                    {"index": key[0], "fingerprint": fingerprint, "error": str(exc)}
                )
                raise
            if not cached:
                append(self.pool.path, self.pool.records[key])
            self.trace.append(
                {"index": key[0], "fingerprint": fingerprint, "cached": cached}
            )
            return copy.deepcopy(answer)


async def balance(config):
    """Return a CNY snapshot; keep credentials and remote error bodies private."""
    if config.base_url.rstrip("/") != "https://api.deepseek.com":
        raise ValueError("Balance checks require the official DeepSeek endpoint")
    async with httpx.AsyncClient(timeout=30, follow_redirects=False) as client:
        try:
            response = await client.get(
                config.base_url.rstrip("/") + "/user/balance",
                headers={"Authorization": f"Bearer {config.api_key}"},
            )
            if response.status_code != 200:
                raise ValueError("Balance check failed; response body withheld")
            body = response.json()
            cny = next(
                item for item in body["balance_infos"] if item["currency"] == "CNY"
            )
            amount = Decimal(cny["total_balance"])
            if not amount.is_finite() or not body["is_available"]:
                raise ValueError("No available CNY balance")
        except (httpx.HTTPError, KeyError, StopIteration, ArithmeticError):
            raise ValueError("Could not confirm available CNY balance") from None
    return {"utc": now(), "currency": "CNY", "total_balance": str(amount)}
