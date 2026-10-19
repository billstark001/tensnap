"""Resume the two failed pilot cases without overwriting their original evidence.

Naming accepts full notes; Commons uses one explicit legal-action correction.
The first request remains identical and can reuse the original failed answer.
All new HTTP calls share the remainder of a cumulative 11.5-CNY guard (<12).
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import hashlib
import json
import shutil
from decimal import Decimal
from pathlib import Path

from .common.action_policy import LegalActionPolicy
from .common.budget import CNYLedger, TapePool, balance, now
from .common.config import LLMConfig
from .common.llm import DecisionError, DecisionTape
from .experiments import commons_outcome, physical_hash, write
from .llm_experiments import monitor, source_hashes
from .mini_commons_harvest.model import MiniCommons
from .naming_game.model import NamingGame


def merge_tapes(paths):
    records = {}
    for path in paths:
        source = DecisionTape(replay=path)
        for key, record in source._records.items():
            if key in records and records[key] != record:
                raise ValueError("Conflicting exact-input source tapes")
            records[key] = record
    return records


class CumulativeLedger(CNYLedger):
    def __init__(self, path, previous):
        self.previous = previous
        remaining = Decimal("11.5") - Decimal(previous["guard_debit_cny"])
        super().__init__(path, str(remaining), 5000 - previous["live_requests"])

    def status(self):
        result = super().status()
        result.update(
            previous=self.previous,
            combined_guard_debit_cny=str(
                self.spent + Decimal(self.previous["guard_debit_cny"])
            ),
            combined_peak_cost_upper_cny=str(
                self.peak_upper + Decimal(self.previous["peak_cost_upper_cny"])
            ),
            combined_live_requests=self.calls + self.previous["live_requests"],
            combined_limit_cny="11.5",
            user_limit_cny="12",
        )
        return result


def paths_for(parent):
    return [
        parent / "naming-unstable-prefix/naming/decisions.jsonl",
        parent / "commons/decisions.jsonl",
    ]


async def resume_case(old, pool, cfg, root, horizon, progress):
    identity, kind = old["id"], old["model"]
    tape = pool.client(cfg, identity)
    provider = LegalActionPolicy(tape) if kind == "commons" else tape
    model = (NamingGame if kind == "naming" else MiniCommons)(provider=provider)
    model.restore(old["checkpoint"])
    result = copy.deepcopy(old)
    result.update(
        status="running",
        error=None,
        resume_checkpoint=copy.deepcopy(old["checkpoint"]),
        original_completed_steps=old["completed_steps"],
        original_error=old["error"],
        repair_policy=(
            "full-note-retention" if kind == "naming" else "one-legal-action-correction"
        ),
    )
    result["decision_trace"] = [
        entry
        for entry in old["decision_trace"]
        if entry["index"] < old["checkpoint"]["decision_cursor"]
    ]
    progress[identity] = {"completed": old["completed_steps"], "horizon": horizon}
    streak = 0
    try:
        for elapsed in range(old["completed_steps"] + 1, horizon + 1):
            try:
                await model.step()
            except DecisionError as exc:
                result["error"] = str(exc)
                break
            metrics = model.metrics()
            result["events"].append(
                copy.deepcopy(
                    model.last_interaction if kind == "naming" else model.last_event
                )
            )
            if kind == "naming":
                result["series"].append(metrics)
                sampled = {
                    agent for event in model.events for agent in event["players"]
                }
                good = (
                    metrics["window_interactions"] == 4 * len(model.agents)
                    and metrics["ordinary_target_choice_share"] is not None
                    and metrics["ordinary_target_choice_share"] >= 0.9
                    and metrics["ordinary_target_last_share"] >= 0.9
                    and {p.id for p in model.agents} - model.committed_ids <= sampled
                )
                streak = streak + 1 if good else 0
                if (
                    streak >= 4 * len(model.agents)
                    and result["outcome"]["reversal_confirmation"] is None
                ):
                    result["outcome"]["reversal_confirmation"] = elapsed
                    result["outcome"]["right_censored"] = False
            elif model.tick % len(model.agents) == 0:
                result["series"].append(metrics)
                result["round_state_hashes"][str(model.tick // len(model.agents))] = (
                    physical_hash(model)
                )
            progress[identity]["completed"] = elapsed
    finally:
        if result["error"] is None and len(result["events"]) != horizon:
            result["error"] = "Interrupted before the requested horizon"
        result.update(
            status="failed" if result["error"] else "completed",
            checkpoint=model.capture(),
            metrics=model.metrics(),
            completed_steps=len(result["events"]),
            resumed_steps=len(result["events"]) - old["completed_steps"],
            inference=tape.status(),
        )
        result["decision_trace"].extend(tape.trace)
        if kind == "commons":
            result["corrections"] = provider.corrections
            result["outcome"] = (
                commons_outcome(result["series"], 12, 12)
                if not result["error"]
                else None
            )
        else:
            result["network"] = model.network_summary()
        write(root / identity / "result.json", result)
        progress[identity]["status"] = result["status"]
        await tape.close()
    return result


def replay_provider(root, kind):
    plan = json.loads((root / "plan.json").read_text())
    parent = Path(plan["parent"])
    tape = DecisionTape()
    tape._records = merge_tapes([*paths_for(parent), root / "decisions.jsonl"])
    return LegalActionPolicy(tape) if kind == "commons" else tape


async def verify(root):
    checks = []
    for path in sorted(root.glob("*/*/result.json")):
        result = json.loads(path.read_text())
        for start, steps in (
            ("initial_checkpoint", result["completed_steps"]),
            ("resume_checkpoint", result["resumed_steps"]),
        ):
            provider = replay_provider(root, result["model"])
            model = (NamingGame if result["model"] == "naming" else MiniCommons)(
                provider=provider
            )
            model.restore(result[start])
            for _ in range(steps):
                await model.step()
            assert model.capture() == result["checkpoint"], (result["id"], start)
            assert model.metrics() == result["metrics"]
            assert provider.live_calls == 0
            checks.append(
                {
                    "id": result["id"],
                    "start": start,
                    "steps": steps,
                    "exact_checkpoint_and_metrics": True,
                    "live_calls": 0,
                }
            )
            await provider.close()
    return checks


async def run(parent, root, env_file):
    previous_rows = [
        json.loads(path.read_text())
        for path in (
            parent / "budget-summary.json",
            parent / "naming-unstable-prefix/budget-summary.json",
        )
    ]
    if any(Decimal(row["reserved_cny"]) for row in previous_rows):
        raise ValueError("Previous calls must be fully settled")
    previous = {
        key: (
            sum(row[key] for row in previous_rows)
            if key == "live_requests"
            else str(sum(Decimal(row[key]) for row in previous_rows))
        )
        for key in ("guard_debit_cny", "peak_cost_upper_cny", "live_requests")
    }
    sources = [
        parent / "naming-unstable-prefix/naming/community-k4/result.json",
        parent / "commons/on-drought/result.json",
    ]
    old = [json.loads(path.read_text()) for path in sources]
    if any(row["status"] != "failed" for row in old):
        raise ValueError("Resume only the original failed cases")
    cfg = LLMConfig.load(env_file, max_calls=5000, max_tokens=192)
    original_plan = json.loads((parent / "plan.json").read_text())
    if (
        cfg.base_url != original_plan["provider"]["base_url"]
        or cfg.model != original_plan["provider"]["model"]
        or cfg.temperature != original_plan["provider"]["temperature"]
        or cfg.extra_body != {"thinking": {"type": "disabled"}}
    ):
        raise ValueError("Keep the original provider and generation settings")
    # Validate the sources, guard, and credentials before dispatching anything.
    records = merge_tapes(paths_for(parent))
    before = await balance(cfg)
    if Decimal(before["total_balance"]) < Decimal("11.5") - Decimal(
        previous["guard_debit_cny"]
    ) + Decimal("0.1"):
        raise ValueError("Insufficient available balance for the conservative guard")
    root.mkdir(parents=True, exist_ok=False)
    hashes = source_hashes()
    write(
        root / "plan.json",
        {
            "utc": now(),
            "parent": str(parent.resolve()),
            "source_sha256": hashes,
            "original_results": {
                str(path.resolve()): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sources
            },
            "previous_budget": previous,
            "combined_guard_limit_cny": "11.5",
            "user_limit_cny": "12",
            "horizons": {
                "naming": original_plan["naming"]["branch_interactions"],
                "commons": original_plan["commons"]["rounds"] * 6,
            },
            "policy": "Naming retains full note; Commons permits one bounded validation correction without state advance or rule fallback; no transport retries",
            "interpretation": "Diagnostic repaired continuations, not original no-retry protocol. Naming prefix remains unstable. One independent seed.",
        },
    )
    for filename in hashes:
        dest = root / "source" / filename
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(__file__).resolve().parent / filename, dest)
    ledger = CumulativeLedger(root / "budget.jsonl", previous)
    pool = TapePool(root / "decisions.jsonl", ledger)
    pool.records.update(records)
    progress, stop = {}, asyncio.Event()
    watcher = asyncio.create_task(monitor(ledger, progress, stop))
    try:
        results = await asyncio.gather(
            *(
                resume_case(
                    row,
                    pool,
                    cfg,
                    root,
                    384 if row["model"] == "naming" else 288,
                    progress,
                )
                for row in old
            )
        )
    finally:
        stop.set()
        await watcher
        write(root / "budget-summary.json", ledger.status())
        try:
            after = await balance(cfg)
        except ValueError:
            after = None
        write(root / "balance.json", {"before": before, "after": after})
        (root / "balance.json").chmod(0o600)
    checked = await verify(root)
    write(root / "replay-verification.json", checked)
    report = {
        "utc": now(),
        "budget": ledger.status(),
        "replay_verification": checked,
        "runs": [
            {
                key: row[key]
                for key in (
                    "id",
                    "status",
                    "error",
                    "completed_steps",
                    "resumed_steps",
                    "metrics",
                    "outcome",
                    "repair_policy",
                )
            }
            for row in results
        ],
    }
    write(root / "report.json", report)
    print(json.dumps(report), flush=True)


async def serve_case(root, case, port, suffix):
    from .common.viz import build_scenario
    from .mini_commons_harvest.viz import CommonsView
    from .naming_game.viz import NamingView

    row = json.loads((root / case / "result.json").read_text())
    provider = replay_provider(root, row["model"])
    model = (NamingGame if row["model"] == "naming" else MiniCommons)(provider=provider)
    initial = row["resume_checkpoint" if suffix else "initial_checkpoint"]
    model.restore(initial)
    scenario, view = await build_scenario(
        model, NamingView if row["model"] == "naming" else CommonsView, port
    )
    await scenario._ensure_initialized()
    view.restore({"model": initial, "selected_agent": 0})
    try:
        await scenario.run()
    finally:
        await provider.close()
        assert provider.live_calls == 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run_parser = sub.add_parser("run")
    run_parser.add_argument("--input", type=Path, required=True)
    run_parser.add_argument("--output", type=Path, required=True)
    run_parser.add_argument("--env-file", type=Path, required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--input", type=Path, required=True)
    serve_parser = sub.add_parser("serve-case")
    serve_parser.add_argument("--input", type=Path, required=True)
    serve_parser.add_argument(
        "--case", choices=["naming/community-k4", "commons/on-drought"], required=True
    )
    serve_parser.add_argument("--port", type=int, default=8765)
    serve_parser.add_argument("--suffix", action="store_true")
    args = parser.parse_args()
    if args.command == "run":
        asyncio.run(run(args.input, args.output, args.env_file))
    elif args.command == "verify":
        print(json.dumps(asyncio.run(verify(args.input))))
    else:
        asyncio.run(serve_case(args.input, args.case, args.port, args.suffix))


if __name__ == "__main__":
    main()
