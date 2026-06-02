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
from dataclasses import dataclass
from typing import ClassVar

# Optional: switch between pip-installed and source tensnap (same as import_config.py)
from . import import_config  # noqa: F401

import torch

from tensnap import SimulationScenario, chart
from tensnap import agent, env, grid_layer, agent_layer

from .config import DQNConfig, EnvConfig
from .dqn import DQNAgent
from .model import EvacuationModel, EvacueeAgent, GuideAgent

WALL_COLOR = "#374151"
EXIT_COLOR = "#16A34A"
FIRE_COLOR = "#DC2626"
EVACUEE_ALIVE_COLOR = "#F59E0B"
EVACUEE_EVACUATED_COLOR = "#16A34A"
EVACUEE_DEAD_COLOR = "#9CA3AF"
GUIDE_COLOR = "#2563EB"


# ---------------------------------------------------------------------------
# TenSnap item projection
# ---------------------------------------------------------------------------


@agent(x=True, y=True, icon=True, size=True, color=True)
@dataclass(frozen=True, slots=True)
class MapCell:
    """A renderable grid cell for static obstacles and dynamic hazards."""

    id: str
    x: int
    y: int
    color: str

    icon: ClassVar[str] = "square"
    size: ClassVar[float] = 1.0


@agent(
    x="source.pos[0]",
    y="source.pos[1]",
    icon=True,
    size=True,
    color=True,
    data=True,
)
@dataclass(frozen=True, slots=True)
class EvacueeView:
    """TenSnap view item for a Mesa evacuee agent."""

    source: EvacueeAgent

    icon: ClassVar[str] = "circle"
    size: ClassVar[float] = 0.6

    @property
    def id(self) -> str:
        return f"evacuee:{self.source.unique_id}"

    @property
    def color(self) -> str:
        if self.source.evacuated:
            return EVACUEE_EVACUATED_COLOR
        if not self.source.alive:
            return EVACUEE_DEAD_COLOR
        return EVACUEE_ALIVE_COLOR

    @property
    def data(self) -> dict[str, bool]:
        return {
            "alive": self.source.alive,
            "evacuated": self.source.evacuated,
        }


@agent(
    x="source.pos[0]",
    y="source.pos[1]",
    icon=True,
    size=True,
    color=True,
)
@dataclass(frozen=True, slots=True)
class GuideView:
    """TenSnap view item for the DQN-controlled guide agent."""

    source: GuideAgent

    id: ClassVar[str] = "guide"
    icon: ClassVar[str] = "circle"
    size: ClassVar[float] = 0.9
    color: ClassVar[str] = GUIDE_COLOR


# ---------------------------------------------------------------------------
# Scenario setup
# ---------------------------------------------------------------------------

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, step_interval=0.2)

# Default environment and DQN configs
env_config = EnvConfig()
dqn_config = DQNConfig()
device = torch.device("cpu")

# DQN agent with random (untrained) weights — no checkpoint needed
_base_model = EvacuationModel(env_config, seed=0)
dqn_agent = DQNAgent(
    _base_model.state_size, _base_model.action_size, dqn_config, device=device
)


# ---------------------------------------------------------------------------
# Visualization wrapper
# ---------------------------------------------------------------------------


@env(id="evacuation")
@grid_layer(width="width", height="height")
@agent_layer("cells", item_iterable_projector="map_cells")
@agent_layer("evacuees", item_iterable_projector="evacuees")
@agent_layer("guide", item_iterable_projector="guide")
class EvacuationVizWrapper:
    """Thin wrapper around EvacuationModel that exposes TenSnap layer data."""

    def __init__(self, cfg: EnvConfig, agent: DQNAgent) -> None:
        self.env_config = cfg
        self.dqn_agent = agent
        self._model: EvacuationModel | None = None
        self._episode_seed = 0

    # -- TenSnap grid metadata --

    @property
    def width(self) -> int:
        return self.env_config.width

    @property
    def height(self) -> int:
        return self.env_config.height

    # -- Lifecycle --

    def initialize(self) -> None:
        self._model = EvacuationModel(self.env_config, seed=self._episode_seed)
        self._episode_seed += 1

    def step(self) -> None:
        if self._model is None:
            self.initialize()
            return
        if self._model.is_done():
            self.initialize()
            return
        state = self._model.get_state()
        action = self.dqn_agent.select_action(state, greedy=True)
        self._model.env_step(action)

    # -- Layer item sources --

    def map_cells(self) -> list[MapCell]:
        """Return static map cells and dynamic fire cells."""
        if self._model is None:
            return []
        return [
            *[
                MapCell(f"wall:{x}:{y}", x, y, WALL_COLOR)
                for x, y in sorted(self._model.wall_cells)
            ],
            *[
                MapCell(f"exit:{x}:{y}", x, y, EXIT_COLOR)
                for x, y in sorted(self._model.exit_cells)
            ],
            *[
                MapCell(f"fire:{x}:{y}", x, y, FIRE_COLOR)
                for x, y in sorted(self._model.fire_cells)
            ],
        ]

    def evacuees(self) -> list[EvacueeView]:
        if self._model is None:
            return []
        return [EvacueeView(evacuee) for evacuee in self._model.evacuees]

    def guide(self) -> list[GuideView]:
        if self._model is None:
            return []
        return [GuideView(self._model.guide)]

    # -- Chart helpers --

    def alive_count(self) -> float:
        return float(self._model.alive_count) if self._model else 0.0

    def evacuated_count(self) -> float:
        return float(self._model.evacuated_count) if self._model else 0.0

    def dead_count(self) -> float:
        return float(self._model.dead_count) if self._model else 0.0

    def fire_size(self) -> float:
        return float(len(self._model.fire_cells)) if self._model else 0.0


# ---------------------------------------------------------------------------
# Model instance & charts
# ---------------------------------------------------------------------------

viz_model = EvacuationVizWrapper(env_config, dqn_agent)


@chart("alive", "Alive Evacuees", color="#F59E0B")
def track_alive() -> float:
    return viz_model.alive_count()


@chart("evacuated", "Evacuated", color="#16A34A")
def track_evacuated() -> float:
    return viz_model.evacuated_count()


@chart("dead", "Dead", color="#9CA3AF")
def track_dead() -> float:
    return viz_model.dead_count()


@chart("fire_size", "Fire Size", color="#DC2626")
def track_fire() -> float:
    return viz_model.fire_size()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def main() -> None:
    viz_model.initialize()

    scenario.add_all(viz_model)
    scenario.add_all(globals())

    await scenario.register_model_handler(
        viz_model.initialize,
        viz_model.step,
        viz_model.initialize,
    )

    print(f"TenSnap DQN Evacuation started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
