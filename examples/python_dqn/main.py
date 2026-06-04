# References:
# - Mesa documentation: https://mesa.readthedocs.io
# - PyTorch DQN tutorial: https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html

from __future__ import annotations

import argparse
from pathlib import Path
import random

import torch
from torch.types import Device

from .config import DQNConfig, EnvConfig, TrainingConfig
from .model import EvacuationModel
from .train import evaluate, format_eval, train_dqn

DEFAULT_CHECKPOINT_DIR = Path(__file__).resolve().parent / "checkpoints"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Grid evacuation demo with Mesa + DQN."
    )
    parser.add_argument(
        "--mode", choices=("rollout", "train", "eval"), default="rollout"
    )
    parser.add_argument("--episodes", type=int, default=5)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--checkpoint", type=Path, default=DEFAULT_CHECKPOINT_DIR / "dqn_latest.pt"
    )
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--width", type=int, default=16)
    parser.add_argument("--height", type=int, default=16)
    parser.add_argument("--evacuees", type=int, default=28)
    parser.add_argument("--max-steps", type=int, default=80)
    return parser


def make_env_config(args: argparse.Namespace) -> EnvConfig:
    right_exit_x = max(0, args.width - 1)
    center_y = max(0, min(args.height - 1, args.height // 2))
    fire_center = (max(0, min(args.width - 1, args.width // 2)), center_y)
    left_wall_x = max(1, args.width // 3)
    right_wall_x = min(max(2, args.width - 2), (2 * args.width) // 3)
    walls: list[tuple[int, int]] = []
    for y in range(2, max(2, args.height - 2)):
        if y == center_y:
            continue
        if 0 < left_wall_x < args.width - 1:
            walls.append((left_wall_x, y))
        if 0 < right_wall_x < args.width - 1 and right_wall_x != left_wall_x:
            walls.append((right_wall_x, y))
    return EnvConfig(
        width=args.width,
        height=args.height,
        num_evacuees=args.evacuees,
        max_steps=args.max_steps,
        exits=((0, center_y), (right_exit_x, center_y)),
        fire_sources=(fire_center,),
        walls=tuple(walls),
    )


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def rollout(env_config: EnvConfig, episodes: int, seed: int) -> None:
    rewards: list[float] = []
    for episode in range(episodes):
        model = EvacuationModel(env_config, seed=seed + episode)
        state = model.get_state()
        total_reward = 0.0
        while not model.is_done():
            action = random.randrange(model.action_size)
            state, reward, done, info = model.env_step(action)
            total_reward += reward
            if done:
                print(
                    f"episode={episode + 1} reward={total_reward:.3f} "
                    f"evacuated={int(info['evacuated'])} dead={int(info['dead'])}"
                )
                break
        rewards.append(total_reward)
    avg_reward = sum(rewards) / max(1, len(rewards))
    print(f"avg_reward={avg_reward:.3f}")


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    set_seed(args.seed)
    env_config = make_env_config(args)
    dqn_config = DQNConfig()
    train_config = TrainingConfig(
        episodes=args.episodes,
        seed=args.seed,
        checkpoint_dir=args.checkpoint_dir,
    )
    device: Device = "cuda" if torch.cuda.is_available() else "cpu"

    if args.mode == "rollout":
        rollout(env_config, episodes=args.episodes, seed=args.seed)
        return

    if args.mode == "train":
        artifacts = train_dqn(env_config, dqn_config, train_config, device=device)
        print(f"training_complete episodes={len(artifacts.summaries)}")
        eval_results = evaluate(
            env_config, artifacts.agent, episodes=10, seed=args.seed
        )
        print(f"eval {format_eval(eval_results)}")
        return

    model = EvacuationModel(env_config, seed=args.seed)
    from .dqn import DQNAgent

    agent = DQNAgent(model.state_size, model.action_size, dqn_config, device=device)
    agent.load(str(args.checkpoint))
    results = evaluate(env_config, agent, episodes=args.episodes, seed=args.seed)
    print(f"eval {format_eval(results)}")


if __name__ == "__main__":
    main()
