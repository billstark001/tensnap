"""One-seed, eight-condition LLM pilot with a shared CNY guard and offline replay."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
from dataclasses import asdict
from decimal import Decimal
from pathlib import Path

from .common.budget import PRICING, CNYLedger, TapePool, balance, now
from .common.config import LLMConfig, integer
from .common.llm import DecisionError, DecisionTape
from .experiments import commons_outcome, physical_hash, write
from .mini_commons_harvest.model import CommonsConfig, MiniCommons
from .naming_game.model import NamingConfig, NamingGame


def stable(model):
    metrics = model.metrics()
    return (
        metrics["window_interactions"] == 4 * len(model.agents)
        and metrics["last_choice_agreement"] >= 0.9
        and metrics["rolling_coordination"] >= 0.9
        and all(player.history for player in model.agents)
    )


async def naming_prefix(args, pool, config, root):
    provider = pool.client(config, "naming-prefix")
    model = NamingGame(
        NamingConfig(
            seed=args.seed,
            topology="mixed",
            protocol="factorial-v1",
            rule="frequency",
            exploration=0.01,
        ),
        provider,
    )
    series, streak, previous, error = [model.metrics()], 0, None, None
    try:
        for _ in range(args.warmup):
            try:
                await model.step()
            except DecisionError as exc:
                error = str(exc)
                break
            metrics = model.metrics()
            series.append(metrics)
            majority = "Q" if metrics["q_share"] >= metrics["m_share"] else "M"
            good = stable(model)
            streak = streak + 1 if good and majority == previous else int(good)
            previous = majority
            if streak >= len(model.agents):
                break
        result = {
            "stable": streak >= len(model.agents),
            "error": error,
            "majority": previous,
            "checkpoint": model.capture(),
            "series": series,
            "inference": provider.status(),
            "decision_trace": provider.trace,
        }
        write(root / "naming/prefix.json", result)
        return result
    finally:
        await provider.close()


async def naming_case(args, pool, config, prefix, topology, count, root, progress):
    identity = f"naming/{topology}-k{count}"
    provider = pool.client(config, identity)
    model = NamingGame(provider=provider)
    model.restore(prefix["checkpoint"])
    target = "M" if prefix["majority"] == "Q" else "Q"
    model.apply_treatment(topology, count, target)
    initial = model.capture()
    series, events, streak, reversal, error = [model.metrics()], [], 0, None, None
    progress[identity] = {"completed": 0, "horizon": args.interactions}
    try:
        for elapsed in range(1, args.interactions + 1):
            try:
                await model.step()
            except DecisionError as exc:
                error = str(exc)
                break
            metrics = model.metrics()
            series.append(metrics)
            events.append(model.last_interaction)
            sampled = {agent for event in model.events for agent in event["players"]}
            good = (
                metrics["window_interactions"] == 4 * len(model.agents)
                and metrics["ordinary_target_choice_share"] is not None
                and metrics["ordinary_target_choice_share"] >= 0.9
                and metrics["ordinary_target_last_share"] >= 0.9
                and {p.id for p in model.agents} - model.committed_ids <= sampled
            )
            streak = streak + 1 if good else 0
            if streak >= 4 * len(model.agents) and reversal is None:
                reversal = elapsed
            progress[identity]["completed"] = elapsed
        record = {
            "id": identity,
            "model": "naming",
            "config": asdict(model.config),
            "status": "failed" if error else "completed",
            "error": error,
            "initial_checkpoint": initial,
            "checkpoint": model.capture(),
            "series": series,
            "events": events,
            "metrics": model.metrics(),
            "outcome": {
                "reversal_confirmation": reversal,
                "right_censored": reversal is None,
                "prefix_stable": prefix["stable"],
                "target": target,
            },
            "network": model.network_summary(),
            "completed_steps": len(events),
            "inference": provider.status(),
            "decision_trace": provider.trace,
        }
        write(root / f"{identity}/result.json", record)
        progress[identity]["status"] = record["status"]
        return record
    finally:
        await provider.close()


async def commons_case(args, pool, config, delivery, drought, root, progress):
    identity = f"commons/{delivery}-{'drought' if drought else 'normal'}"
    provider = pool.client(config, identity)
    model = MiniCommons(
        CommonsConfig(
            seed=args.seed,
            protocol="factorial-v1",
            message_delivery=delivery,
            drought_start=args.drought_start,
            drought_duration=args.drought_duration if drought else 0,
        ),
        provider,
    )
    initial = model.capture()
    series, events, error = [model.metrics()], [], None
    hashes = {0: physical_hash(model)}
    horizon = args.rounds * len(model.agents)
    progress[identity] = {"completed": 0, "horizon": horizon}
    try:
        for elapsed in range(1, horizon + 1):
            try:
                await model.step()
            except DecisionError as exc:
                error = str(exc)
                break
            events.append(model.last_event)
            if model.tick % len(model.agents) == 0:
                series.append(model.metrics())
                hashes[model.tick // len(model.agents)] = physical_hash(model)
            progress[identity]["completed"] = elapsed
        record = {
            "id": identity,
            "model": "commons",
            "config": asdict(model.config),
            "status": "failed" if error else "completed",
            "error": error,
            "initial_checkpoint": initial,
            "checkpoint": model.capture(),
            "series": series,
            "events": events,
            "metrics": model.metrics(),
            "round_state_hashes": hashes,
            "completed_steps": len(events),
            "outcome": (
                commons_outcome(series, args.drought_start, args.drought_duration)
                if error is None
                else None
            ),
            "inference": provider.status(),
            "decision_trace": provider.trace,
        }
        write(root / f"{identity}/result.json", record)
        progress[identity]["status"] = record["status"]
        return record
    finally:
        await provider.close()


def source_hashes():
    root = Path(__file__).resolve().parent
    return {
        str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*.py"))
        if not {".venv", "artifacts"} & set(path.parts)
    }


async def verify(root):
    records = []
    for path in sorted(root.glob("*/*/result.json")):
        record = json.loads(path.read_text())
        tape = DecisionTape(replay=root / record["model"] / "decisions.jsonl")
        factory = NamingGame if record["model"] == "naming" else MiniCommons
        model = factory(provider=tape)
        model.restore(record["initial_checkpoint"])
        for _ in range(record["completed_steps"]):
            await model.step()
        assert model.capture() == record["checkpoint"], record["id"]
        assert model.metrics() == record["metrics"], record["id"]
        assert tape.live_calls == 0
        records.append(
            {
                "id": record["id"],
                "exact_checkpoint_and_metrics": True,
                "completed_steps": record["completed_steps"],
                "live_calls": 0,
            }
        )
        await tape.close()
    return records


async def monitor(ledger, progress, stop):
    while not stop.is_set():
        try:
            await asyncio.wait_for(stop.wait(), timeout=25)
        except asyncio.TimeoutError:
            print(
                json.dumps(
                    {"utc": now(), "progress": progress, "budget": ledger.status()}
                ),
                flush=True,
            )


def matched_rules(args, root):
    common = [sys.executable, "-m", "examples.python_llm.experiments"]
    commands = [
        [
            *common,
            "naming",
            "--seeds",
            str(args.seed),
            "--interactions",
            str(args.interactions),
            "--output",
            str(root / "rule-matched/naming"),
        ],
        [
            *common,
            "commons",
            "--seeds",
            str(args.seed),
            "--rounds",
            str(args.rounds),
            "--drought-start",
            str(args.drought_start),
            "--drought-duration",
            str(args.drought_duration),
            "--output",
            str(root / "rule-matched/commons"),
        ],
    ]
    for command in commands:
        subprocess.run(command, check=True, capture_output=True, text=True)


async def run(args):
    integer(args.seed, "seed", 0, 2**32 - 1)
    integer(args.interactions, "interactions", 192, 384)
    integer(args.warmup, "warmup", 120, 384)
    integer(args.rounds, "rounds", 24, 48)
    integer(args.drought_start, "drought_start", 2, args.rounds - 5)
    integer(
        args.drought_duration,
        "drought_duration",
        1,
        args.rounds - args.drought_start - 4,
    )
    config = LLMConfig.load(args.env_file, max_calls=5000, max_tokens=192)
    if (
        config.model != "deepseek-flash"
        or config.base_url.rstrip("/") != "https://api.deepseek.com"
        or config.extra_body != {"thinking": {"type": "disabled"}}
    ):
        raise ValueError(
            "This priced pilot requires official Flash with thinking disabled"
        )
    root = args.output
    root.mkdir(parents=True, exist_ok=False)
    plan = {
        "protocol": "factorial-v1",
        "seed": args.seed,
        "label_order": "QM",
        "naming": {
            "agents": 24,
            "degree": 4,
            "minority": [0, 4],
            "topology": ["mixed", "community"],
            "prefix": "new LLM warmup, shared stable checkpoint",
            "warmup_cutoff": args.warmup,
            "branch_interactions": args.interactions,
            "no_stable_prefix": "report failure, do not replace seed or fabricate memories",
        },
        "commons": {
            "agents": 6,
            "rounds": args.rounds,
            "delivery": ["off", "on"],
            "drought_start": args.drought_start,
            "drought_duration": args.drought_duration,
            "drought_multiplier": 0.1,
        },
        "provider": {
            "base_url": config.base_url,
            "model": config.model,
            "temperature": config.temperature,
            "max_tokens": config.max_tokens,
            "thinking": "disabled",
        },
        "coupling": "Reuse only exact (logical index, system+observation fingerprint) responses across paired branches",
        "failure_policy": "No retries, rule fallback, seed replacement or post hoc prompt changes",
        "concurrency": 4,
        "budget_limit_cny": "9.5",
        "user_limit_cny": "10",
        "pricing": PRICING,
        "utc": now(),
        "python_version": sys.version,
        "source_sha256": source_hashes(),
        "git_head": (
            await asyncio.to_thread(
                subprocess.check_output, ["git", "rev-parse", "HEAD"], text=True
            )
        ).strip(),
    }
    write(root / "plan.json", plan)
    await asyncio.to_thread(matched_rules, args, root)
    before = await balance(config)
    limit = min(Decimal("9.5"), Decimal(before["total_balance"]) - Decimal("0.10"))
    if limit <= 0:
        raise ValueError("Insufficient available balance")
    ledger = CNYLedger(root / "budget.jsonl", limit=str(limit))
    progress, records, prefix = {}, [], None
    stop = asyncio.Event()
    watcher = asyncio.create_task(monitor(ledger, progress, stop))
    try:
        naming_pool = TapePool(root / "naming/decisions.jsonl", ledger)
        commons_pool = TapePool(root / "commons/decisions.jsonl", ledger)
        # Prefix and Commons are independent; their combined active HTTP calls
        # stay bounded by four workers (prefix plus three Commons initially).
        semaphore = asyncio.Semaphore(4)

        async def bounded(coroutine):
            async with semaphore:
                return await coroutine

        async def all_naming():
            nonlocal prefix
            progress["naming-prefix"] = {"status": "running", "horizon": args.warmup}
            prefix = await bounded(naming_prefix(args, naming_pool, config, root))
            progress["naming-prefix"] = {
                "status": "stable" if prefix["stable"] else "failed",
                "tick": prefix["checkpoint"]["tick"],
            }
            if not prefix["stable"]:
                return []
            return await asyncio.gather(
                *(
                    bounded(
                        naming_case(
                            args,
                            naming_pool,
                            config,
                            prefix,
                            topology,
                            count,
                            root,
                            progress,
                        )
                    )
                    for topology in ("mixed", "community")
                    for count in (0, 4)
                )
            )

        naming_results, commons_results = await asyncio.gather(
            all_naming(),
            asyncio.gather(
                *(
                    bounded(
                        commons_case(
                            args,
                            commons_pool,
                            config,
                            delivery,
                            drought,
                            root,
                            progress,
                        )
                    )
                    for delivery in ("off", "on")
                    for drought in (False, True)
                )
            ),
        )
        records = [*naming_results, *commons_results]
    finally:
        stop.set()
        await watcher
        try:
            after = await balance(config)
        except ValueError:
            after = None
        balances = {
            "before": before,
            "after": after,
            "observed_account_decrease_cny": (
                str(Decimal(before["total_balance"]) - Decimal(after["total_balance"]))
                if after
                else None
            ),
            "attribution": "Account snapshots may include unrelated activity; token upper bound is request-specific",
        }
        write(root / "balance.json", balances)
        (root / "balance.json").chmod(0o600)
        write(root / "budget-summary.json", ledger.status())
    verified = await verify(root)
    paired = []
    for delivery in ("off", "on"):
        cases = [
            record
            for record in records
            if record["model"] == "commons"
            and record["config"]["message_delivery"] == delivery
        ]
        if len(cases) == 2:
            hashes = [record["round_state_hashes"] for record in cases]
            compared = [
                r
                for r in range(args.drought_start)
                if r in hashes[0] and r in hashes[1]
            ]
            equal = all(hashes[0][r] == hashes[1][r] for r in compared)
            assert equal
            paired.append(
                {
                    "delivery": delivery,
                    "rounds_compared": compared,
                    "exact_prefix_until_drought": equal,
                }
            )
    report = {
        "utc": now(),
        "pilot": True,
        "independent_seeds": 1,
        "plan": "plan.json",
        "prefix_stable": prefix["stable"] if prefix else False,
        "runs": [
            {
                key: record[key]
                for key in (
                    "id",
                    "status",
                    "error",
                    "completed_steps",
                    "metrics",
                    "outcome",
                    "inference",
                )
            }
            for record in records
        ],
        "replay_verification": verified,
        "paired_checks": paired,
        "budget": ledger.status(),
        "balance": balances,
        "limitations": [
            "One seed and QM order only; no significance or label-bias claims",
            "Shorter horizon and drought schedule than the retained 12-seed rule study",
            "Exact-input response reuse couples branches, it does not create independent samples",
        ],
    }
    write(root / "report.json", report)
    print(
        json.dumps(
            {
                "output": str(root.resolve()),
                "completed_groups": sum(r["status"] == "completed" for r in records),
                "groups": len(records),
                "prefix_stable": report["prefix_stable"],
                "budget": ledger.status(),
            }
        ),
        flush=True,
    )


async def serve_case(root, case, port):
    """Replay one paid branch through the native binding, with zero live access."""
    record = json.loads((root / case / "result.json").read_text())
    tape = DecisionTape(replay=root / record["model"] / "decisions.jsonl")
    if record["model"] == "naming":
        from .naming_game.viz import NamingView

        factory, view_type = NamingGame, NamingView
    else:
        from .mini_commons_harvest.viz import CommonsView

        factory, view_type = MiniCommons, CommonsView
    from .common.viz import build_scenario

    model = factory(provider=tape)
    model.restore(record["initial_checkpoint"])
    scenario, view = await build_scenario(model, view_type, port)
    await scenario._ensure_initialized()
    view.restore({"model": record["initial_checkpoint"], "selected_agent": 0})
    print(f"OFFLINE CASE {case} ws://127.0.0.1:{port}", flush=True)
    try:
        await scenario.run()
    finally:
        assert tape.live_calls == 0
        await tape.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    live = sub.add_parser(
        "run", help="Paid requests, limited to 9.5 CNY including a 25% margin"
    )
    live.add_argument("--env-file", type=Path, required=True)
    live.add_argument("--output", type=Path, required=True)
    live.add_argument("--seed", type=int, default=1)
    live.add_argument("--warmup", type=int, default=384)
    live.add_argument("--interactions", type=int, default=384)
    live.add_argument("--rounds", type=int, default=48)
    live.add_argument("--drought-start", type=int, default=12)
    live.add_argument("--drought-duration", type=int, default=12)
    offline = sub.add_parser(
        "verify", help="Exact checkpoint/metric verification with no live configuration"
    )
    offline.add_argument("--input", type=Path, required=True)
    server = sub.add_parser(
        "serve-case", help="Offline native backend for a recorded branch"
    )
    server.add_argument("--input", type=Path, required=True)
    server.add_argument("--case", required=True)
    server.add_argument("--port", type=int, required=True)
    args = parser.parse_args()
    try:
        if args.command == "run":
            asyncio.run(run(args))
        elif args.command == "verify":
            print(json.dumps(asyncio.run(verify(args.input))))
        else:
            asyncio.run(serve_case(args.input, args.case, args.port))
    except (ValueError, DecisionError) as exc:
        raise SystemExit(f"Pilot stopped: {exc}") from None
    except KeyboardInterrupt:
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
