from __future__ import annotations

from pathlib import Path
import random

import torch
from torch import Tensor
from torch.types import Device

from .config import DQNConfig, EnvConfig
from .dqn import DQNAgent
from .model import EvacuationModel

UNTRAINED_GUIDE_MODEL = "untrained"

_agent: DQNAgent | None = None
_loaded_model = UNTRAINED_GUIDE_MODEL
_device: Device = "cpu"


def _checkpoint_path(checkpoint_dir: str | None, checkpoint_name: str) -> Path:
    directory = Path(checkpoint_dir or Path(__file__).resolve().parent / "checkpoints")
    if not directory.is_absolute():
        directory = Path.cwd() / directory
    return directory / checkpoint_name


def setup(
    checkpoint_dir: str | None = None,
    checkpoint_name: str = UNTRAINED_GUIDE_MODEL,
    seed: int = 0,
    width: int = 16,
    height: int = 16,
    num_evacuees: int = 28,
    max_steps: int = 80,
) -> str:
    global _agent, _loaded_model

    random.seed(seed)
    torch.manual_seed(seed)

    env_config = EnvConfig(
        width=width,
        height=height,
        num_evacuees=num_evacuees,
        max_steps=max_steps,
    )
    base_model = EvacuationModel(env_config, seed=seed)
    _agent = DQNAgent(
        base_model.state_size,
        base_model.action_size,
        DQNConfig(),
        device=_device,
    )

    checkpoint_name = checkpoint_name or UNTRAINED_GUIDE_MODEL
    if checkpoint_name != UNTRAINED_GUIDE_MODEL:
        _agent.load(str(_checkpoint_path(checkpoint_dir, checkpoint_name)))

    _loaded_model = checkpoint_name
    return _loaded_model


def select_action(state_values: list[float]) -> int:
    if _agent is None:
        setup()
    assert _agent is not None

    if len(state_values) != 16:
        raise ValueError(f"Expected 16 state values, received {len(state_values)}.")

    state: Tensor = torch.Tensor([float(value) for value in state_values])
    return int(_agent.select_action(state, greedy=True))


def loaded_model() -> str:
    return _loaded_model
