from __future__ import annotations

import argparse
import json
import sys
import time
from statistics import mean

from schelling import (
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    SchellingModel,
)
import mesa

DEFAULT_SCIENTIFIC_STEPS = 1000
DEFAULT_SCIENTIFIC_SEEDS = 8
DEFAULT_SCIENTIFIC_THRESHOLDS = "0.30,0.50,0.70,0.90"


def parse_thresholds(raw: str) -> list[float]:
    return [float(item.strip()) for item in raw.split(",") if item.strip()]


def run_trial(
    *,
    threshold: float,
    seed: int,
    steps: int,
    width: int,
    height: int,
    density: float,
    balance: float,
    mode: str,
    collect_data: bool,
) -> tuple[float, float, int, int, bool, int]:
    model = SchellingModel(
        width=width,
        height=height,
        density=density,
        balance=balance,
        similarity_threshold=threshold,
        collect_data=collect_data,
        rng=seed,
    )
    steps_run = 0
    converged = False
    started_ns = time.perf_counter_ns()
    for _ in range(steps):
        steps_run += 1
        moving = model.advance()
        if mode == "convergence" and not moving:
            converged = True
            break
    elapsed_ns = time.perf_counter_ns() - started_ns
    return (
        model.satisfied_pct(),
        model.segregation_index(),
        model.last_swapped,
        steps_run,
        converged,
        elapsed_ns,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Headless Schelling threshold sweep for demo comparisons."
    )
    parser.add_argument("--width", type=int, default=DEFAULT_GRID_W)
    parser.add_argument("--height", type=int, default=DEFAULT_GRID_H)
    parser.add_argument("--density", type=float, default=DEFAULT_DENSITY)
    parser.add_argument("--balance", type=float, default=DEFAULT_BALANCE)
    parser.add_argument("--steps", type=int, default=DEFAULT_SCIENTIFIC_STEPS)
    parser.add_argument("--warmup-steps", type=int, default=0, help="Untimed steps on an independent model to warm interpreter dispatch.")
    parser.add_argument("--seeds", type=int, default=DEFAULT_SCIENTIFIC_SEEDS)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--thresholds",
        default=DEFAULT_SCIENTIFIC_THRESHOLDS,
        help="Comma-separated similarity thresholds.",
    )
    parser.add_argument("--mode", choices=["steady", "convergence"], default="convergence")
    parser.add_argument(
        "--instrumentation",
        choices=["none", "scientific"],
        default="none",
        help="Whether Mesa DataCollector work is part of every timed step.",
    )
    parser.add_argument("--benchmark-json", action="store_true", help="Append one schema-v1 JSON result for the benchmark harness.")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    thresholds = parse_thresholds(args.thresholds)
    if args.warmup_steps < 0:
        raise SystemExit("--warmup-steps must be non-negative")
    if args.warmup_steps:
        run_trial(
            threshold=thresholds[0], seed=args.seed, steps=args.warmup_steps,
            width=args.width, height=args.height, density=args.density, balance=args.balance,
            mode="steady", collect_data=args.instrumentation == "scientific",
        )
    output_rows: list[str] = []
    total_ticks = 0
    total_elapsed_ns = 0
    for threshold in thresholds:
        rows = [
            run_trial(
                threshold=threshold,
                seed=args.seed + run,
                steps=args.steps,
                width=args.width,
                height=args.height,
                density=args.density,
                balance=args.balance,
                mode=args.mode,
                collect_data=args.instrumentation == "scientific",
            )
            for run in range(args.seeds)
        ]
        total_ticks += sum(row[3] for row in rows)
        total_elapsed_ns += sum(row[5] for row in rows)
        output_rows.append(
            f"{threshold:.2f},"
            f"{mean(row[0] for row in rows):.4f},"
            f"{mean(row[1] for row in rows):.4f},"
            f"{mean(row[2] for row in rows):.2f},"
            f"{mean(row[3] for row in rows):.2f},"
            f"{sum(1 for row in rows if row[4])}"
        )
    print(
        "threshold,mean_satisfied_pct,mean_segregation_index,"
        "mean_last_swapped,mean_steps,converged_runs"
    )
    for row in output_rows:
        print(row)
    elapsed_ms = total_elapsed_ns / 1_000_000
    tpms = 0.0 if total_elapsed_ns == 0 else total_ticks / elapsed_ms
    mspt = 0.0 if total_ticks == 0 else elapsed_ms / total_ticks
    print("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
    print(f"performance,{total_ticks},{elapsed_ms:.3f},{tpms:.6f},{mspt:.6f}")
    if args.benchmark_json:
        satisfied = mean(float(row.split(",")[1]) for row in output_rows)
        segregation = mean(float(row.split(",")[2]) for row in output_rows)
        last_swapped = mean(float(row.split(",")[3]) for row in output_rows)
        actual_steps = total_ticks / max(len(thresholds) * args.seeds, 1)
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
                        "totalTicks": total_ticks,
                        "elapsedMs": elapsed_ms,
                        "msPerTick": mspt,
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
