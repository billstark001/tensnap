# References:
# - Mesa documentation: https://mesa.readthedocs.io
# - PyTorch DQN tutorial: https://docs.pytorch.org/tutorials/intermediate/reinforcement_q_learning.html

from __future__ import annotations

import argparse
from pathlib import Path
import random

import torch
from torch.types import Device

from .config import DQNConfig, EnvConfig, TrainingConfig, build_evacuation_layout
from .dqn import DQNAgent
from .envs import EnvKind, NetLogoEnvConfig, make_evacuation_env
from .train import evaluate, format_eval, run_episode, train_dqn

DEFAULT_CHECKPOINT_DIR = Path(__file__).resolve().parent / "checkpoints"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Grid evacuation demo with Mesa + DQN."
    )
    parser.add_argument(
        "--mode", choices=("rollout", "train", "eval"), default="rollout"
    )
    parser.add_argument(
        "--env",
        choices=("mesa", "netlogo"),
        default="mesa",
        help="Environment implementation used for rollout/train/eval.",
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
    parser.add_argument(
        "--netlogo-model",
        type=Path,
        default=None,
        help="Optional NetLogo model path for --env netlogo.",
    )
    parser.add_argument(
        "--netlogo-home",
        type=Path,
        default=None,
        help="Optional NetLogo installation path for pyNetLogo.",
    )
    parser.add_argument(
        "--netlogo-gui",
        action="store_true",
        help="Open NetLogo GUI while using --env netlogo.",
    )
    return parser


def make_env_config(args: argparse.Namespace) -> EnvConfig:
    exits, fire_sources, walls = build_evacuation_layout(args.width, args.height)
    return EnvConfig(
        width=args.width,
        height=args.height,
        num_evacuees=args.evacuees,
        max_steps=args.max_steps,
        exits=exits,
        fire_sources=fire_sources,
        walls=walls,
    )


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def rollout(
    env_config: EnvConfig,
    episodes: int,
    seed: int,
    env_kind: EnvKind,
    netlogo_config: NetLogoEnvConfig | None,
) -> None:
    rewards: list[float] = []
    env = make_evacuation_env(
        env_kind,
        env_config,
        seed=seed,
        netlogo_config=netlogo_config,
    )
    try:

        class RandomAgent:
            def select_action(self, state, greedy: bool = False) -> int:
                return random.randrange(env.action_size)

        agent = RandomAgent()
        for episode in range(episodes):
            summary = run_episode(
                env,
                agent,  # type: ignore[arg-type]
                train=False,
                seed=seed + episode,
            )
            rewards.append(summary.reward)
            print(
                f"episode={episode + 1} env={env_kind} "
                f"reward={summary.reward:.3f} "
                f"evacuated={summary.evacuated} dead={summary.dead}"
            )
        avg_reward = sum(rewards) / max(1, len(rewards))
        print(f"avg_reward={avg_reward:.3f}")
    finally:
        env.close()


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    set_seed(args.seed)
    env_config = make_env_config(args)
    dqn_config = DQNConfig()
    netlogo_config = NetLogoEnvConfig(
        model_path=args.netlogo_model,
        netlogo_home=args.netlogo_home,
        gui=args.netlogo_gui,
    )
    train_config = TrainingConfig(
        episodes=args.episodes,
        seed=args.seed,
        checkpoint_dir=args.checkpoint_dir,
    )
    device: Device = "cuda" if torch.cuda.is_available() else "cpu"

    if args.mode == "rollout":
        rollout(
            env_config,
            episodes=args.episodes,
            seed=args.seed,
            env_kind=args.env,
            netlogo_config=netlogo_config,
        )
        return

    if args.mode == "train":
        artifacts = train_dqn(
            env_config,
            dqn_config,
            train_config,
            device=device,
            env_kind=args.env,
            netlogo_config=netlogo_config,
        )
        print(f"training_complete episodes={len(artifacts.summaries)}")
        eval_results = evaluate(
            env_config,
            artifacts.agent,
            episodes=10,
            seed=args.seed,
            env_kind=args.env,
            netlogo_config=netlogo_config,
        )
        print(f"eval {format_eval(eval_results)}")
        return

    env = make_evacuation_env(
        args.env,
        env_config,
        seed=args.seed,
        netlogo_config=netlogo_config,
    )
    agent = DQNAgent(env.state_size, env.action_size, dqn_config, device=device)
    env.close()
    agent.load(str(args.checkpoint))
    results = evaluate(
        env_config,
        agent,
        episodes=args.episodes,
        seed=args.seed,
        env_kind=args.env,
        netlogo_config=netlogo_config,
    )
    print(f"eval {format_eval(results)}")


if __name__ == "__main__":
    main()
