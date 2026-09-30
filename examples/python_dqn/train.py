# Reference:
# - PyTorch DQN tutorial: https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html
# - Mesa documentation: https://mesa.readthedocs.io

from __future__ import annotations

from dataclasses import dataclass
from statistics import mean
from typing import Iterable

from torch.types import Device

from .config import (
    FIRE_EVACUATION_CHECKPOINT_SCHEMA,
    DQNConfig,
    EnvConfig,
    TrainingConfig,
)
from .dqn import DQNAgent
from .envs import EnvKind, EvacuationEnv, NetLogoEnvConfig, make_evacuation_env


@dataclass(slots=True)
class EpisodeSummary:
    reward: float
    evacuated: int
    dead: int
    unresolved: int
    steps: int


@dataclass(slots=True)
class TrainArtifacts:
    agent: DQNAgent
    summaries: list[EpisodeSummary]


def run_episode(
    env: EvacuationEnv,
    agent: DQNAgent,
    train: bool,
    seed: int | None = None,
) -> EpisodeSummary:
    state = env.reset(seed=seed)
    total_reward = 0.0
    steps = 0
    while True:
        action = agent.select_action(state, greedy=not train)
        next_state, reward, done, _ = env.step(action)
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
        evacuated=env.evacuated_count,
        dead=env.dead_count,
        unresolved=env.alive_count,
        steps=steps,
    )


def train_dqn(
    env_config: EnvConfig,
    dqn_config: DQNConfig,
    train_config: TrainingConfig,
    device: Device | str,
    env_kind: EnvKind = "mesa",
    netlogo_config: NetLogoEnvConfig | None = None,
) -> TrainArtifacts:
    env = make_evacuation_env(
        env_kind,
        env_config,
        seed=train_config.seed,
        netlogo_config=netlogo_config,
    )
    try:
        agent = DQNAgent(
            env.state_size,
            env.action_size,
            dqn_config,
            device=device,
            checkpoint_schema=FIRE_EVACUATION_CHECKPOINT_SCHEMA,
        )
        train_config.checkpoint_dir.mkdir(parents=True, exist_ok=True)
        summaries: list[EpisodeSummary] = []

        for episode in range(1, train_config.episodes + 1):
            summary = run_episode(
                env,
                agent,
                train=True,
                seed=train_config.seed + episode,
            )
            summaries.append(summary)
            if episode % train_config.log_every == 0:
                recent = summaries[-train_config.log_every :]
                print(
                    f"episode={episode:04d} "
                    f"env={env_kind} "
                    f"reward={mean(s.reward for s in recent):.3f} "
                    f"evacuated={mean(s.evacuated for s in recent):.2f} "
                    f"dead={mean(s.dead for s in recent):.2f} "
                    f"unresolved={mean(s.unresolved for s in recent):.2f} "
                    f"steps={mean(s.steps for s in recent):.2f}"
                )
            if episode % train_config.checkpoint_every == 0:
                agent.save(str(train_config.checkpoint_dir / f"dqn_ep_{episode}.pt"))

        agent.save(str(train_config.checkpoint_dir / "dqn_latest.pt"))
        return TrainArtifacts(agent=agent, summaries=summaries)
    finally:
        env.close()


def evaluate(
    env_config: EnvConfig,
    agent: DQNAgent,
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
        for idx in range(episodes):
            results.append(run_episode(env, agent, train=False, seed=seed + 1000 + idx))
        return results
    finally:
        env.close()


def format_eval(results: Iterable[EpisodeSummary]) -> str:
    items = list(results)
    return (
        f"reward={mean(r.reward for r in items):.3f}, "
        f"evacuated={mean(r.evacuated for r in items):.2f}, "
        f"dead={mean(r.dead for r in items):.2f}, "
        f"unresolved={mean(r.unresolved for r in items):.2f}, "
        f"steps={mean(r.steps for r in items):.2f}"
    )
