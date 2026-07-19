"""Reference policies and evaluation helpers for the evacuation task."""

from __future__ import annotations

import random
from typing import Callable, Protocol

from torch import Tensor

from .config import EnvConfig
from .envs import EnvKind, NetLogoEnvConfig, make_evacuation_env
from .train import EpisodeSummary


class ActionPolicy(Protocol):
    def select_action(self, state: Tensor, greedy: bool = True) -> int: ...


class NoGuidePolicy:
    """Leave civilians on their initially assigned exits."""

    def select_action(self, state: Tensor, greedy: bool = True) -> int:
        return 0


class RandomPolicy:
    def __init__(self, seed: int) -> None:
        self.random = random.Random(seed)

    def select_action(self, state: Tensor, greedy: bool = True) -> int:
        return self.random.randrange(5)


class SafeExitHeuristicPolicy:
    """Signal once toward the exit opposite the initial fire centroid."""

    def __init__(self) -> None:
        self.signaled = False

    def select_action(self, state: Tensor, greedy: bool = True) -> int:
        if self.signaled:
            return 0
        self.signaled = True
        fire_x = float(state[2].item())
        return 3 if fire_x > 0.5 else 4


PolicyFactory = Callable[[int], ActionPolicy]


def evaluate_policy(
    env_config: EnvConfig,
    policy_factory: PolicyFactory,
    episodes: int,
    seed: int,
    env_kind: EnvKind = "mesa",
    netlogo_config: NetLogoEnvConfig | None = None,
) -> list[EpisodeSummary]:
    env = make_evacuation_env(
        env_kind,
        env_config,
        seed=seed,
        netlogo_config=netlogo_config,
    )
    try:
        results: list[EpisodeSummary] = []
        for index in range(episodes):
            episode_seed = seed + 1000 + index
            policy = policy_factory(episode_seed)
            state = env.reset(seed=episode_seed)
            total_reward = 0.0
            steps = 0
            while True:
                action = policy.select_action(state, greedy=True)
                state, reward, done, _ = env.step(action)
                total_reward += reward
                steps += 1
                if done:
                    break
            results.append(
                EpisodeSummary(
                    reward=total_reward,
                    evacuated=env.evacuated_count,
                    dead=env.dead_count,
                    unresolved=env.alive_count,
                    steps=steps,
                )
            )
        return results
    finally:
        env.close()
