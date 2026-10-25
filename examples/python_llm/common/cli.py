"""Shared serve/run/batch commands; no evaluation-harness coupling."""

from __future__ import annotations

import argparse
import asyncio
import importlib
import inspect
import json
import os
import shlex
import sys
import time
from dataclasses import asdict, fields
from pathlib import Path

from .config import REQUEST_OPTIONS, LLMConfig, integer
from .llm import DecisionError, DecisionTape


def require_binding() -> None:
    """Check the imported API before loading views with declarative bindings."""
    source = Path(__file__).resolve().parents[3] / "packages" / "tensnap-python"
    if os.getenv("TENSNAP_USE_SOURCE") == "1":
        sys.path.insert(0, str(source))
    install = (
        f"{shlex.quote(sys.executable)} -m pip install -e {shlex.quote(str(source))}"
    )
    try:
        binding = importlib.import_module("tensnap")
    except ModuleNotFoundError as exc:
        if exc.name != "tensnap":
            raise
        raise ValueError(
            f"Serving requires TenSnap Python >=0.3.7. Install: {install}"
        ) from exc
    if "data" not in inspect.signature(binding.edge).parameters:
        raise ValueError(
            "Serving requires TenSnap Python >=0.3.7 with edge(data=...). "
            f"Loaded {binding.__version__} from {binding.__file__}. "
            f"Install into this interpreter: {install}. "
            "For checkout development, TENSNAP_USE_SOURCE=1 also selects source "
            "without installing dependencies."
        )


def parser(
    kind: str, defaults, add_arguments, scenarios=None
) -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=f"TenSnap {kind} example")
    result.add_argument(
        "command", choices=["serve", "run", "batch"], nargs="?", default="serve"
    )
    result.add_argument(
        "--policy",
        choices=["rule", "llm", "replay"],
        default="rule",
        help="Initial policy; serve also enables LLM switching when credentials are configured",
    )
    result.add_argument("--seed", type=int, default=7)
    if scenarios is not None:
        result.add_argument(
            "--scenario", choices=list(scenarios), help="Named initialization preset"
        )
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
        "--record", type=Path, help="New JSONL tape for live LLM decisions"
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
    for name, help_text in {
        "max_tokens": "Output token limit (16–4096), or omit; default 128",
        "temperature": "Sampling temperature (0–2), or omit; default 0.7",
        "response_format": "Any nonempty response_format.type string, or omit; default json_object",
        "stream": "false or omit; default false (streaming is unsupported)",
        "max_completion_tokens": "Alternative output token limit (16–4096), or omit; requires --max-tokens omit",
        "top_p": "Nucleus sampling probability (0–1), or omit; default omit",
        "presence_penalty": "Presence penalty (-2–2), or omit; default omit",
        "frequency_penalty": "Frequency penalty (-2–2), or omit; default omit",
    }.items():
        # Keep explicit 'omit' distinct from an absent CLI option (None).
        result.add_argument(f"--{name.replace('_', '-')}", help=help_text)
    result.add_argument(
        "--output", type=Path, help="Headless JSON result including final checkpoint"
    )
    result.add_argument(
        "--checkpoint-in", type=Path, help="Headless checkpoint or prior result JSON"
    )
    add_arguments(result)
    return result


async def execute(
    kind: str, model_type, config_type, load_view, args, scenarios=None
) -> int:
    integer(args.steps, "steps", 1, 1000000)
    integer(args.port, "port", 1, 65535)
    if args.command != "serve" and args.policy != "llm" and args.record:
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
    if scenarios is not None and args.scenario is not None:
        configs = [scenarios[args.scenario].configure(config) for config in configs]
    if args.command == "serve":
        if args.checkpoint_in:
            raise ValueError("Use scene restore for a connected TenSnap server")
        require_binding()
    providers = {}
    try:
        if args.policy == "llm" or args.command == "serve":
            config = LLMConfig.load(
                args.env_file,
                required=args.policy == "llm" or bool(args.record),
                max_calls=args.max_calls,
                **{name: getattr(args, name) for name in REQUEST_OPTIONS},
            )
            if config is not None:
                providers["llm"] = DecisionTape(config, record=args.record)
        if args.policy == "replay":
            providers["replay"] = DecisionTape(replay=args.replay)
        provider = providers.get(args.policy)
        if args.command == "serve":
            from .viz import serve

            await serve(
                kind,
                model_type(configs[0], provider),
                args.port,
                load_view(),
                providers=providers,
            )
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
        for provider in providers.values():
            await provider.close()


def main(
    kind: str, model_type, config_type, add_arguments, load_view, *, scenarios=None
) -> None:
    args = parser(kind, config_type(), add_arguments, scenarios).parse_args()
    try:
        code = asyncio.run(
            execute(kind, model_type, config_type, load_view, args, scenarios)
        )
    except (TypeError, ValueError, DecisionError) as exc:
        print(f"Example stopped: {exc}", file=sys.stderr)
        code = 2
    except KeyboardInterrupt:
        code = 130
    raise SystemExit(code)
