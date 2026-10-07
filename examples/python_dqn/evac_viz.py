"""TenSnap visualization for the Grid Evacuation DQN demo.

Runs a DQN agent with random (untrained) weights on the Mesa-based
evacuation grid, and exposes the simulation state to TenSnap so that
the agent-cli can render snapshots.

Run from the examples/ directory:
    python -m python_dqn.evac_viz

Or from the repo root via the package.json script:
    pnpm dev:py:evac-dqn
"""

# isort: skip_file
# import_config must precede imports of tensnap.
from __future__ import annotations

import asyncio
import copy
import os
from dataclasses import asdict
from pathlib import Path

# Bootstrap source selection before any module imports tensnap.
from . import import_config as import_config  # noqa: F401

import torch
from tensnap import (
    BoundModelReinitializer,
    SimulationScenario,
    action,
    checkpoint,
    param,
)
from torch.types import Device

from .checkpoint import STATE_SCHEMA, capture_model, restore_model
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


@checkpoint(capture="capture_checkpoint", restore="restore_checkpoint")
class GuideModelManager:
    """Own the live model’s inference policy and checkpoint callbacks."""

    def __init__(
        self,
        model: EvacuationModel,
        dqn_cfg: DQNConfig,
        dqn_device: Device,
        model_dir: Path,
    ) -> None:
        self.model = model
        self.scenario: SimulationScenario | None = None
        self.last_transition = None
        self.dqn_config = dqn_cfg
        self.device = dqn_device
        self.guide_model_dir = model_dir
        self._guide_model = UNTRAINED_GUIDE_MODEL
        self._loaded_guide_model = ""
        self.dqn_agent = self._new_dqn_agent(seed=0)

    def guide_model_options(self) -> list[str]:
        # A restored policy is embedded in the checkpoint, even if its file
        # has since disappeared. Keep its name selectable without rereading it.
        options = discover_guide_models(self.guide_model_dir)
        for name in (self._guide_model, self._loaded_guide_model):
            if name and name not in options:
                options.append(name)
        return options

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
        return self._guide_model

    @guide_model.setter
    def set_guide_model(self, value: str) -> None:
        self._guide_model = value

    def _new_dqn_agent(self, seed: int | None = None) -> DQNAgent:
        if seed is not None:
            # Constructing/resetting a guide must not disturb other hosts.
            with torch.random.fork_rng(devices=[]):
                torch.manual_seed(seed)
                return self._new_dqn_agent()
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

    def step(self) -> bool:
        if not self.model.running or self.model.is_done():
            self.model.running = False
            return False
        action_id = self.dqn_agent.select_action(self.model.get_state(), greedy=True)
        return self.advance(action_id)

    def advance(self, action_id: int) -> bool:
        state, reward, done, info = self.model.env_step(action_id)
        self.last_transition = {
            "action": action_id,
            "observation": state.tolist(),
            "reward": reward,
            "done": done,
            "info": info,
        }
        return not done

    def capture_checkpoint(self) -> dict:
        if str(self.device) != "cpu" or len(self.dqn_agent.buffer):
            raise ValueError("exact checkpoints support CPU inference only")
        return {
            "schema": STATE_SCHEMA,
            "model": capture_model(self.model),
            "policy_config": asdict(self.dqn_config),
            "policy": {
                name: value.detach().cpu().tolist()
                for name, value in self.dqn_agent.policy_net.state_dict().items()
            },
            "policy_steps": self.dqn_agent.total_steps,
            "optimization_steps": self.dqn_agent.optimization_steps,
            "selected_policy": self._guide_model,
            "loaded_policy": self._loaded_guide_model,
            "last_transition": copy.deepcopy(self.last_transition),
            "time": (
                self.scenario._time_step if self.scenario else self.model.step_count
            ),
        }

    def restore_checkpoint(self, saved: dict) -> None:
        if saved["schema"] != STATE_SCHEMA:
            raise ValueError("incompatible fire/DQN inference checkpoint")
        if any(
            type(saved[key]) is not str for key in ("selected_policy", "loaded_policy")
        ):
            raise ValueError("invalid checkpoint policy names")
        if any(
            type(saved[key]) is not int or saved[key] < 0
            for key in ("policy_steps", "optimization_steps")
        ):
            raise ValueError("invalid checkpoint policy counters")
        config = DQNConfig(**saved["policy_config"])
        with torch.random.fork_rng(devices=[]):
            agent = DQNAgent(
                16,
                5,
                config,
                device="cpu",
                checkpoint_schema=FIRE_EVACUATION_CHECKPOINT_SCHEMA,
            )
        weights = agent.policy_net.state_dict()
        if weights.keys() != saved["policy"].keys():
            raise ValueError("invalid checkpoint policy keys")
        restored = {
            name: torch.tensor(saved["policy"][name], dtype=value.dtype)
            for name, value in weights.items()
        }
        if any(
            restored[name].shape != value.shape
            or not torch.isfinite(restored[name]).all()
            for name, value in weights.items()
        ):
            raise ValueError("invalid checkpoint policy tensors")
        if type(saved["time"]) is not int or saved["time"] < 0:
            raise ValueError("invalid checkpoint scenario time")
        agent.policy_net.load_state_dict(restored)
        agent.target_net.load_state_dict(restored)
        agent.total_steps = saved["policy_steps"]
        agent.optimization_steps = saved["optimization_steps"]
        restore_model(self.model, saved["model"])
        self.dqn_config = config
        self.dqn_agent = agent
        self._guide_model = saved["selected_policy"]
        self._loaded_guide_model = saved["loaded_policy"]
        self.last_transition = copy.deepcopy(saved["last_transition"])
        # The binding has no public clock setter. Checkpoint-only restores must
        # restore its clock too, even when the client omits projected time.
        if self.scenario:
            self.scenario._time_step = saved["time"]


def configure_visualization_scenario(
    scenario: SimulationScenario,
    env_config: EnvConfig,
    dqn_config: DQNConfig,
    device: Device,
    guide_model_dir: Path,
    seed: int | None = None,
) -> tuple[EvacuationModel, BoundModelReinitializer, GuideModelManager]:
    model = EvacuationModel(env_config, seed=seed)
    model_reinitializer = BoundModelReinitializer(model, init_args=(env_config, seed))
    guide_mgr = GuideModelManager(model, dqn_config, device, guide_model_dir)
    guide_mgr.scenario = scenario

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
    scenario = SimulationScenario(
        port=server_port,
        step_interval=0.2,
        use_msgpack=os.environ.get("TENSNAP_ENCODING") == "msgpack",
        model_id="examples.fire-dqn",
        state_schema_version=STATE_SCHEMA,
    )

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
        seed=int(os.environ["TENSNAP_SEED"]) if "TENSNAP_SEED" in os.environ else None,
    )

    async def init():
        await model_reinitializer.model_init()
        guide_mgr.reset_guide_model()
        guide_mgr.last_transition = None
        scenario.add_scene_restore(guide_mgr)

    await scenario.register_model_handler(init, guide_mgr.step, init)

    print(f"TenSnap DQN Evacuation started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
