"""Offline spending, exact-input coupling and eight-condition collection tests."""

import asyncio
import json
from argparse import Namespace
from decimal import Decimal

import httpx
import pytest

from examples.python_llm import llm_experiments
from examples.python_llm.common import budget
from examples.python_llm.common.config import LLMConfig
from examples.python_llm.common.llm import BudgetExceeded, DecisionError, DecisionTape


def config():
    return LLMConfig(
        api_key="fixture-secret",
        max_calls=5000,
        max_tokens=192,
        extra_body={"thinking": {"type": "disabled"}},
    )


def response(answer):
    return httpx.Response(
        200,
        json={
            "model": "deepseek-flash",
            "choices": [
                {"finish_reason": "stop", "message": {"content": json.dumps(answer)}}
            ],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 20,
                "total_tokens": 120,
            },
        },
    )


@pytest.mark.asyncio
async def test_pending_reservations_block_before_network_and_never_rewind(tmp_path):
    ledger = budget.CNYLedger(tmp_path / "money.jsonl", limit=".005", max_calls=2)
    entered, release = asyncio.Event(), asyncio.Event()
    requests = []

    async def slow(request):
        requests.append(request)
        entered.set()
        await release.wait()
        return response({"name": "Q"})

    pool = budget.TapePool(tmp_path / "tape.jsonl", ledger)
    a = pool.client(config(), "a", httpx.MockTransport(slow))
    b = pool.client(config(), "b", httpx.MockTransport(slow))
    active = asyncio.create_task(a.decide("Return JSON", {"branch": 1}))
    await entered.wait()
    with pytest.raises(BudgetExceeded):
        await b.decide("Return JSON", {"branch": 2})
    assert len(requests) == ledger.calls == 1
    release.set()
    await active
    a.cursor = 0
    await a.decide("Return JSON", {"branch": 1})
    assert a.replayed_calls == 1 and ledger.calls == 1
    await b.decide("Return JSON", {"branch": 2})
    assert ledger.calls == len(requests) == 2
    b.cursor = 0
    with pytest.raises(BudgetExceeded):
        await b.decide("Return JSON", {"branch": 3})
    assert ledger.spent < Decimal(".005")
    assert not ledger.pending
    await a.close()
    await b.close()


@pytest.mark.asyncio
async def test_same_input_coalesces_concurrent_calls_and_tape_is_portable(tmp_path):
    ledger = budget.CNYLedger(tmp_path / "money.jsonl")
    pool = budget.TapePool(tmp_path / "tape.jsonl", ledger)
    count = 0

    async def respond(_):
        nonlocal count
        count += 1
        await asyncio.sleep(0.01)
        return response({"name": "Q"})

    clients = [
        pool.client(config(), str(i), httpx.MockTransport(respond)) for i in range(4)
    ]
    answers = await asyncio.gather(
        *(client.decide("Return JSON", {"same": True}) for client in clients)
    )
    assert answers == [{"name": "Q"}] * 4
    assert count == ledger.calls == 1
    assert sum(client.replayed_calls for client in clients) == 3
    answers[0]["name"] = "M"
    replay = DecisionTape(replay=tmp_path / "tape.jsonl")
    assert await replay.decide("Return JSON", {"same": True}) == {"name": "Q"}
    with pytest.raises(DecisionError):
        await replay.decide("Return JSON", {"changed": True})
    for client in clients:
        await client.close()
    assert "fixture-secret" not in (tmp_path / "tape.jsonl").read_text()
    assert "fixture-secret" not in (tmp_path / "money.jsonl").read_text()


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["http", "transport", "invalid_json"])
async def test_failed_requests_are_charged_without_retry_or_secret_leak(
    tmp_path, failure
):
    ledger = budget.CNYLedger(tmp_path / "money.jsonl", max_calls=1)
    pool = budget.TapePool(tmp_path / "tape.jsonl", ledger)
    count = 0

    def fail(request):
        nonlocal count
        count += 1
        if failure == "transport":
            raise httpx.ReadTimeout("fixture-secret", request=request)
        if failure == "http":
            return httpx.Response(500, text="fixture-secret")
        result = response({"name": "Q"})
        body = result.json()
        body["choices"][0]["message"]["content"] = "not JSON"
        return httpx.Response(200, json=body)

    client = pool.client(config(), "failure", httpx.MockTransport(fail))
    with pytest.raises(DecisionError) as caught:
        await client.decide("Return JSON", {})
    assert "fixture-secret" not in str(caught.value)
    assert count == ledger.calls == 1
    assert ledger.spent > 0 and not ledger.pending
    with pytest.raises(BudgetExceeded):
        await client.decide("Return JSON", {})
    assert count == 1
    assert "fixture-secret" not in (tmp_path / "money.jsonl").read_text()
    await client.close()


@pytest.mark.asyncio
async def test_eight_condition_pilot_and_exact_replay_without_network(
    tmp_path, monkeypatch
):
    actual_transport = budget.GuardedTransport

    def respond(request):
        body = json.loads(request.content)
        observation = json.loads(body["messages"][1]["content"])
        if "names" in observation:
            return response({"name": "Q", "note": "fixture"})
        actions = observation["legal_actions"]
        return response(
            {"action": "harvest" if "harvest" in actions else "wait", "message": ""}
        )

    monkeypatch.setattr(
        budget,
        "GuardedTransport",
        lambda ledger, branch, inner=None: actual_transport(
            ledger, branch, httpx.MockTransport(respond)
        ),
    )
    monkeypatch.setattr(llm_experiments.LLMConfig, "load", lambda *a, **k: config())
    monkeypatch.setattr(llm_experiments, "matched_rules", lambda *a: None)

    async def balance(_):
        return {"utc": "fixture", "currency": "CNY", "total_balance": "100"}

    monkeypatch.setattr(llm_experiments, "balance", balance)
    args = Namespace(
        seed=1,
        interactions=192,
        warmup=384,
        rounds=24,
        drought_start=5,
        drought_duration=5,
        output=tmp_path / "run",
        env_file=tmp_path / "unused",
    )
    await llm_experiments.run(args)
    report = json.loads((args.output / "report.json").read_text())
    assert report["prefix_stable"]
    assert len(report["runs"]) == 8
    assert all(run["status"] == "completed" for run in report["runs"])
    assert all(
        item["exact_checkpoint_and_metrics"] for item in report["replay_verification"]
    )
    assert all(item["exact_prefix_until_drought"] for item in report["paired_checks"])
    assert Decimal(report["budget"]["guard_debit_cny"]) <= Decimal("9.5")
    for path in args.output.rglob("*.json*"):
        assert "fixture-secret" not in path.read_text()
