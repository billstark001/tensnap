"""Publication JSON adapter over the example's shared scientific study."""

from __future__ import annotations

import argparse
import json
import sys
import time

import mesa
from model import (
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    SchellingModel,
)
from schelling_study import (
    DEFAULT_SCIENTIFIC_SEEDS,
    DEFAULT_SCIENTIFIC_STEPS,
    DEFAULT_SCIENTIFIC_THRESHOLDS,
    advance_trial,
    format_sweep_csv,
    parse_thresholds,
    run_sweep,
    summarize_trial,
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
    parser.add_argument(
        "--mode", choices=["steady", "convergence"], default="convergence"
    )
    parser.add_argument(
        "--instrumentation", choices=["none", "scientific"], default="none"
    )
    parser.add_argument("--benchmark-json", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    elapsed_ns = 0

    def measured_trial(*, threshold, seed, steps, mode, **config):
        nonlocal elapsed_ns
        model = SchellingModel(similarity_threshold=threshold, seed=seed, **config)
        started = time.perf_counter_ns()
        steps_run, stopped = advance_trial(model, steps, mode)
        elapsed_ns += time.perf_counter_ns() - started
        return summarize_trial(model, steps_run, stopped)

    if args.warmup_steps < 0:
        raise ValueError("warmup steps must be nonnegative")
    if args.warmup_steps:
        measured_trial(
            threshold=parse_thresholds(args.thresholds)[0],
            seed=args.seed,
            steps=args.warmup_steps,
            mode="steady",
            width=args.width,
            height=args.height,
            density=args.density,
            balance=args.balance,
            collect_data=args.instrumentation == "scientific",
        )
        elapsed_ns = 0
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
        trial_runner=measured_trial,
    )
    elapsed_ms = elapsed_ns / 1_000_000
    ms_per_tick = elapsed_ms / result.total_ticks if result.total_ticks else 0.0
    print(format_sweep_csv(result))
    print("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
    print(
        f"performance,{result.total_ticks},{elapsed_ms:.3f},{result.total_ticks / elapsed_ms if elapsed_ms else 0:.6f},{ms_per_tick:.6f}"
    )
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
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "timingsMs": [elapsed_ms],
                "metrics": {
                    "totalTicks": result.total_ticks,
                    "elapsedMs": elapsed_ms,
                    "msPerTick": ms_per_tick,
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
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
