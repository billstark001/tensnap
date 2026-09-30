"""User CLI over the study functions shared with the benchmark kernel.

Keeping parsing here and trials in ``schelling_study`` avoids copying dynamics
between the example and harness; it is not required application structure.
"""

from __future__ import annotations

import argparse

from schelling import DEFAULT_BALANCE, DEFAULT_DENSITY, DEFAULT_GRID_H, DEFAULT_GRID_W
from schelling_study import (
    DEFAULT_SCIENTIFIC_SEEDS,
    DEFAULT_SCIENTIFIC_STEPS,
    DEFAULT_SCIENTIFIC_THRESHOLDS,
    format_sweep_csv,
    parse_thresholds,
    run_sweep,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Headless Schelling threshold sweep.")
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
    parser.add_argument(
        "--collect-data",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Include Mesa DataCollector work in each model step.",
    )
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
        collect_data=args.collect_data,
        warmup_steps=args.warmup_steps,
    )
    print(format_sweep_csv(result))


if __name__ == "__main__":
    main()
