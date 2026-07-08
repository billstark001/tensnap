from __future__ import annotations

import argparse
import time
from statistics import mean

from schelling import (
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    SchellingModel,
)

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
) -> tuple[float, float, int, int, bool, int]:
    model = SchellingModel(
        width=width,
        height=height,
        density=density,
        balance=balance,
        similarity_threshold=threshold,
        rng=seed,
    )
    steps_run = 0
    converged = False
    started_ns = time.perf_counter_ns()
    for _ in range(steps):
        steps_run += 1
        if not model.advance():
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
    parser.add_argument("--seeds", type=int, default=DEFAULT_SCIENTIFIC_SEEDS)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--thresholds",
        default=DEFAULT_SCIENTIFIC_THRESHOLDS,
        help="Comma-separated similarity thresholds.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    thresholds = parse_thresholds(args.thresholds)
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


if __name__ == "__main__":
    main()
