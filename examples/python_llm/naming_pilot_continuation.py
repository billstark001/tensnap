"""Complete exploratory Naming branches if the bounded LLM warmup is unstable.

The original failed formation experiment remains intact. This supplementary
factorial comparison uses its unchanged final population, not a new seed or
fabricated stable memories, and cannot establish mature-convention replacement.
Its budget is the remainder of the ORIGINAL combined 9.5-CNY guard.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace

from .common.budget import CNYLedger, TapePool, balance, now
from .common.config import LLMConfig
from .experiments import write
from .llm_experiments import monitor, naming_case, source_hashes, verify


class RemainingLedger(CNYLedger):
    def __init__(self, path, previous):
        self.previous = previous
        remaining = Decimal(previous["limit_cny"]) - Decimal(
            previous["guard_debit_cny"]
        )
        super().__init__(path, str(remaining), 5000 - previous["live_requests"])

    def status(self):
        current = super().status()
        current.update(
            previous_guard_debit_cny=self.previous["guard_debit_cny"],
            combined_guard_debit_cny=str(
                self.spent + Decimal(self.previous["guard_debit_cny"])
            ),
            combined_peak_cost_upper_cny=str(
                self.peak_upper + Decimal(self.previous["peak_cost_upper_cny"])
            ),
            combined_live_requests=self.calls + self.previous["live_requests"],
            combined_limit_cny=self.previous["limit_cny"],
        )
        return current


async def run(parent, env_file):
    original = json.loads((parent / "report.json").read_text())
    prefix = json.loads((parent / "naming/prefix.json").read_text())
    plan = json.loads((parent / "plan.json").read_text())
    if (
        prefix["stable"]
        or prefix["error"] is not None
        or prefix["checkpoint"]["tick"] != plan["naming"]["warmup_cutoff"]
    ):
        raise ValueError(
            "Supplement applies only to a completed but unstable bounded warmup"
        )
    if any(record["id"].startswith("naming/") for record in original["runs"]):
        raise ValueError("Naming branches already exist; do not duplicate paid runs")
    previous = original["budget"]
    if Decimal(previous["reserved_cny"]) != 0:
        raise ValueError("The original paid process must be settled before continuing")
    cfg = LLMConfig.load(env_file, max_calls=5000, max_tokens=192)
    if (
        cfg.base_url != plan["provider"]["base_url"]
        or cfg.model != plan["provider"]["model"]
        or cfg.temperature != plan["provider"]["temperature"]
        or cfg.extra_body != {"thinking": {"type": "disabled"}}
    ):
        raise ValueError("Keep the original provider and generation settings")
    root = parent / "naming-unstable-prefix"
    root.mkdir(exist_ok=False)
    write(
        root / "plan.json",
        {
            "utc": now(),
            "parent": str(parent.resolve()),
            "parent_plan": "../plan.json",
            "source_sha256": source_hashes(),
            "prefix_stable": False,
            "purpose": "Exploratory network x fixed-minority comparison after observed failed convention formation",
            "no_changes": "Same seed, population, histories, scores, RNG and original four treatments; no retries or substituted decisions",
            "interpretation": "Report target adoption and community differences; do not claim reversal of a mature convention",
            "previous_budget": previous,
            "combined_limit_cny": previous["limit_cny"],
            "branch_interactions": plan["naming"]["branch_interactions"],
        },
    )
    write(root / "naming/prefix.json", prefix)
    before = await balance(cfg)
    ledger = RemainingLedger(root / "budget.jsonl", previous)
    pool = TapePool(root / "naming/decisions.jsonl", ledger)
    progress, stop = {}, asyncio.Event()
    watcher = asyncio.create_task(monitor(ledger, progress, stop))
    args = SimpleNamespace(
        seed=plan["seed"], interactions=plan["naming"]["branch_interactions"]
    )
    records = []
    try:
        records = await asyncio.gather(
            *(
                naming_case(args, pool, cfg, prefix, topology, count, root, progress)
                for topology in ("mixed", "community")
                for count in (0, 4)
            )
        )
    finally:
        stop.set()
        await watcher
        after = await balance(cfg)
        snapshots = {
            "before": before,
            "after": after,
            "combined_account_decrease_cny": str(
                Decimal(original["balance"]["before"]["total_balance"])
                - Decimal(after["total_balance"])
            ),
        }
        write(root / "balance.json", snapshots)
        (root / "balance.json").chmod(0o600)
        write(root / "budget-summary.json", ledger.status())
    checked = await verify(root)
    report = {
        "utc": now(),
        "independent_seeds": 1,
        "prefix_stable": False,
        "mature_convention_claim": False,
        "runs": [
            {
                key: row[key]
                for key in (
                    "id",
                    "status",
                    "error",
                    "completed_steps",
                    "metrics",
                    "outcome",
                    "inference",
                )
            }
            for row in records
        ],
        "budget": ledger.status(),
        "balance": snapshots,
        "replay_verification": checked,
    }
    assert Decimal(report["budget"]["combined_guard_debit_cny"]) <= Decimal(
        previous["limit_cny"]
    )
    write(root / "report.json", report)
    print(
        json.dumps(
            {
                "output": str(root.resolve()),
                "groups": len(records),
                "budget": ledger.status(),
            }
        ),
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--env-file", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(run(args.input, args.env_file))


if __name__ == "__main__":
    main()
