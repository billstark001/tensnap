"""Focused item-diff microbenchmarks; run with the package's editable install.

python packages/tensnap-python/benchmarks/item_diff.py --case unchanged-scalar
Each result measures a complete projection/diff pass, excluding the initial seed.
Changed cases mutate 1% of the items per pass. Timings include snapshot ownership.
"""

from __future__ import annotations

import argparse
import json
import statistics
import timeit
from typing import Any

from tensnap.models.layer import LayerBinding

CASES = ("unchanged-scalar", "changed-scalar", "unchanged-nested", "changed-nested")


def benchmark(case: str, count: int, iterations: int, repeat: int) -> dict[str, Any]:
    nested = case.endswith("nested")
    changed = case.startswith("changed-")
    items: list[dict[str, Any]] = [
        {
            "id": index,
            "x": index,
            "y": index,
            **({"data": {"count": index}} if nested else {}),
        }
        for index in range(count)
    ]
    binding: LayerBinding[Any, str, Any, str] = LayerBinding(
        "agents",
        "agent",
        ("id",),
        items_projector=lambda model: [dict(item) for item in model],
    )
    previous = binding.build_item_list_diff_naive(items, {})[3]

    def step() -> None:
        nonlocal previous
        if changed:
            for index in range(max(1, count // 100)):
                if nested:
                    items[index]["data"]["count"] += 1
                else:
                    items[index]["x"] += 1
        previous = binding.build_item_list_diff_naive(items, previous)[3]

    seconds = timeit.repeat(step, number=iterations, repeat=repeat)
    return {
        "case": case,
        "items": count,
        "iterations": iterations,
        "repeat": repeat,
        "median_ms_per_pass": statistics.median(seconds) * 1000 / iterations,
        "samples_ms_per_pass": [value * 1000 / iterations for value in seconds],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("all", *CASES), default="all")
    parser.add_argument("--count", type=int, default=10_000)
    parser.add_argument("--iterations", type=int, default=100)
    parser.add_argument("--repeat", type=int, default=5)
    args = parser.parse_args()
    if min(args.count, args.iterations, args.repeat) < 1:
        parser.error("count, iterations, and repeat must be positive")
    for case in CASES if args.case == "all" else (args.case,):
        print(json.dumps(benchmark(case, args.count, args.iterations, args.repeat)))


if __name__ == "__main__":
    main()
