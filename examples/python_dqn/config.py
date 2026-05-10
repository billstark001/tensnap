from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple

Position = Tuple[int, int]


@dataclass(slots=True)
class EnvConfig:
    width: int = 16
    height: int = 16
    num_evacuees: int = 28
    max_steps: int = 80
    guide_influence_radius: int = 3
    guide_follow_bias: float = 0.65
    random_move_bias: float = 0.12
    fire_spread_interval: int = 3
    fire_reward_penalty: float = -6.0
    evacuation_reward: float = 2.0
    step_penalty: float = -0.03
    congestion_penalty: float = -0.01
    clustering_bonus: float = 0.08
    exits: tuple[Position, ...] = ((0, 7), (15, 7))
    fire_sources: tuple[Position, ...] = ((7, 7),)
    walls: tuple[Position, ...] = field(
        default_factory=lambda: tuple(
            [(5, y) for y in range(2, 14) if y != 7]
            + [(10, y) for y in range(2, 14) if y != 7]
        )
    )


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
