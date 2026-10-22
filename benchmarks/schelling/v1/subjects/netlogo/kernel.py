"""Publication JSON/runtime adapter over the example's NetLogo study."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

EXAMPLE_DIR = Path(__file__).resolve().parents[5] / "examples/python_mesa"
sys.path.insert(0, str(EXAMPLE_DIR))

from netlogo_study import (
    add_study_arguments,
    advance_trial,
    create_workspace,
    format_study_csv,
    import_pynetlogo,
    options_from_args,
    run_study,
    run_trial,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="NetLogo Schelling benchmark adapter.")
    add_study_arguments(parser, default_model_path=EXAMPLE_DIR / "schelling.nlogox")
    parser.add_argument("--benchmark-json", action="store_true")
    parser.add_argument("--warmup-steps", type=int, default=0)
    args = parser.parse_args()
    options = options_from_args(args)
    py_netlogo = import_pynetlogo()
    workspace = create_workspace(py_netlogo, options)
    elapsed_ns = 0

    def timed_advance(workspace, steps, mode):
        nonlocal elapsed_ns
        started = time.perf_counter_ns()
        advance_trial(workspace, steps, mode)
        elapsed_ns += time.perf_counter_ns() - started

    def measured_trial(workspace, **kwargs):
        return run_trial(workspace, **kwargs, advance=timed_advance)

    try:
        if args.warmup_steps < 0:
            raise ValueError("warmup steps must be nonnegative")
        if args.warmup_steps:
            workspace.load_model(str(options.model_path))
            measured_trial(
                workspace,
                threshold=options.thresholds[0],
                seed=options.seed,
                steps=args.warmup_steps,
                density=options.density,
                balance=options.balance,
                mode="steady",
            )
            elapsed_ns = 0
        result = run_study(workspace, options, trial_runner=measured_trial)
    finally:
        workspace.kill_workspace()
    print(format_study_csv(result))
    elapsed_ms = elapsed_ns / 1_000_000
    mspt = elapsed_ms / result.total_ticks if result.total_ticks else 0
    print("performance_metric,total_ticks,elapsed_ms,tpms,mspt")
    print(
        f"performance,{result.total_ticks},{elapsed_ms:.3f},{result.total_ticks / elapsed_ms if elapsed_ms else 0:.6f},{mspt:.6f}"
    )
    if not args.benchmark_json:
        return

    mspt = 0.0 if result.total_ticks == 0 else elapsed_ms / result.total_ticks
    valid = (
        0 <= result.mean_satisfied <= 1
        and 0 <= result.mean_segregation <= 1
        and 0 <= result.mean_last_swapped <= 2500
        and 1 <= result.actual_steps <= options.steps
    )
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "timingsMs": [elapsed_ms],
                "metrics": {
                    "totalTicks": result.total_ticks,
                    "elapsedMs": elapsed_ms,
                    "msPerTick": mspt,
                },
                "state": {
                    "mode": options.mode,
                    "instrumentation": "scientific",
                    "satisfiedPct": result.mean_satisfied,
                    "segregationIndex": result.mean_segregation,
                    "lastSwapped": result.mean_last_swapped,
                    "actualSteps": result.actual_steps,
                },
                "correctness": {"valid": valid, "actionCount": 1},
                "runtime": {
                    "python": sys.version.split()[0],
                    "pynetlogo": getattr(py_netlogo, "__version__", "unknown"),
                },
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
