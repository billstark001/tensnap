"""Publication JSON/runtime adapter over the example's NetLogo study."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EXAMPLE_DIR = Path(__file__).resolve().parents[5] / "examples/python_mesa"
sys.path.insert(0, str(EXAMPLE_DIR))

from netlogo_study import (  # noqa: E402
    add_study_arguments,
    create_workspace,
    format_study_csv,
    import_pynetlogo,
    options_from_args,
    run_study,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="NetLogo Schelling benchmark adapter.")
    add_study_arguments(parser, default_model_path=EXAMPLE_DIR / "schelling.nlogox")
    parser.add_argument("--benchmark-json", action="store_true")
    args = parser.parse_args()
    options = options_from_args(args)
    py_netlogo = import_pynetlogo()
    workspace = create_workspace(py_netlogo, options)
    try:
        result = run_study(workspace, options)
    finally:
        workspace.kill_workspace()
    print(format_study_csv(result))
    if not args.benchmark_json:
        return

    elapsed_ms = result.total_elapsed_ns / 1_000_000
    mspt = 0.0 if result.total_ticks == 0 else elapsed_ms / result.total_ticks
    valid = (
        0 <= result.mean_satisfied <= 1
        and 0 <= result.mean_segregation <= 1
        and 0 <= result.mean_last_swapped <= 2500
        and 1 <= result.actual_steps <= options.steps
    )
    print(json.dumps({
        "schemaVersion": 1,
        "timingsMs": [elapsed_ms],
        "metrics": {"totalTicks": result.total_ticks, "elapsedMs": elapsed_ms, "msPerTick": mspt},
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
    }, sort_keys=True))


if __name__ == "__main__":
    main()
