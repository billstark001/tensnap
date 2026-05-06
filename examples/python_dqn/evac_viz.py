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
import sys
from pathlib import Path

# Optional: switch between pip-installed and source tensnap
_USE_SOURCE = os.environ.get("TENSNAP_USE_SOURCE", "0") == "1"
if _USE_SOURCE:
    _repo_root = Path(__file__).resolve().parents[2]
    _src = _repo_root / "packages" / "tensnap-python"
    if _src.exists():
        sys.path.insert(0, str(_src))
        print(f"Using tensnap from source: {_src}")

import torch

from tensnap import BindParametersConfig, SimulationScenario, chart
from tensnap import env, grid_layer, agent_layer

from .config import DQNConfig, EnvConfig
from .dqn import DQNAgent
from .model import EvacuationModel

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
@agent_layer("cells", item_iterable_projector="get_cell_layer")
@agent_layer("evacuees", item_iterable_projector="get_evacuee_layer")
@agent_layer("guide", item_iterable_projector="get_guide_layer")
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

    # -- Layer renderers --

    def get_cell_layer(self) -> list[dict]:
        """Return static/dynamic cells: walls, exits, fire."""
        if self._model is None:
            return []
        cells: list[dict] = []
        for x, y in self._model.wall_cells:
            cells.append(
                {
                    "id": f"wall:{x}:{y}",
                    "x": x,
                    "y": y,
                    "icon": "square",
                    "size": 1.0,
                    "color": "#374151",  # dark gray
                }
            )
        for x, y in self._model.exit_cells:
            cells.append(
                {
                    "id": f"exit:{x}:{y}",
                    "x": x,
                    "y": y,
                    "icon": "square",
                    "size": 1.0,
                    "color": "#16A34A",  # green
                }
            )
        for x, y in self._model.fire_cells:
            cells.append(
                {
                    "id": f"fire:{x}:{y}",
                    "x": x,
                    "y": y,
                    "icon": "square",
                    "size": 1.0,
                    "color": "#DC2626",  # red
                }
            )
        return cells

    def get_evacuee_layer(self) -> list[dict]:
        """Return one item per evacuee, colored by status."""
        if self._model is None:
            return []
        items: list[dict] = []
        for evacuee in self._model.evacuees:
            x, y = evacuee.pos
            if evacuee.evacuated:
                color = "#16A34A"  # green
            elif not evacuee.alive:
                color = "#9CA3AF"  # gray
            else:
                color = "#F59E0B"  # amber
            items.append(
                {
                    "id": f"evacuee:{evacuee.unique_id}",
                    "x": x,
                    "y": y,
                    "icon": "circle",
                    "size": 0.6,
                    "color": color,
                    "data": {
                        "alive": evacuee.alive,
                        "evacuated": evacuee.evacuated,
                    },
                }
            )
        return items

    def get_guide_layer(self) -> list[dict]:
        """Return a single item for the DQN-controlled guide agent."""
        if self._model is None:
            return []
        x, y = self._model.guide.pos
        return [
            {
                "id": "guide",
                "x": x,
                "y": y,
                "icon": "circle",
                "size": 0.9,
                "color": "#2563EB",  # blue
            }
        ]

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

    scenario.add_environment(viz_model)
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        viz_model.initialize,
        viz_model.step,
        viz_model.initialize,
    )

    print(f"TenSnap DQN Evacuation started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
