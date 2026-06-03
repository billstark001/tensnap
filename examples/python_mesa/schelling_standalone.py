from __future__ import annotations

import argparse
from statistics import mean

from schelling import (
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    SchellingModel,
)


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
) -> tuple[float, float, int, int, bool]:
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
    for _ in range(steps):
        steps_run += 1
        if not model.advance():
            converged = True
            break
    return (
        model.satisfied_pct(),
        model.segregation_index(),
        model.last_swapped,
        steps_run,
        converged,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Headless Schelling threshold sweep for demo comparisons."
    )
    parser.add_argument("--width", type=int, default=DEFAULT_GRID_W)
    parser.add_argument("--height", type=int, default=DEFAULT_GRID_H)
    parser.add_argument("--density", type=float, default=DEFAULT_DENSITY)
    parser.add_argument("--balance", type=float, default=DEFAULT_BALANCE)
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--seeds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--thresholds",
        default="0.30,0.50,0.70,0.90",
        help="Comma-separated similarity thresholds.",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    thresholds = parse_thresholds(args.thresholds)
    print(
        "threshold,mean_satisfied_pct,mean_segregation_index,"
        "mean_last_swapped,mean_steps,converged_runs"
    )
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
        print(
            f"{threshold:.2f},"
            f"{mean(row[0] for row in rows):.4f},"
            f"{mean(row[1] for row in rows):.4f},"
            f"{mean(row[2] for row in rows):.2f},"
            f"{mean(row[3] for row in rows):.2f},"
            f"{sum(1 for row in rows if row[4])}"
        )


if __name__ == "__main__":
    main()
