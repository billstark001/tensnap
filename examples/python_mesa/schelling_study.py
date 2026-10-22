"""Reusable trials shared by the teaching CLI and publication kernel adapter.

This extraction prevents duplicated scientific loops; it is not a Mesa or
TenSnap requirement.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from schelling import (
    DEFAULT_BALANCE,
    DEFAULT_DENSITY,
    DEFAULT_GRID_H,
    DEFAULT_GRID_W,
    SchellingModel,
)

StudyMode = Literal["steady", "convergence"]

DEFAULT_SCIENTIFIC_STEPS = 1000
DEFAULT_SCIENTIFIC_SEEDS = 8
DEFAULT_SCIENTIFIC_THRESHOLDS = "0.30,0.50,0.70,0.90"


@dataclass(frozen=True)
class TrialResult:
    satisfied_pct: float
    segregation_index: float
    last_swapped: int
    steps_run: int
    termination: Literal["satisfied", "jammed", "limit"]


@dataclass(frozen=True)
class SweepRow:
    threshold: float
    mean_satisfied_pct: float
    mean_segregation_index: float
    mean_last_swapped: float
    mean_steps: float
    satisfied_runs: int
    jammed_runs: int
    limit_runs: int


@dataclass(frozen=True)
class SweepResult:
    rows: tuple[SweepRow, ...]
    total_ticks: int


def parse_thresholds(raw: str) -> list[float]:
    thresholds = [float(item.strip()) for item in raw.split(",") if item.strip()]
    if not thresholds or any(value < 0 or value > 1 for value in thresholds):
        raise ValueError("thresholds must contain one or more values from 0 through 1")
    return thresholds


def run_trial(
    *,
    threshold: float,
    seed: int,
    steps: int,
    width: int = DEFAULT_GRID_W,
    height: int = DEFAULT_GRID_H,
    density: float = DEFAULT_DENSITY,
    balance: float = DEFAULT_BALANCE,
    mode: StudyMode = "convergence",
    collect_data: bool = True,
) -> TrialResult:
    model = SchellingModel(
        width=width,
        height=height,
        density=density,
        balance=balance,
        similarity_threshold=threshold,
        collect_data=collect_data,
        seed=seed,
    )
    steps_run, stopped = advance_trial(model, steps, mode)
    return summarize_trial(model, steps_run, stopped)


def advance_trial(model, steps: int, mode: StudyMode) -> tuple[int, bool]:
    """Run scientific transitions only; no movement is a stopping event, not satisfaction."""
    for tick in range(1, steps + 1):
        model.step()
        # Mesa owns step() and may discard the user callback return value.
        if mode == "convergence" and model.last_swapped == 0:
            return tick, True
    return steps, False


def summarize_trial(model, steps_run: int, stopped: bool) -> TrialResult:
    satisfied = model.satisfied_pct()
    all_satisfied = all(agent.is_satisfied() for agent in model.agents)
    return TrialResult(
        satisfied_pct=satisfied,
        segregation_index=model.segregation_index(),
        last_swapped=model.last_swapped,
        steps_run=steps_run,
        termination=("satisfied" if all_satisfied else "jammed")
        if stopped
        else "limit",
    )


def run_sweep(
    *,
    thresholds: Sequence[float],
    seeds: int,
    seed: int,
    steps: int,
    width: int = DEFAULT_GRID_W,
    height: int = DEFAULT_GRID_H,
    density: float = DEFAULT_DENSITY,
    balance: float = DEFAULT_BALANCE,
    mode: StudyMode = "convergence",
    collect_data: bool = True,
    trial_runner: Callable[..., TrialResult] = run_trial,
) -> SweepResult:
    if mode not in ("steady", "convergence"):
        raise ValueError("mode must be steady or convergence")
    if seeds <= 0 or steps <= 0:
        raise ValueError("seeds and steps must be positive")
    if not thresholds:
        raise ValueError("at least one threshold is required")
    rows: list[SweepRow] = []
    total_ticks = 0
    for threshold in thresholds:
        trials = tuple(
            trial_runner(
                threshold=threshold,
                seed=seed + offset,
                steps=steps,
                width=width,
                height=height,
                density=density,
                balance=balance,
                mode=mode,
                collect_data=collect_data,
            )
            for offset in range(seeds)
        )
        total_ticks += sum(trial.steps_run for trial in trials)
        rows.append(
            SweepRow(
                threshold=threshold,
                mean_satisfied_pct=sum(trial.satisfied_pct for trial in trials) / seeds,
                mean_segregation_index=sum(trial.segregation_index for trial in trials)
                / seeds,
                mean_last_swapped=sum(trial.last_swapped for trial in trials) / seeds,
                mean_steps=sum(trial.steps_run for trial in trials) / seeds,
                satisfied_runs=sum(
                    trial.termination == "satisfied" for trial in trials
                ),
                jammed_runs=sum(trial.termination == "jammed" for trial in trials),
                limit_runs=sum(trial.termination == "limit" for trial in trials),
            )
        )
    return SweepResult(tuple(rows), total_ticks)


def format_sweep_csv(result: SweepResult) -> str:
    rows = [
        "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,satisfied_runs,jammed_runs,limit_runs",
        *(
            f"{row.threshold:.2f},{row.mean_satisfied_pct:.4f},{row.mean_segregation_index:.4f},"
            f"{row.mean_last_swapped:.2f},{row.mean_steps:.2f},{row.satisfied_runs},{row.jammed_runs},{row.limit_runs}"
            for row in result.rows
        ),
    ]
    return "\n".join(rows)
