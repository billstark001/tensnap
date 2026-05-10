# Reference:
# - PyTorch DQN tutorial: https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html
# - Mesa documentation: https://mesa.readthedocs.io

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from typing import Iterable

import torch

from .config import DQNConfig, EnvConfig, TrainingConfig
from .dqn import DQNAgent
from .model import EvacuationModel


@dataclass(slots=True)
class EpisodeSummary:
    reward: float
    evacuated: int
    dead: int
    steps: int


@dataclass(slots=True)
class TrainArtifacts:
    agent: DQNAgent
    summaries: list[EpisodeSummary]


def run_episode(model: EvacuationModel, agent: DQNAgent, train: bool) -> EpisodeSummary:
    state = model.get_state()
    total_reward = 0.0
    steps = 0
    while True:
        action = agent.select_action(state, greedy=not train)
        next_state, reward, done, _ = model.env_step(action)
        if train:
            agent.store(state, action, reward, next_state, done)
            agent.optimize()
        total_reward += reward
        state = next_state
        steps += 1
        if done:
            break
    return EpisodeSummary(
        reward=total_reward,
        evacuated=model.evacuated_count,
        dead=model.dead_count,
        steps=steps,
    )


def train_dqn(
    env_config: EnvConfig,
    dqn_config: DQNConfig,
    train_config: TrainingConfig,
    device: torch.device,
) -> TrainArtifacts:
    base_model = EvacuationModel(env_config, seed=train_config.seed)
    agent = DQNAgent(
        base_model.state_size, base_model.action_size, dqn_config, device=device
    )
    train_config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    summaries: list[EpisodeSummary] = []

    for episode in range(1, train_config.episodes + 1):
        model = EvacuationModel(env_config, seed=train_config.seed + episode)
        summary = run_episode(model, agent, train=True)
        summaries.append(summary)
        if episode % train_config.log_every == 0:
            recent = summaries[-train_config.log_every :]
            print(
                f"episode={episode:04d} "
                f"reward={mean(s.reward for s in recent):.3f} "
                f"evacuated={mean(s.evacuated for s in recent):.2f} "
                f"dead={mean(s.dead for s in recent):.2f} "
                f"steps={mean(s.steps for s in recent):.2f}"
            )
        if episode % train_config.checkpoint_every == 0:
            agent.save(str(train_config.checkpoint_dir / f"dqn_ep_{episode}.pt"))

    agent.save(str(train_config.checkpoint_dir / "dqn_latest.pt"))
    return TrainArtifacts(agent=agent, summaries=summaries)


def evaluate(
    env_config: EnvConfig,
    agent: DQNAgent,
    episodes: int,
    seed: int,
) -> list[EpisodeSummary]:
    results: list[EpisodeSummary] = []
    for idx in range(episodes):
        model = EvacuationModel(env_config, seed=seed + 1000 + idx)
        results.append(run_episode(model, agent, train=False))
    return results


def format_eval(results: Iterable[EpisodeSummary]) -> str:
    items = list(results)
    return (
        f"reward={mean(r.reward for r in items):.3f}, "
        f"evacuated={mean(r.evacuated for r in items):.2f}, "
        f"dead={mean(r.dead for r in items):.2f}, "
        f"steps={mean(r.steps for r in items):.2f}"
    )
