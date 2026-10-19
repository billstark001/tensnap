"""Continuation cannot reset the original money/call caps or repeat a stable run."""

import json
from decimal import Decimal

import httpx
import pytest

from examples.python_llm.common.llm import BudgetExceeded
from examples.python_llm.naming_pilot_continuation import RemainingLedger, run


def test_remaining_budget_and_global_call_cap_are_preserved(tmp_path):
    previous = {
        "limit_cny": "9.5",
        "guard_debit_cny": "9.49",
        "peak_cost_upper_cny": "7.592",
        "live_requests": 4999,
    }
    ledger = RemainingLedger(tmp_path / "budget.jsonl", previous)
    body = {
        "model": "deepseek-flash",
        "thinking": {"type": "disabled"},
        "stream": False,
        "messages": [
            {"role": "system", "content": "JSON"},
            {"role": "user", "content": "{}"},
        ],
        "max_tokens": 192,
    }
    request = httpx.Request(
        "POST", "https://api.deepseek.com/chat/completions", json=body
    )
    ticket = ledger.reserve(request, "supplement")
    response = httpx.Response(
        200,
        json={
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "total_tokens": 120,
            }
        },
    )
    ledger.settle(ticket, response=response)
    status = ledger.status()
    assert status["combined_live_requests"] == 5000
    assert Decimal(status["combined_guard_debit_cny"]) == Decimal("9.49045000")
    with pytest.raises(BudgetExceeded):
        ledger.reserve(request, "cannot-reset")
    assert ledger.calls == 1


@pytest.mark.asyncio
async def test_stable_primary_prefix_cannot_trigger_duplicate_paid_branches(tmp_path):
    (tmp_path / "naming").mkdir()
    (tmp_path / "report.json").write_text(json.dumps({"runs": []}))
    (tmp_path / "naming/prefix.json").write_text(
        json.dumps({"stable": True, "error": None, "checkpoint": {"tick": 384}})
    )
    (tmp_path / "plan.json").write_text(json.dumps({"naming": {"warmup_cutoff": 384}}))
    with pytest.raises(ValueError, match="only.*unstable"):
        await run(tmp_path, tmp_path / "no-credentials-read")
