"""Reusable trials shared by the teaching CLI and publication kernel adapter.

This extraction prevents duplicated scientific loops; it is not a Mesa or
TenSnap requirement.
"""

from __future__ import annotations

from dataclasses import dataclass
import time
from typing import Literal, Sequence

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
    converged: bool
    elapsed_ns: int


@dataclass(frozen=True)
class SweepRow:
    threshold: float
    mean_satisfied_pct: float
    mean_segregation_index: float
    mean_last_swapped: float
    mean_steps: float
    converged_runs: int


@dataclass(frozen=True)
class SweepResult:
    rows: tuple[SweepRow, ...]
    total_ticks: int
    total_elapsed_ns: int

    @property
    def elapsed_ms(self) -> float:
        return self.total_elapsed_ns / 1_000_000

    @property
    def ms_per_tick(self) -> float:
        return 0.0 if self.total_ticks == 0 else self.elapsed_ms / self.total_ticks

    @property
    def ticks_per_ms(self) -> float:
        return 0.0 if self.total_elapsed_ns == 0 else self.total_ticks / self.elapsed_ms


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
        rng=seed,
    )
    steps_run = 0
    converged = False
    started_ns = time.perf_counter_ns()
    for _ in range(steps):
        steps_run += 1
        moving = model.advance()
        if mode == "convergence" and not moving:
            converged = True
            break
    elapsed_ns = time.perf_counter_ns() - started_ns
    return TrialResult(
        satisfied_pct=model.satisfied_pct(),
        segregation_index=model.segregation_index(),
        last_swapped=model.last_swapped,
        steps_run=steps_run,
        converged=converged,
        elapsed_ns=elapsed_ns,
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
    warmup_steps: int = 0,
) -> SweepResult:
    if mode not in ("steady", "convergence"):
        raise ValueError("mode must be steady or convergence")
    if seeds <= 0 or steps <= 0 or warmup_steps < 0:
        raise ValueError("seeds and steps must be positive and warmup_steps non-negative")
    if not thresholds:
        raise ValueError("at least one threshold is required")
    if warmup_steps:
        run_trial(
            threshold=thresholds[0], seed=seed, steps=warmup_steps,
            width=width, height=height, density=density, balance=balance,
            mode="steady", collect_data=collect_data,
        )

    rows: list[SweepRow] = []
    total_ticks = 0
    total_elapsed_ns = 0
    for threshold in thresholds:
        trials = tuple(
            run_trial(
                threshold=threshold, seed=seed + offset, steps=steps,
                width=width, height=height, density=density, balance=balance,
                mode=mode, collect_data=collect_data,
            )
            for offset in range(seeds)
        )
        total_ticks += sum(trial.steps_run for trial in trials)
        total_elapsed_ns += sum(trial.elapsed_ns for trial in trials)
        rows.append(SweepRow(
            threshold=threshold,
            mean_satisfied_pct=sum(trial.satisfied_pct for trial in trials) / seeds,
            mean_segregation_index=sum(trial.segregation_index for trial in trials) / seeds,
            mean_last_swapped=sum(trial.last_swapped for trial in trials) / seeds,
            mean_steps=sum(trial.steps_run for trial in trials) / seeds,
            converged_runs=sum(1 for trial in trials if trial.converged),
        ))
    return SweepResult(tuple(rows), total_ticks, total_elapsed_ns)


def format_sweep_csv(result: SweepResult) -> str:
    rows = [
        "threshold,mean_satisfied_pct,mean_segregation_index,mean_last_swapped,mean_steps,converged_runs",
        *(f"{row.threshold:.2f},{row.mean_satisfied_pct:.4f},{row.mean_segregation_index:.4f},"
          f"{row.mean_last_swapped:.2f},{row.mean_steps:.2f},{row.converged_runs}"
          for row in result.rows),
        "performance_metric,total_ticks,elapsed_ms,tpms,mspt",
        f"performance,{result.total_ticks},{result.elapsed_ms:.3f},"
        f"{result.ticks_per_ms:.6f},{result.ms_per_tick:.6f}",
    ]
    return "\n".join(rows)
