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
from tensnap.utils.attr import make_dict_projector
from tensnap.utils.projection_ownership import copy_for_publication

CASES = ("unchanged-scalar", "changed-scalar", "unchanged-nested", "changed-nested")


def benchmark(
    case: str,
    count: int,
    iterations: int,
    repeat: int,
    *,
    projection: str = "custom",
    phase: str = "diff",
) -> dict[str, Any]:
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
    fields = ["id", "x", "y"] + (["data"] if nested else [])
    builtin = make_dict_projector(fields, deep_copy=projection != "boundary")
    binding: LayerBinding[Any, str, Any, str] = LayerBinding(
        "agents",
        "agent",
        ("id",),
        iterable_getter=lambda model: model,
        item_projector=(lambda item: item)
        if projection == "custom"
        else (lambda item: copy_for_publication(dict(item)))
        if projection == "owned"
        else builtin,
        projector_owns_values=True if projection == "owned" else None,
        projector_deep_copy=projection != "boundary",
        deep_copy=True if projection == "double" else None,
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
        if phase == "sync":
            published = binding.build_item_list(items)
            previous = {
                binding.get_projected_item_cache_key(item): item for item in published
            }
        else:
            previous = binding.build_item_list_diff_naive(items, previous)[3]

    seconds = timeit.repeat(step, number=iterations, repeat=repeat)
    return {
        "case": case,
        "projection": projection,
        "phase": phase,
        "items": count,
        "iterations": iterations,
        "repeat": repeat,
        "median_ms_per_pass": statistics.median(seconds) * 1000 / iterations,
        "samples_ms_per_pass": [value * 1000 / iterations for value in seconds],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=("all", *CASES), default="all")
    parser.add_argument(
        "--projection",
        choices=("custom", "builtin", "boundary", "owned", "double"),
        default="custom",
    )
    parser.add_argument("--phase", choices=("diff", "sync"), default="diff")
    parser.add_argument("--count", type=int, default=10_000)
    parser.add_argument("--iterations", type=int, default=100)
    parser.add_argument("--repeat", type=int, default=5)
    args = parser.parse_args()
    if min(args.count, args.iterations, args.repeat) < 1:
        parser.error("count, iterations, and repeat must be positive")
    for case in CASES if args.case == "all" else (args.case,):
        print(
            json.dumps(
                benchmark(
                    case,
                    args.count,
                    args.iterations,
                    args.repeat,
                    projection=args.projection,
                    phase=args.phase,
                )
            )
        )


if __name__ == "__main__":
    main()
