from __future__ import annotations

from pathlib import Path
import random
import sys
from typing import Any


UNTRAINED_GUIDE_MODEL = "untrained"

_agent: Any | None = None
_loaded_model = UNTRAINED_GUIDE_MODEL
_device = "cpu"


def _ensure_tensnap_source_path() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    source_path = repo_root / "packages" / "tensnap-python"
    if source_path.exists() and str(source_path) not in sys.path:
        sys.path.insert(0, str(source_path))


def _load_dependencies():
    _ensure_tensnap_source_path()
    try:
        import torch

        from .config import DQNConfig, EnvConfig, build_evacuation_layout
        from .dqn import DQNAgent
        from .model import EvacuationModel
    except ModuleNotFoundError as exc:
        missing = exc.name or "a required Python package"
        raise RuntimeError(
            f"Python DQN policy requires '{missing}'. NetLogo is using "
            f"'{sys.executable}'. Set python-executable to a Python environment "
            "with torch, mesa, and tensnap installed."
        ) from exc
    return (
        torch,
        DQNConfig,
        EnvConfig,
        build_evacuation_layout,
        DQNAgent,
        EvacuationModel,
    )


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

    torch, DQNConfig, EnvConfig, build_evacuation_layout, DQNAgent, EvacuationModel = (
        _load_dependencies()
    )

    random.seed(seed)
    torch.manual_seed(seed)

    exits, fire_sources, walls = build_evacuation_layout(width, height)
    env_config = EnvConfig(
        width=width,
        height=height,
        num_evacuees=num_evacuees,
        max_steps=max_steps,
        exits=exits,
        fire_sources=fire_sources,
        walls=walls,
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
    torch, *_ = _load_dependencies()

    if _agent is None:
        setup()
    assert _agent is not None

    if len(state_values) != 16:
        raise ValueError(f"Expected 16 state values, received {len(state_values)}.")

    state = torch.Tensor([float(value) for value in state_values])
    return int(_agent.select_action(state, greedy=True))


def loaded_model() -> str:
    return _loaded_model
