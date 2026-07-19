"""TenSnap visualization for the Grid Evacuation DQN demo.

Runs a DQN agent with random (untrained) weights on the Mesa-based
evacuation grid, and exposes the simulation state to TenSnap so that
the agent-cli can render snapshots.

Run from the examples/ directory:
    python -m python_dqn.evac_viz

Or from the repo root via the package.json script:
    pnpm dev:py:evac-dqn
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

# Optional: switch between pip-installed and source tensnap (same as import_config.py)
from . import import_config as import_config  # noqa: F401

import torch
from torch.types import Device

from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
    action,
    param,
)

from .config import FIRE_EVACUATION_CHECKPOINT_SCHEMA, DQNConfig, EnvConfig
from .dqn import DQNAgent
from .guide_models import (
    UNTRAINED_GUIDE_MODEL,
    discover_guide_models,
    guide_model_dir_from_env,
)
from .model import EvacuationModel

# ---------------------------------------------------------------------------
# Visualization wrapper
# ---------------------------------------------------------------------------


class GuideModelManager:
    """Thin wrapper around EvacuationModel that exposes TenSnap layer data."""

    def __init__(
        self,
        model: EvacuationModel,
        dqn_cfg: DQNConfig,
        dqn_device: Device,
        model_dir: Path,
    ) -> None:
        self.model = model
        self.dqn_config = dqn_cfg
        self.device = dqn_device
        self.guide_model_dir = model_dir
        self._guide_model = UNTRAINED_GUIDE_MODEL
        self._loaded_guide_model = ""
        self.dqn_agent = self._new_dqn_agent(seed=0)

    def guide_model_options(self) -> list[str]:
        return discover_guide_models(self.guide_model_dir)

    def guide_model_labels(self) -> dict[str, str]:
        options = self.guide_model_options()
        return {
            UNTRAINED_GUIDE_MODEL: "Untrained DQN",
            **{name: name for name in options if name != UNTRAINED_GUIDE_MODEL},
        }

    @param(
        "enum",
        id="guideModel",
        label="Guide Model",
        options=lambda manager: manager.guide_model_options(),
        labels=lambda manager: manager.guide_model_labels(),
    )
    def guide_model(self) -> str:
        options = self.guide_model_options()
        if self._guide_model not in options:
            self._guide_model = options[0]
        return self._guide_model

    @guide_model.setter
    def set_guide_model(self, value: str) -> None:
        self._guide_model = value

    def _new_dqn_agent(self, seed: int | None = None) -> DQNAgent:
        if seed is not None:
            torch.manual_seed(seed)
        return DQNAgent(
            self.model.state_size,
            self.model.action_size,
            self.dqn_config,
            device=self.device,
            checkpoint_schema=FIRE_EVACUATION_CHECKPOINT_SCHEMA,
        )

    @action("resetGuideModel", "Reset Guide Model")
    def reset_guide_model(self) -> None:
        options = discover_guide_models(self.guide_model_dir)
        if self.guide_model not in options:
            self.guide_model = UNTRAINED_GUIDE_MODEL

        agent = self._new_dqn_agent(seed=0)
        if self.guide_model != UNTRAINED_GUIDE_MODEL:
            checkpoint = self.guide_model_dir / self.guide_model
            agent.load(str(checkpoint))
        self.dqn_agent = agent
        self._loaded_guide_model = self.guide_model
        print(f"Guide model loaded: {self._loaded_guide_model}")


def configure_visualization_scenario(
    scenario: SimulationScenario,
    env_config: EnvConfig,
    dqn_config: DQNConfig,
    device: Device,
    guide_model_dir: Path,
) -> tuple[EvacuationModel, BoundModelReinitializer, GuideModelManager]:
    model = EvacuationModel(env_config)
    model_reinitializer = BoundModelReinitializer(model, init_args=(env_config,))
    guide_mgr = GuideModelManager(model, dqn_config, device, guide_model_dir)

    scenario.add_parameters(env_config)
    model_reinitializer.register_model(scenario)
    model_reinitializer.configure_reinit(scenario)
    scenario.add_all(guide_mgr)

    return model, model_reinitializer, guide_mgr


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:

    server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
    scenario = SimulationScenario(port=server_port, step_interval=0.2)

    # Default environment and DQN configs
    env_config = EnvConfig()
    dqn_config = DQNConfig()
    device: Device = "cpu"
    guide_model_dir = guide_model_dir_from_env()

    model, model_reinitializer, guide_mgr = configure_visualization_scenario(
        scenario,
        env_config,
        dqn_config,
        device,
        guide_model_dir,
    )

    async def init():
        await model_reinitializer.model_init()
        guide_mgr.reset_guide_model()

    def step() -> bool:
        if not model.running or model.is_done():
            model.running = False
            return False

        state = model.get_state()
        action = guide_mgr.dqn_agent.select_action(state, greedy=True)
        _, _, done, _ = model.env_step(action)
        return not done

    await scenario.register_model_handler(init, step, init)

    print(f"TenSnap DQN Evacuation started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
