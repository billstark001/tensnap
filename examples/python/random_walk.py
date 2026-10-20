"""Pure random-walk simulation without visualization-specific code."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from tensnap import NumberParameter, agent, agent_layer, env, grid_layer, params


@params(
    exclude=["world_size"],
    custom_bindings={
        "num_agents": NumberParameter(
            "", min=0, max=10000, step=1, allow_runtime_change=False
        ),
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
    },
)
@dataclass
class RandomWalkConfig:
    """Configuration for the random-walk simulation."""

    num_agents: int = 20
    step_size: float = 0.5
    world_size: int = 50
    seed: int = 7


@agent(size=0.8, color="#2563EB")
class Walker:
    """A single walker that moves by choosing a random heading every step."""

    def __init__(self, walker_id: str, world_size: int):
        self.id = walker_id
        self.world_size = world_size
        self.x = world_size / 2.0
        self.y = world_size / 2.0
        self.unwrapped_x = self.x
        self.unwrapped_y = self.y
        self.total_distance = 0.0

    def step(self, step_size: float, rng: random.Random) -> None:
        angle = rng.uniform(0.0, 2.0 * math.pi)
        dx = math.cos(angle) * step_size
        dy = math.sin(angle) * step_size
        self.unwrapped_x += dx
        self.unwrapped_y += dy
        self.x = (self.x + dx) % self.world_size
        self.y = (self.y + dy) % self.world_size
        self.total_distance += step_size

    def distance_from_center(self) -> float:
        center = self.world_size / 2.0
        dx = self.x - center
        dy = self.y - center
        return math.sqrt(dx * dx + dy * dy)

    @property
    def data(self) -> dict[str, Any]:
        return {
            "distance_from_center": self.distance_from_center(),
            "total_distance": self.total_distance,
            "squared_displacement": (self.unwrapped_x - self.world_size / 2) ** 2
            + (self.unwrapped_y - self.world_size / 2) ** 2,
        }


@grid_layer()
@agent_layer("walkers")
@env()
class RandomWalkSimulation:
    """A simple 2D random-walk simulation."""

    def __init__(self, config: RandomWalkConfig | None = None):
        self.config = config or RandomWalkConfig()
        self.rng = random.Random(self.config.seed)
        self.walkers: list[Walker] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return self.config.world_size

    @property
    def height(self) -> int:
        return self.config.world_size

    def initialize(self) -> None:
        self.rng.seed(self.config.seed)
        self.walkers = [
            Walker(f"walker_{index}", self.config.world_size)
            for index in range(int(self.config.num_agents))
        ]
        self.time_step = 0

    def step(self) -> None:
        for walker in self.walkers:
            walker.step(self.config.step_size, self.rng)
        self.time_step += 1

    def get_average_distance(self) -> float:
        if not self.walkers:
            return 0.0
        return sum(walker.distance_from_center() for walker in self.walkers) / len(
            self.walkers
        )

    def mean_squared_displacement(self) -> float:
        """Unwrapped displacement: E[MSD] = ticks × step_size² for this independent walk."""
        return sum(w.data["squared_displacement"] for w in self.walkers) / max(
            len(self.walkers), 1
        )
