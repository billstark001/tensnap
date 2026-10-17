"""Shared serve/run/batch commands; no evaluation-harness coupling."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from dataclasses import asdict, fields
from pathlib import Path

from .config import LLMConfig, integer
from .llm import DecisionError, DecisionTape


def parser(kind: str, defaults, add_arguments) -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=f"TenSnap {kind} example")
    result.add_argument(
        "command", choices=["serve", "run", "batch"], nargs="?", default="serve"
    )
    result.add_argument("--policy", choices=["rule", "llm", "replay"], default="rule")
    result.add_argument("--seed", type=int, default=7)
    result.add_argument(
        "--seeds", default="1,2,3", help="Comma-separated independent batch seeds"
    )
    result.add_argument("--agents", type=int, default=defaults.agents)
    result.add_argument("--memory", type=int, default=defaults.memory)
    result.add_argument(
        "--steps",
        type=int,
        default=120,
        help="Interactions (naming) or activations (commons)",
    )
    result.add_argument(
        "--port", type=int, default=int(os.getenv("TENSNAP_SERVER_PORT", "8765"))
    )
    result.add_argument(
        "--env-file", type=Path, help="Explicit dotenv path; never sourced as shell"
    )
    result.add_argument(
        "--record", type=Path, help="New JSONL decision tape (LLM only)"
    )
    result.add_argument(
        "--replay",
        type=Path,
        help="Decision tape to replay without credentials/network",
    )
    result.add_argument(
        "--max-calls",
        type=int,
        help="Total live request cap across reset/restore/batch",
    )
    result.add_argument(
        "--max-tokens", type=int, help="Maximum output tokens per request"
    )
    result.add_argument(
        "--output", type=Path, help="Headless JSON result including final checkpoint"
    )
    result.add_argument(
        "--checkpoint-in", type=Path, help="Headless checkpoint or prior result JSON"
    )
    add_arguments(result)
    return result


async def execute(kind: str, model_type, config_type, load_view, args) -> int:
    integer(args.steps, "steps", 1, 1000000)
    integer(args.port, "port", 1, 65535)
    if args.policy != "llm" and args.record:
        raise ValueError("--record requires --policy llm")
    if (args.policy == "replay") != bool(args.replay):
        raise ValueError("--policy replay requires --replay, and vice versa")
    if args.command == "batch" and args.checkpoint_in:
        raise ValueError(
            "A checkpoint continuation is different from independent seed batches"
        )
    seeds = [args.seed]
    if args.command == "batch":
        seeds = [int(value.strip()) for value in args.seeds.split(",")]
        if not seeds or len(seeds) != len(set(seeds)) or len(seeds) > 1000:
            raise ValueError("Batch needs 1–1000 distinct seeds")
    # Validate all model configurations before creating a recording/client.
    config_fields = {
        field.name: getattr(args, field.name) for field in fields(config_type)
    }
    configs = [config_type(**{**config_fields, "seed": seed}) for seed in seeds]
    provider = None
    if args.policy == "llm":
        provider = DecisionTape(
            LLMConfig.load(
                args.env_file,
                max_calls=args.max_calls,
                max_tokens=args.max_tokens,
            ),
            record=args.record,
        )
    elif args.policy == "replay":
        provider = DecisionTape(replay=args.replay)
    try:
        if args.command == "serve":
            if args.checkpoint_in:
                raise ValueError("Use scene restore for a connected TenSnap server")
            # Match the existing examples' opt-in source import behavior.
            if os.getenv("TENSNAP_USE_SOURCE") == "1":
                sys.path.insert(
                    0,
                    str(
                        Path(__file__).resolve().parents[3]
                        / "packages"
                        / "tensnap-python"
                    ),
                )
            from .viz import serve

            await serve(kind, model_type(configs[0], provider), args.port, load_view())
            return 0
        runs = []
        failed = False
        for config in configs:
            model = model_type(config, provider)
            if args.checkpoint_in:
                saved = json.loads(args.checkpoint_in.read_text())
                if "runs" in saved:
                    if len(saved["runs"]) != 1:
                        raise ValueError(
                            "Choose a single-run result for checkpoint continuation"
                        )
                    saved = saved["runs"][0]
                model.restore(saved.get("checkpoint", saved))
            series = [model.metrics()]
            started = time.perf_counter()
            error = None
            for _ in range(args.steps):
                try:
                    await model.step()
                except DecisionError as exc:
                    error = str(exc)
                    failed = True
                    break
                series.append(model.metrics())
            runs.append(
                {
                    "seed": model.config.seed,
                    "config": asdict(model.config),
                    "policy": args.policy,
                    "metrics": model.metrics(),
                    "series": series,
                    "elapsed_seconds": time.perf_counter() - started,
                    "error": error,
                    "checkpoint": model.capture(),
                }
            )
            if failed:
                break
        report = {
            "example": kind,
            "runs": runs,
            "inference": provider.status() if provider else {"mode": "rule"},
        }
        if args.output:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(
                json.dumps(report, indent=2, ensure_ascii=False) + "\n"
            )
        print(
            json.dumps(
                {
                    "example": kind,
                    "runs": [
                        {
                            "seed": run["seed"],
                            "metrics": run["metrics"],
                            "error": run["error"],
                        }
                        for run in runs
                    ],
                    "inference": report["inference"],
                },
                indent=2,
            )
        )
        return 2 if failed else 0
    finally:
        if provider:
            await provider.close()


def main(kind: str, model_type, config_type, add_arguments, load_view) -> None:
    args = parser(kind, config_type(), add_arguments).parse_args()
    try:
        code = asyncio.run(execute(kind, model_type, config_type, load_view, args))
    except (ValueError, DecisionError) as exc:
        print(f"Example stopped: {exc}", file=sys.stderr)
        code = 2
    except KeyboardInterrupt:
        code = 130
    raise SystemExit(code)
