"""Reusable PyNetLogo study shared by example and benchmark launchers."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Any

DEFAULT_DENSITY = 0.8
DEFAULT_BALANCE = 0.5
DEFAULT_THRESHOLDS = "0.30,0.50,0.70,0.90"


@dataclass(frozen=True)
class NetLogoStudyOptions:
    model_path: Path
    netlogo_home: str | None
    density: float
    balance: float
    steps: int
    seeds: int
    seed: int
    thresholds: tuple[float, ...]
    mode: str


@dataclass(frozen=True)
class TrialResult:
    satisfied: float
    segregation: float
    last_swapped: int
    steps_run: int
    termination: str


@dataclass(frozen=True)
class StudyRow:
    threshold: float
    mean_satisfied: float
    mean_segregation: float
    mean_last_swapped: float
    mean_steps: float
    satisfied_runs: int
    jammed_runs: int
    limit_runs: int


@dataclass(frozen=True)
class StudyResult:
    options: NetLogoStudyOptions
    rows: tuple[StudyRow, ...]
    trials: tuple[TrialResult, ...]
    total_ticks: int
    mean_satisfied: float
    mean_segregation: float
    mean_last_swapped: float
    actual_steps: float


def import_pynetlogo() -> Any:
    try:
        import pyNetLogo  # type: ignore

        return pyNetLogo
    except ImportError:
        try:
            import pynetlogo  # type: ignore

            return pynetlogo
        except ImportError as exc:
            raise SystemExit(
                "PyNetLogo and NetLogo are required for this example."
            ) from exc


def parse_thresholds(raw: str) -> tuple[float, ...]:
    thresholds = tuple(float(item.strip()) for item in raw.split(",") if item.strip())
    if not thresholds or any(value < 0 or value > 1 for value in thresholds):
        raise argparse.ArgumentTypeError(
            "thresholds must contain values from 0 through 1"
        )
    return thresholds


def add_study_arguments(
    parser: argparse.ArgumentParser, *, default_model_path: Path
) -> None:
    parser.add_argument("--model-path", default=str(default_model_path))
    parser.add_argument("--netlogo-home", default=None)
    parser.add_argument("--density", type=float, default=DEFAULT_DENSITY)
    parser.add_argument("--balance", type=float, default=DEFAULT_BALANCE)
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--seeds", type=int, default=8)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--thresholds",
        type=parse_thresholds,
        default=parse_thresholds(DEFAULT_THRESHOLDS),
    )
    parser.add_argument(
        "--mode", choices=("steady", "convergence"), default="convergence"
    )


def options_from_args(args: argparse.Namespace) -> NetLogoStudyOptions:
    if args.steps <= 0 or args.seeds <= 0:
        raise SystemExit("--steps and --seeds must be positive")
    if not 0 <= args.density <= 1 or not 0 <= args.balance <= 1:
        raise SystemExit("--density and --balance must be values from 0 through 1")
    return NetLogoStudyOptions(
        model_path=Path(args.model_path).resolve(),
        netlogo_home=args.netlogo_home,
        density=args.density,
        balance=args.balance,
        steps=args.steps,
        seeds=args.seeds,
        seed=args.seed,
        thresholds=tuple(args.thresholds),
        mode=args.mode,
    )


def netlogo_number(value: float | int) -> str:
    return str(value) if isinstance(value, int) else f"{value:.17g}"


def advance_trial(workspace, steps, mode):
    command = (
        f"repeat {steps} [ advance ]"
        if mode == "steady"
        else f"run-scientific-trial {steps}"
    )
    workspace.command(command)


def run_trial(
    workspace: Any,
    *,
    threshold: float,
    seed: int,
    steps: int,
    density: float,
    balance: float,
    mode: str,
    advance=advance_trial,
) -> TrialResult:
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
    advance(workspace, steps, mode)
    steps_run = int(float(workspace.report("ticks")))
    last_swapped = int(float(workspace.report("swapped-last-step")))
    return TrialResult(
        satisfied=float(workspace.report("satisfied-pct")),
        segregation=float(workspace.report("segregation-index")),
        last_swapped=last_swapped,
        steps_run=steps_run,
        termination=(
            "satisfied"
            if bool(workspace.report("all? patches [satisfied?]"))
            else "jammed"
        )
        if mode == "convergence" and last_swapped == 0
        else "limit",
    )


def run_study(
    workspace: Any, options: NetLogoStudyOptions, *, trial_runner=run_trial
) -> StudyResult:
    workspace.load_model(str(options.model_path))
    rows: list[StudyRow] = []
    all_trials: list[TrialResult] = []
    for threshold in options.thresholds:
        trials = [
            trial_runner(
                workspace,
                threshold=threshold,
                seed=options.seed + offset,
                steps=options.steps,
                density=options.density,
                balance=options.balance,
                mode=options.mode,
            )
            for offset in range(options.seeds)
        ]
        all_trials.extend(trials)
        rows.append(
            StudyRow(
                threshold=threshold,
                mean_satisfied=mean(trial.satisfied for trial in trials),
                mean_segregation=mean(trial.segregation for trial in trials),
                mean_last_swapped=mean(trial.last_swapped for trial in trials),
                mean_steps=mean(trial.steps_run for trial in trials),
                satisfied_runs=sum(t.termination == "satisfied" for t in trials),
                jammed_runs=sum(t.termination == "jammed" for t in trials),
                limit_runs=sum(t.termination == "limit" for t in trials),
            )
        )
    total_ticks = sum(trial.steps_run for trial in all_trials)
    return StudyResult(
        options=options,
        rows=tuple(rows),
        trials=tuple(all_trials),
        total_ticks=total_ticks,
        mean_satisfied=mean(trial.satisfied for trial in all_trials),
        mean_segregation=mean(trial.segregation for trial in all_trials),
        mean_last_swapped=mean(trial.last_swapped for trial in all_trials),
        actual_steps=total_ticks / len(all_trials),
    )


def create_workspace(py_netlogo: Any, options: NetLogoStudyOptions) -> Any:
    link_kwargs: dict[str, Any] = {"gui": False}
    if options.netlogo_home:
        link_kwargs["netlogo_home"] = options.netlogo_home
    return py_netlogo.NetLogoLink(**link_kwargs)


def format_study_csv(result: StudyResult) -> str:
    lines = [
        "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,satisfied_runs,jammed_runs,limit_runs"
    ]
    lines.extend(
        f"{row.threshold:.2f},{row.mean_satisfied:.4f},{row.mean_segregation:.4f},"
        f"{row.mean_last_swapped:.2f},{row.mean_steps:.2f},{row.satisfied_runs},{row.jammed_runs},{row.limit_runs}"
        for row in result.rows
    )
    return "\n".join(lines)
