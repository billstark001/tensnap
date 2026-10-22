"""Paired factorial controls, rules only; no provider/client/credentials loaded.

Run from the repository root: python -m examples.python_llm.experiments --help
Independent units are seeds. Label orders and treatment branches are paired
within a seed; they must never be counted as independent populations.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import statistics
import subprocess
import sys
from dataclasses import asdict, replace
from datetime import datetime, timezone
from pathlib import Path

from .common.config import integer
from .mini_commons_harvest.model import CommonsConfig, MiniCommons
from .mini_commons_harvest.scenarios import (
    COMMONS_RULES,
    COMMONS_SCENARIOS,
    DEFAULT_DROUGHT_DURATION,
    DEFAULT_DROUGHT_START,
)
from .naming_game.model import NamingConfig, NamingGame
from .naming_game.scenarios import NAMING_EXPERIMENT_SCENARIOS, NAMING_LABEL_ORDERS


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x") as stream:
        json.dump(value, stream, indent=2, ensure_ascii=False)
        stream.write("\n")


def physical_hash(model):
    saved = model.capture()
    return digest(
        {
            key: saved[key]
            for key in ("tick", "state", "random_state", "policy_random_state")
        }
    )


async def restore_check(model, saved, steps):
    expected = model.capture()
    model.restore(json.loads(json.dumps(saved)))
    for _ in range(steps):
        await model.step()
    if model.capture() != expected:
        raise AssertionError("Checkpoint continuation diverged")
    return True


def mean(values):
    return statistics.fmean(values) if values else None


def estimate(values):
    """Descriptive paired differences; no claim of a population significance test."""
    return {
        "n_seeds": len(values),
        "mean": mean(values),
        "sd": statistics.stdev(values) if len(values) > 1 else None,
        "min": min(values) if values else None,
        "max": max(values) if values else None,
    }


async def naming(args, directory):
    # Validate before creating any output. The runner always uses the same
    # degree/population/exploration and pairs both name/prompt orders per seed.
    config = NAMING_EXPERIMENT_SCENARIOS["mixed-control"].configure(
        NamingConfig(
            agents=args.agents,
            degree=args.degree,
            exploration=args.exploration,
            rule=args.naming_rule,
        )
    )
    integer(args.minority, "minority", 1, args.agents - 1)
    integer(args.warmup, "warmup", 1, 10**6)
    integer(args.interactions, "interactions", 4 * args.agents, 10**6)
    directory.mkdir(parents=True, exist_ok=False)
    records, failed_prefixes = [], []
    for seed in args.seeds:
        for order in NAMING_LABEL_ORDERS:
            prefix = NamingGame(replace(config, seed=seed, label_order=order))
            stable_for, stable_name = 0, None
            for _ in range(args.warmup):
                await prefix.step()
                metrics = prefix.metrics()
                name = "Q" if metrics["q_share"] >= metrics["m_share"] else "M"
                good = (
                    metrics["window_interactions"] == 4 * args.agents
                    and metrics["last_choice_agreement"] >= 0.9
                    and metrics["rolling_coordination"] >= 0.9
                    and all(player.history for player in prefix.agents)
                )
                stable_for = (
                    stable_for + 1 if good and name == stable_name else int(good)
                )
                stable_name = name
                if stable_for >= args.agents:
                    break
            prefix_path = f"seed-{seed}/{order}/prefix.json"
            write(
                directory / prefix_path,
                {
                    "stable": stable_for >= args.agents,
                    "checkpoint": prefix.capture(),
                    "metrics": prefix.metrics(),
                },
            )
            if stable_for < args.agents:
                failed_prefixes.append(
                    {
                        "seed": seed,
                        "label_order": order,
                        "status": "no_stable_prefix",
                        "prefix": prefix_path,
                    }
                )
                continue
            alternate = "M" if stable_name == "Q" else "Q"
            for scenario_name, condition in NAMING_EXPERIMENT_SCENARIOS.items():
                model = NamingGame(config)
                model.restore(prefix.capture())
                original = physical_hash(model)
                treatment = condition.configure(
                    model.config, minority=args.minority, target=alternate
                )
                topology, count = treatment.topology, treatment.committed
                model.apply_treatment(topology, count, treatment.committed_name)
                # Treatment clears researcher windows, never personal memories.
                branch_start = model.capture()
                series = [model.metrics()]
                sustained, reversal_time = 0, None
                saved = None
                for elapsed in range(1, args.interactions + 1):
                    if elapsed == args.interactions - args.agents + 1:
                        saved = model.capture()
                    await model.step()
                    metrics = model.metrics()
                    sampled = {
                        agent for event in model.events for agent in event["players"]
                    }
                    good = (
                        metrics["window_interactions"] == 4 * args.agents
                        and metrics["ordinary_target_choice_share"] is not None
                        and metrics["ordinary_target_choice_share"] >= 0.9
                        and metrics["ordinary_target_last_share"] >= 0.9
                        and {p.id for p in model.agents} - model.committed_ids
                        <= sampled
                    )
                    sustained = sustained + 1 if good else 0
                    if sustained >= 4 * args.agents and reversal_time is None:
                        reversal_time = elapsed  # confirmation time, not inferred onset
                    if elapsed % args.agents == 0 or elapsed == args.interactions:
                        series.append(metrics)
                checked = await restore_check(model, saved, args.agents)
                outcome = {
                    key: model.metrics()[key]
                    for key in (
                        "ordinary_target_choice_share",
                        "ordinary_target_last_share",
                        "rolling_coordination",
                        "community_gap",
                    )
                }
                outcome.update(
                    reversal=int(reversal_time is not None),
                    reversal_confirmation=reversal_time,
                    right_censored=reversal_time is None,
                    horizon=args.interactions,
                )
                path = f"seed-{seed}/{order}/{topology}-k{count}.json"
                record = {
                    "scenario": scenario_name,
                    "seed": seed,
                    "label_order": order,
                    "topology": topology,
                    "committed": count,
                    "prefix_tick": prefix.tick,
                    "old_convention": stable_name,
                    "target": alternate,
                    "outcome": outcome,
                    "file": path,
                }
                write(
                    directory / path,
                    {
                        **record,
                        "config": asdict(model.config),
                        "prefix_hash": original,
                        "network": model.network_summary(),
                        "branch_checkpoint": branch_start,
                        "series": series,
                        "checkpoint": model.capture(),
                        "checks": {"exact_continuation": checked},
                    },
                )
                records.append(record)
    effects = {}
    for metric in (
        "ordinary_target_choice_share",
        "rolling_coordination",
        "community_gap",
        "reversal",
    ):
        per_effect = {
            key: [] for key in ("minority_mixed", "minority_community", "interaction")
        }
        for seed in args.seeds:
            order_effects = []
            for order in NAMING_LABEL_ORDERS:
                group = {
                    (r["topology"], r["committed"]): r["outcome"][metric]
                    for r in records
                    if r["seed"] == seed and r["label_order"] == order
                }
                if len(group) != 4 or any(value is None for value in group.values()):
                    continue
                mixed = group["mixed", args.minority] - group["mixed", 0]
                community = group["community", args.minority] - group["community", 0]
                order_effects.append((mixed, community, community - mixed))
            if len(order_effects) == 2:
                for index, key in enumerate(per_effect):
                    per_effect[key].append(
                        mean([item[index] for item in order_effects])
                    )
        effects[metric] = {key: estimate(values) for key, values in per_effect.items()}
    return {
        "experiment": "naming-network-minority",
        "protocol": "factorial-v1",
        "policy": "rule",
        "independent_units": "seed; both label orders averaged within seed",
        "runs": records,
        "failed_prefixes": failed_prefixes,
        "paired_effects": effects,
    }


def commons_outcome(series, start, duration):
    by_round = {row["round"]: row for row in series}
    horizon, end = series[-1]["round"], start + duration
    # Use the same scheduled window even in the no-drought condition.
    reference = mean(
        [by_round[r]["resource"] for r in range(max(0, start - 10), start)]
    )
    streak, recovered = 0, None
    for row in series:
        if row["round"] < end:
            continue
        streak = streak + 1 if row["resource"] >= 0.9 * reference else 0
        if streak >= 5 and recovered is None:
            recovered = row["round"] - end  # confirmation delay
    extinct = next((row["round"] for row in series if row["extinct_components"]), None)
    return {
        "final_resource": series[-1]["resource"],
        "harvested": series[-1]["harvested"],
        "mean_resource": mean([row["resource"] for row in series[1:]]),
        "minimum_resource": min(row["resource"] for row in series),
        "pre_drought_resource": reference,
        "drought_window_harvest": by_round[end - 1]["harvested"]
        - by_round[start - 1]["harvested"],
        "post_window_harvest": by_round[horizon]["harvested"]
        - by_round[end - 1]["harvested"],
        "extinct_components": series[-1]["extinct_components"],
        "first_extinction_round": extinct,
        "recovery_confirmation_delay": recovered if reference > 0 else None,
        "recovery_reference_nonzero": reference > 0,
        "recovery_right_censored": recovered is None or reference == 0,
        "gini": series[-1]["gini"],
    }


async def commons(args, directory):
    config = CommonsConfig(
        agents=args.agents,
        regrowth=args.regrowth,
        drought_start=args.drought_start,
        drought_duration=args.drought_duration,
        drought_multiplier=args.drought_multiplier,
    )
    integer(args.drought_start, "drought_start", 2, args.rounds - 5)
    integer(
        args.drought_duration,
        "drought_duration",
        1,
        args.rounds - args.drought_start - 4,
    )
    directory.mkdir(parents=True, exist_ok=False)
    records, equivalence = [], []
    for seed in args.seeds:
        for rule in args.rules:
            traces, prefix_hashes, initial_hashes, finals = {}, {}, set(), {}
            for scenario_name, condition in COMMONS_SCENARIOS.items():
                if condition.rule != rule:
                    continue
                delivery, drought = condition.delivery, condition.drought
                model = MiniCommons(condition.configure(replace(config, seed=seed)))
                initial = model.capture()
                initial_hashes.add(physical_hash(model))
                series = [model.metrics()]
                for round_number in range(1, args.rounds + 1):
                    saved = model.capture() if round_number == args.rounds else None
                    for _ in range(args.agents):
                        await model.step()
                    series.append(model.metrics())
                    if round_number == args.drought_start - 1:
                        prefix_hashes[delivery, drought] = physical_hash(model)
                    if saved is not None:
                        await restore_check(model, saved, args.agents)
                final = model.capture()
                key = (delivery, drought)
                traces[key], finals[key] = series, physical_hash(model)
                path = f"seed-{seed}/{rule}-{delivery}-{'drought' if drought else 'normal'}.json"
                record = {
                    "scenario": scenario_name,
                    "seed": seed,
                    "rule": rule,
                    "delivery": delivery,
                    "drought": drought,
                    "outcome": commons_outcome(
                        series, args.drought_start, args.drought_duration
                    ),
                    "file": path,
                }
                write(
                    directory / path,
                    {
                        **record,
                        "config": asdict(model.config),
                        "initial_checkpoint": initial,
                        "series": series,
                        "checkpoint": final,
                        "checks": {
                            "exact_continuation": True,
                            "pre_drought_state_hash": prefix_hashes[key],
                        },
                    },
                )
                records.append(record)
            checks = {
                "seed": seed,
                "rule": rule,
                "same_initial_state": len(initial_hashes) == 1,
                "same_prefix_until_drought": all(
                    prefix_hashes[d, False] == prefix_hashes[d, True]
                    for d in ("off", "on")
                ),
            }
            if rule in ("greedy", "conserve"):
                checks["delivery_negative_control_identical"] = all(
                    traces["off", dry] == traces["on", dry]
                    and finals["off", dry] == finals["on", dry]
                    for dry in (False, True)
                )
            if not all(
                value for key, value in checks.items() if key not in ("seed", "rule")
            ):
                raise AssertionError(f"Paired control diverged: {checks}")
            equivalence.append(checks)
    effects = {}
    for rule in args.rules:
        effects[rule] = {}
        for metric in (
            "final_resource",
            "mean_resource",
            "harvested",
            "extinct_components",
            "gini",
        ):
            effects[rule][metric] = {}
            per_effect = {
                key: []
                for key in ("delivery_normal", "delivery_drought", "interaction")
            }
            for seed in args.seeds:
                group = {
                    (r["delivery"], r["drought"]): r["outcome"][metric]
                    for r in records
                    if r["seed"] == seed and r["rule"] == rule
                }
                normal = group["on", False] - group["off", False]
                dry = group["on", True] - group["off", True]
                for key, value in zip(
                    per_effect, (normal, dry, dry - normal), strict=True
                ):
                    per_effect[key].append(value)
            effects[rule][metric] = {
                key: estimate(values) for key, values in per_effect.items()
            }
    return {
        "experiment": "commons-delivery-drought",
        "protocol": "factorial-v1",
        "policy": "rule",
        "independent_units": "seed; policy-specific effects reported separately",
        "runs": records,
        "paired_checks": equivalence,
        "paired_effects": effects,
    }


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("experiment", choices=["naming", "commons"])
    result.add_argument("--seeds", default="1,2,3,4,5,6,7,8,9,10,11,12")
    result.add_argument(
        "--output", type=Path, required=True, help="Fresh directory, never overwritten"
    )
    result.add_argument("--agents", type=int, help="Default: naming 24, commons 6")
    result.add_argument("--degree", type=int, default=4)
    result.add_argument("--minority", type=int, default=4)
    result.add_argument("--exploration", type=float, default=0.01)
    result.add_argument(
        "--naming-rule", choices=["frequency", "wsls"], default="frequency"
    )
    result.add_argument("--warmup", type=int, default=10000)
    result.add_argument("--interactions", type=int, default=2400)
    result.add_argument("--rounds", type=int, default=240)
    result.add_argument("--regrowth", type=float, default=0.35)
    result.add_argument("--rules", default=",".join(COMMONS_RULES))
    result.add_argument("--drought-start", type=int, default=DEFAULT_DROUGHT_START)
    result.add_argument(
        "--drought-duration", type=int, default=DEFAULT_DROUGHT_DURATION
    )
    result.add_argument("--drought-multiplier", type=float, default=0.1)
    return result


def main():
    args = parser().parse_args()
    try:
        args.seeds = [
            integer(int(value), "seed", 0, 2**32 - 1) for value in args.seeds.split(",")
        ]
        if (
            not args.seeds
            or len(args.seeds) != len(set(args.seeds))
            or len(args.seeds) > 1000
        ):
            raise ValueError("Use 1–1000 distinct seeds")
        args.rules = args.rules.split(",")
        if (
            not args.rules
            or len(args.rules) != len(set(args.rules))
            or not set(args.rules) <= set(COMMONS_RULES)
        ):
            raise ValueError("Unknown or repeated rule")
        args.agents = (
            args.agents
            if args.agents is not None
            else (24 if args.experiment == "naming" else 6)
        )
        integer(args.rounds, "rounds", 8, 10**6)
        report = asyncio.run(
            (naming if args.experiment == "naming" else commons)(args, args.output)
        )
        root = Path(__file__).resolve().parent
        source = {
            str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob("*.py"))
            if ".venv" not in path.parts and "artifacts" not in path.parts
        }
        report["provenance"] = {
            "created_at": datetime.now(timezone.utc).isoformat(),
            "python_version": sys.version,
            "settings": {
                key: str(value) if isinstance(value, Path) else value
                for key, value in vars(args).items()
            },
            "source_sha256": source,
            "git_head": subprocess.check_output(
                ["git", "rev-parse", "HEAD"], cwd=root, text=True
            ).strip(),
            "git_dirty": bool(
                subprocess.check_output(
                    ["git", "status", "--porcelain", "--", "."], cwd=root, text=True
                ).strip()
            ),
        }
        report["inference"] = {"mode": "rule", "live_calls": 0, "cost_cny": 0}
        write(args.output / "report.json", report)
        print(
            json.dumps(
                {
                    "output": str(args.output.resolve()),
                    "runs": len(report["runs"]),
                    "failed_prefixes": len(report.get("failed_prefixes", [])),
                    "inference": report["inference"],
                }
            )
        )
    except (TypeError, ValueError, FileExistsError) as exc:
        raise SystemExit(f"Experiment stopped: {exc}") from None


if __name__ == "__main__":
    main()
