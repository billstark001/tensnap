from __future__ import annotations

import argparse
import time
from pathlib import Path
from statistics import mean

DEFAULT_DENSITY = 0.8
DEFAULT_BALANCE = 0.5
DEFAULT_SCIENTIFIC_STEPS = 1000
DEFAULT_SCIENTIFIC_SEEDS = 8
DEFAULT_SCIENTIFIC_THRESHOLDS = "0.30,0.50,0.70,0.90"


def import_pynetlogo():
    try:
        import pyNetLogo  # type: ignore

        return pyNetLogo
    except ImportError:
        try:
            import pynetlogo  # type: ignore

            return pynetlogo
        except ImportError as exc:
            raise SystemExit(
                "PyNetLogo is required for NetLogo headless runs. "
                "Install it with `pip install pyNetLogo` and make sure NetLogo is installed."
            ) from exc


def parse_thresholds(raw: str) -> list[float]:
    return [float(item.strip()) for item in raw.split(",") if item.strip()]


def netlogo_number(value: float | int) -> str:
    if isinstance(value, int):
        return str(value)
    return f"{value:.17g}"


def run_trial(
    workspace,
    *,
    threshold: float,
    seed: int,
    steps: int,
    density: float,
    balance: float,
) -> tuple[float, float, int, int, bool, int]:
    workspace.command(
        " ".join(
            [
                f"set density {netlogo_number(density)}",
                f"set balance {netlogo_number(balance)}",
                f"set similarity-threshold {netlogo_number(threshold)}",
                f"set seed {seed}",
            ]
        )
    )
    workspace.command("setup")

    started_ns = time.perf_counter_ns()
    workspace.command(f"run-scientific-trial {steps}")
    elapsed_ns = time.perf_counter_ns() - started_ns

    steps_run = int(float(workspace.report("ticks")))
    last_swapped = int(float(workspace.report("swapped-last-step")))
    return (
        float(workspace.report("satisfied-pct")),
        float(workspace.report("segregation-index")),
        last_swapped,
        steps_run,
        last_swapped == 0,
        elapsed_ns,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Headless NetLogo Schelling threshold sweep for demo comparisons."
    )
    parser.add_argument(
        "--model-path",
        default=str(Path(__file__).with_name("schelling.nlogox")),
        help="Path to schelling.nlogox.",
    )
    parser.add_argument(
        "--netlogo-home",
        default=None,
        help="Optional NetLogo installation directory for PyNetLogo.",
    )
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
    py_netlogo = import_pynetlogo()
    thresholds = parse_thresholds(args.thresholds)

    link_kwargs = {"gui": False}
    if args.netlogo_home:
        link_kwargs["netlogo_home"] = args.netlogo_home

    workspace = py_netlogo.NetLogoLink(**link_kwargs)
    try:
        workspace.load_model(str(Path(args.model_path).resolve()))
        output_rows: list[str] = []
        total_ticks = 0
        total_elapsed_ns = 0
        for threshold in thresholds:
            rows = [
                run_trial(
                    workspace,
                    threshold=threshold,
                    seed=args.seed + run,
                    steps=args.steps,
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
    finally:
        workspace.kill_workspace()

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
