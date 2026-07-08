from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Tuple

import tensnap as t

Position = Tuple[int, int]
DEFAULT_WIDTH = 16
DEFAULT_HEIGHT = 16


def build_evacuation_layout(
    width: int,
    height: int,
) -> tuple[tuple[Position, ...], tuple[Position, ...], tuple[Position, ...]]:
    """Return the canonical two-exit, two-wall evacuation map for a grid size."""
    right_exit_x = max(0, width - 1)
    center_y = max(0, min(height - 1, height // 2))
    fire_center = (max(0, min(width - 1, width // 2)), center_y)
    left_wall_x = max(1, width // 3)
    right_wall_x = min(max(2, width - 2), (2 * width) // 3)
    walls: list[Position] = []
    for y in range(2, max(2, height - 2)):
        if y == center_y:
            continue
        if 0 < left_wall_x < width - 1:
            walls.append((left_wall_x, y))
        if 0 < right_wall_x < width - 1 and right_wall_x != left_wall_x:
            walls.append((right_wall_x, y))
    return (
        ((0, center_y), (right_exit_x, center_y)),
        (fire_center,),
        tuple(walls),
    )


DEFAULT_EXITS, DEFAULT_FIRE_SOURCES, DEFAULT_WALLS = build_evacuation_layout(
    DEFAULT_WIDTH,
    DEFAULT_HEIGHT,
)


@dataclass(slots=True)
class EnvConfig:
    width: Annotated[int, t.param("number", label="Width", min=4, max=64, step=1)] = (
        DEFAULT_WIDTH
    )
    height: Annotated[int, t.param("number", label="Height", min=4, max=64, step=1)] = (
        DEFAULT_HEIGHT
    )
    num_evacuees: Annotated[
        int,
        t.param("number", label="Evacuees", min=1, max=128, step=1),
    ] = 28
    max_steps: Annotated[
        int,
        t.param("number", label="Max Steps", min=1, max=500, step=1),
    ] = 80
    guide_influence_radius: Annotated[
        int,
        t.param("number", label="Guide Radius", min=0, max=12, step=1),
    ] = 3
    guide_follow_bias: Annotated[
        float,
        t.param("number", label="Guide Follow Bias", min=0.0, max=1.0, step=0.01),
    ] = 0.65
    random_move_bias: Annotated[
        float,
        t.param("number", label="Random Move Bias", min=0.0, max=1.0, step=0.01),
    ] = 0.12
    fire_spread_interval: Annotated[
        int,
        t.param("number", label="Fire Spread Interval", min=1, max=20, step=1),
    ] = 3
    fire_reward_penalty: Annotated[
        float,
        t.param("number", label="Fire Penalty", min=-20.0, max=0.0, step=0.1),
    ] = -6.0
    evacuation_reward: Annotated[
        float,
        t.param("number", label="Evacuation Reward", min=0.0, max=20.0, step=0.1),
    ] = 2.0
    step_penalty: Annotated[
        float,
        t.param("number", label="Step Penalty", min=-1.0, max=0.0, step=0.01),
    ] = -0.03
    congestion_penalty: Annotated[
        float,
        t.param("number", label="Congestion Penalty", min=-1.0, max=0.0, step=0.01),
    ] = -0.01
    clustering_bonus: Annotated[
        float,
        t.param("number", label="Clustering Bonus", min=0.0, max=1.0, step=0.01),
    ] = 0.08
    exits: tuple[Position, ...] = DEFAULT_EXITS
    fire_sources: tuple[Position, ...] = DEFAULT_FIRE_SOURCES
    walls: tuple[Position, ...] = field(default_factory=lambda: DEFAULT_WALLS)


@dataclass(slots=True)
class DQNConfig:
    gamma: float = 0.99
    lr: float = 1e-3
    batch_size: int = 64
    buffer_size: int = 20_000
    target_sync_interval: int = 200
    warmup_steps: int = 500
    epsilon_start: float = 1.0
    epsilon_end: float = 0.05
    epsilon_decay_steps: int = 6_000
    hidden_dim: int = 128
    gradient_clip_norm: float = 5.0


@dataclass(slots=True)
class TrainingConfig:
    episodes: int = 300
    eval_episodes: int = 20
    seed: int = 7
    checkpoint_dir: Path = Path("checkpoints")
    checkpoint_every: int = 50
    log_every: int = 10
