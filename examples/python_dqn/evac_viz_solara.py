"""Solara visualization for the Grid Evacuation DQN demo.

Run from the examples/ directory:
    solara run python_dqn/evac_viz_solara.py

Or from the repo root via the package.json script:
    pnpm dev:py:evac-dqn:solara
"""

from __future__ import annotations

# ruff: noqa: E402

from pathlib import Path
import sys

import solara
import torch
from mesa import Agent
from mesa.visualization import (
    Slider,
    SolaraViz,
    SpaceRenderer,
    make_plot_component,
)
from mesa.visualization.components import AgentPortrayalStyle
from torch.types import Device

EXAMPLES_DIR = Path(__file__).resolve().parents[1]
if str(EXAMPLES_DIR) not in sys.path:
    sys.path.insert(0, str(EXAMPLES_DIR))

from python_dqn import import_config as import_config  # noqa: F401
from python_dqn.config import (
    FIRE_EVACUATION_CHECKPOINT_SCHEMA,
    DQNConfig,
    EnvConfig,
    Position,
    build_evacuation_layout,
)
from python_dqn.dqn import DQNAgent
from python_dqn.guide_models import (
    UNTRAINED_GUIDE_MODEL,
    discover_guide_models,
    guide_model_dir_from_env,
)
from python_dqn.model import (
    EVACUEE_ALIVE_COLOR,
    EVACUEE_DEAD_COLOR,
    EVACUEE_EVACUATED_COLOR,
    EXIT_COLOR,
    FIRE_COLOR,
    GUIDE_COLOR,
    WALL_COLOR,
    EvacuationModel,
    EvacueeAgent,
    GuideAgent,
)


class CellMarkerAgent(Agent):
    """Visual-only Mesa agent used by Solara to draw patch-like cell layers."""

    pos: Position

    def __init__(
        self,
        model: EvacuationModel,
        pos: Position,
        kind: str,
        color: str,
    ) -> None:
        super().__init__(model)
        self.spawn_pos = pos
        self.kind = kind
        self.color = color


class SolaraEvacuationModel(EvacuationModel):
    """Mesa model wrapper with Solara-friendly constructor and DQN policy step."""

    def __init__(
        self,
        width: int = 17,
        height: int = 13,
        num_evacuees: int = 28,
        max_steps: int = 50,
        guide_influence_radius: int = 6,
        guide_follow_bias: float = 0.9,
        random_move_bias: float = 0.05,
        fire_spread_interval: int = 2,
        fire_spread_probability: float = 0.2,
        fire_reward_penalty: float = -8.0,
        evacuation_reward: float = 3.0,
        step_penalty: float = -0.03,
        congestion_penalty: float = -0.01,
        progress_reward: float = 0.05,
        seed: int = 7,
        guide_model: str = UNTRAINED_GUIDE_MODEL,
        checkpoint_dir: str | Path | None = None,
        dqn_device: Device | str = "cpu",
    ) -> None:
        exits, fire_sources, walls = build_evacuation_layout(width, height)
        config = EnvConfig(
            width=width,
            height=height,
            num_evacuees=num_evacuees,
            max_steps=max_steps,
            guide_influence_radius=guide_influence_radius,
            guide_follow_bias=guide_follow_bias,
            random_move_bias=random_move_bias,
            fire_spread_interval=fire_spread_interval,
            fire_spread_probability=fire_spread_probability,
            fire_reward_penalty=fire_reward_penalty,
            evacuation_reward=evacuation_reward,
            step_penalty=step_penalty,
            congestion_penalty=congestion_penalty,
            progress_reward=progress_reward,
            exits=exits,
            fire_sources=fire_sources,
            walls=walls,
        )
        super().__init__(config, seed=int(seed))
        self.seed = int(seed)
        self.guide_model = guide_model or UNTRAINED_GUIDE_MODEL
        self.guide_model_dir = (
            Path(checkpoint_dir) if checkpoint_dir else guide_model_dir_from_env()
        )
        self.device: Device | str = dqn_device
        self.total_reward = 0.0
        self.last_reward = 0.0
        self._cell_markers: dict[tuple[str, Position], CellMarkerAgent] = {}
        self.dqn_agent = self._new_dqn_agent(seed=self.seed)
        self._load_guide_model()
        self._sync_cell_markers()

    def step(self) -> None:
        if self.is_done():
            self.running = False
            return
        action = self.dqn_agent.select_action(self.get_state(), greedy=True)
        _, reward, done, _ = self.env_step(action)
        self.last_reward = reward
        self.total_reward += reward
        self.running = not done
        self._sync_cell_markers()

    def _new_dqn_agent(self, seed: int | None = None) -> DQNAgent:
        if seed is not None:
            torch.manual_seed(seed)
        return DQNAgent(
            self.state_size,
            self.action_size,
            config=DQNConfig(),
            device=self.device,
            checkpoint_schema=FIRE_EVACUATION_CHECKPOINT_SCHEMA,
        )

    def _load_guide_model(self) -> None:
        options = discover_guide_models(self.guide_model_dir)
        if self.guide_model not in options:
            self.guide_model = UNTRAINED_GUIDE_MODEL
        if self.guide_model != UNTRAINED_GUIDE_MODEL:
            self.dqn_agent.load(str(self.guide_model_dir / self.guide_model))

    def _sync_cell_markers(self) -> None:
        desired: dict[tuple[str, Position], str] = {}
        desired.update({("wall", pos): WALL_COLOR for pos in self.wall_cells})
        desired.update({("exit", pos): EXIT_COLOR for pos in self.exit_cells})
        desired.update({("fire", pos): FIRE_COLOR for pos in self.fire_cells})

        for key, marker in list(self._cell_markers.items()):
            if key not in desired:
                self.grid.remove_agent(marker)
                marker.remove()
                del self._cell_markers[key]

        for key, color in desired.items():
            if key in self._cell_markers:
                continue
            kind, pos = key
            marker = CellMarkerAgent(self, pos, kind, color)
            self.grid.place_agent(marker, pos)
            self._cell_markers[key] = marker


def agent_portrayal(agent: Agent) -> AgentPortrayalStyle:
    if isinstance(agent, CellMarkerAgent):
        return AgentPortrayalStyle(
            x=agent.pos[0],
            y=agent.pos[1],
            color=agent.color,
            marker="s",
            size=520,
            zorder=0,
            alpha=0.85,
            edgecolors="#FFFFFF",
            linewidths=0,
        )
    if isinstance(agent, GuideAgent):
        return AgentPortrayalStyle(
            x=agent.pos[0],
            y=agent.pos[1],
            color=GUIDE_COLOR,
            marker="o",
            size=150,
            zorder=3,
            alpha=0.95,
            edgecolors="#111827",
            linewidths=0.8,
        )
    if isinstance(agent, EvacueeAgent):
        return AgentPortrayalStyle(
            x=agent.pos[0],
            y=agent.pos[1],
            color=agent.color,
            marker="o",
            size=80,
            zorder=2,
            alpha=0.95,
            edgecolors="#111827",
            linewidths=0.4,
        )
    return AgentPortrayalStyle(
        x=0,
        y=0,
        color="#000000",
        marker="o",
        size=0,
        zorder=0,
        alpha=0.0,
        edgecolors="#000000",
        linewidths=0,
    )


def model_summary(model: SolaraEvacuationModel):
    return solara.Markdown(f"""
**Alive:** {model.alive_count}  
**Evacuated:** {model.evacuated_count}  
**Dead:** {model.dead_count}  
**Fire cells:** {model.fire_size}  
**Guide model:** {model.guide_model}  
**Last reward:** {model.last_reward:.2f}  
**Total reward:** {model.total_reward:.2f}
""")


guide_model_dir = guide_model_dir_from_env()
guide_models = discover_guide_models(guide_model_dir)

model_params = {
    "width": Slider("Width", 17, 8, 40, 1, dtype=int),
    "height": Slider("Height", 13, 8, 40, 1, dtype=int),
    "num_evacuees": Slider("Evacuees", 28, 5, 120, 1, dtype=int),
    "max_steps": Slider("Max Steps", 50, 20, 300, 1, dtype=int),
    "guide_influence_radius": Slider("Guide Radius", 6, 1, 8, 1, dtype=int),
    "guide_follow_bias": Slider("Guide Follow Bias", 0.9, 0.0, 1.0, 0.05, dtype=float),
    "random_move_bias": Slider("Random Move Bias", 0.05, 0.0, 0.5, 0.01, dtype=float),
    "fire_spread_interval": Slider("Fire Spread Interval", 2, 1, 10, 1, dtype=int),
    "fire_spread_probability": Slider(
        "Fire Spread Probability", 0.2, 0.0, 1.0, 0.01, dtype=float
    ),
    "evacuation_reward": Slider("Evacuation Reward", 3.0, 0.0, 10.0, 0.1, dtype=float),
    "fire_reward_penalty": Slider("Fire Penalty", -8.0, -20.0, 0.0, 0.1, dtype=float),
    "step_penalty": Slider("Step Penalty", -0.03, -1.0, 0.0, 0.01, dtype=float),
    "congestion_penalty": Slider(
        "Congestion Penalty", -0.01, -1.0, 0.0, 0.01, dtype=float
    ),
    "progress_reward": Slider("Progress Reward", 0.05, 0.0, 1.0, 0.01, dtype=float),
    "seed": {
        "type": "SliderInt",
        "value": 7,
        "min": 0,
        "max": 10000,
        "step": 1,
        "label": "Seed",
    },
    "guide_model": {
        "type": "Select",
        "value": guide_models[0],
        "values": guide_models,
        "label": "Guide Model",
    },
    "checkpoint_dir": str(guide_model_dir),
    "dqn_device": "cpu",
}

model = SolaraEvacuationModel()
renderer = SpaceRenderer(model, backend="matplotlib").setup_agents(agent_portrayal)
renderer.render()

OutcomePlot = make_plot_component(
    {
        "Alive": EVACUEE_ALIVE_COLOR,
        "Evacuated": EVACUEE_EVACUATED_COLOR,
        "Dead": EVACUEE_DEAD_COLOR,
    }
)
FirePlot = make_plot_component({"Fire Size": FIRE_COLOR})

page = SolaraViz(
    model,
    renderer,
    components=[
        model_summary,
        OutcomePlot,
        FirePlot,
    ],  # type: ignore[list-item]
    model_params=model_params,
    name="Grid Evacuation DQN",
    play_interval=200,
)
