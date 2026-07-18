"""Publication JSON adapter over the example's shared scientific study."""

from __future__ import annotations

import argparse
import json
import sys

import mesa

from model import DEFAULT_BALANCE, DEFAULT_DENSITY, DEFAULT_GRID_H, DEFAULT_GRID_W
from schelling_study import (
    DEFAULT_SCIENTIFIC_SEEDS,
    DEFAULT_SCIENTIFIC_STEPS,
    DEFAULT_SCIENTIFIC_THRESHOLDS,
    format_sweep_csv,
    parse_thresholds,
    run_sweep,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Mesa Schelling benchmark adapter.")
    parser.add_argument("--width", type=int, default=DEFAULT_GRID_W)
    parser.add_argument("--height", type=int, default=DEFAULT_GRID_H)
    parser.add_argument("--density", type=float, default=DEFAULT_DENSITY)
    parser.add_argument("--balance", type=float, default=DEFAULT_BALANCE)
    parser.add_argument("--steps", type=int, default=DEFAULT_SCIENTIFIC_STEPS)
    parser.add_argument("--warmup-steps", type=int, default=0)
    parser.add_argument("--seeds", type=int, default=DEFAULT_SCIENTIFIC_SEEDS)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--thresholds", default=DEFAULT_SCIENTIFIC_THRESHOLDS)
    parser.add_argument("--mode", choices=["steady", "convergence"], default="convergence")
    parser.add_argument("--instrumentation", choices=["none", "scientific"], default="none")
    parser.add_argument("--benchmark-json", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    result = run_sweep(
        thresholds=parse_thresholds(args.thresholds),
        seeds=args.seeds,
        seed=args.seed,
        steps=args.steps,
        width=args.width,
        height=args.height,
        density=args.density,
        balance=args.balance,
        mode=args.mode,
        collect_data=args.instrumentation == "scientific",
        warmup_steps=args.warmup_steps,
    )
    print(format_sweep_csv(result))
    if not args.benchmark_json:
        return

    divisor = max(len(result.rows), 1)
    satisfied = sum(row.mean_satisfied_pct for row in result.rows) / divisor
    segregation = sum(row.mean_segregation_index for row in result.rows) / divisor
    last_swapped = sum(row.mean_last_swapped for row in result.rows) / divisor
    actual_steps = result.total_ticks / max(len(result.rows) * args.seeds, 1)
    semantic_valid = (
        0 <= satisfied <= 1
        and 0 <= segregation <= 1
        and 0 <= last_swapped <= args.width * args.height
        and 1 <= actual_steps <= args.steps
    )
    print(json.dumps({
        "schemaVersion": 1,
        "timingsMs": [result.elapsed_ms],
        "metrics": {
            "totalTicks": result.total_ticks,
            "elapsedMs": result.elapsed_ms,
            "msPerTick": result.ms_per_tick,
        },
        "state": {
            "mode": args.mode,
            "instrumentation": args.instrumentation,
            "satisfiedPct": satisfied,
            "segregationIndex": segregation,
            "lastSwapped": last_swapped,
            "actualSteps": actual_steps,
        },
        "correctness": {"valid": semantic_valid, "actionCount": 1},
        "runtime": {"python": sys.version.split()[0], "mesa": mesa.__version__},
    }, sort_keys=True))


if __name__ == "__main__":
    main()
