"""Predator-prey ecosystem example for TenSnap tutorials."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from tensnap import agent, agent_layer, env, grid_layer


SHEEP_ASSET_ID = "wolf-sheep:sheep"
WOLF_ASSET_ID = "wolf-sheep:wolf"
SHEEP_ICON = f"asset:{SHEEP_ASSET_ID}"
WOLF_ICON = f"asset:{WOLF_ASSET_ID}"


@dataclass
class PredatorPreyConfig:
    width: int = 50
    height: int = 50
    initial_sheep: int = 100
    initial_wolves: int = 50
    sheep_gain_from_food: float = 4.0
    wolf_gain_from_food: float = 20.0
    sheep_reproduce_rate: float = 4.0
    wolf_reproduce_rate: float = 5.0
    sheep_energy_loss: float = 0.4
    wolf_energy_loss: float = 1.0
    wolf_sight_radius: int = 5
    grass_regrowth_steps: int = 30


@agent(x=True, y=True, size=True, color=True, icon=True, data=True)
class Sheep:
    size = 1.0
    color = "#F8FAFC"
    icon = SHEEP_ICON

    def __init__(self, sheep_id: str, x: int, y: int, energy: float):
        self.id = sheep_id
        self.x = x
        self.y = y
        self.energy = energy
        self.age = 0

    @property
    def data(self) -> dict[str, Any]:
        return {"energy": round(self.energy, 2), "age": self.age, "species": "sheep"}


@agent(x=True, y=True, size=True, color=True, icon=True, data=True)
class Wolf:
    size = 1.0
    color = "#111827"
    icon = WOLF_ICON

    def __init__(self, wolf_id: str, x: int, y: int, energy: float):
        self.id = wolf_id
        self.x = x
        self.y = y
        self.energy = energy
        self.age = 0

    @property
    def data(self) -> dict[str, Any]:
        return {"energy": round(self.energy, 2), "age": self.age, "species": "wolf"}


@agent_layer("wolves", item_iterable_projector="wolves", z_index="z_wolves")
@agent_layer("sheep", item_iterable_projector="sheep", z_index="z_sheep")
@agent_layer("grass", item_iterable_projector="get_grass_layer", z_index="z_grass")
@grid_layer(width="width", height="height")
@env(id="predator_prey")
class PredatorPreySimulation:
    """Simple toroidal predator-prey model with renewable grass."""

    z_grass = 0
    z_sheep = 40
    z_wolves = 50

    def __init__(self, config: PredatorPreyConfig | None = None):
        self.config = config or PredatorPreyConfig()
        self.width = self.config.width
        self.height = self.config.height
        self.sheep: list[Sheep] = []
        self.wolves: list[Wolf] = []
        self._next_sheep_id = 0
        self._next_wolf_id = 0
        self.time_step = 0
        self.grass_timer: list[list[int]] = []

    def _random_position(self) -> tuple[int, int]:
        return (
            random.randrange(self.width),
            random.randrange(self.height),
        )

    def _spawn_sheep(self, x: int, y: int, energy: float | None = None) -> Sheep:
        sheep = Sheep(
            f"sheep_{self._next_sheep_id}",
            x,
            y,
            energy if energy is not None else random.uniform(4.0, 8.0),
        )
        self._next_sheep_id += 1
        return sheep

    def _spawn_wolf(self, x: int, y: int, energy: float | None = None) -> Wolf:
        wolf = Wolf(
            f"wolf_{self._next_wolf_id}",
            x,
            y,
            energy if energy is not None else random.uniform(10.0, 16.0),
        )
        self._next_wolf_id += 1
        return wolf

    def initialize(self) -> None:
        self.width = self.config.width
        self.height = self.config.height
        self.time_step = 0
        self._next_sheep_id = 0
        self._next_wolf_id = 0
        self.grass_timer = [[0 for _ in range(self.height)] for _ in range(self.width)]
        self.sheep = []
        self.wolves = []

        for _ in range(self.config.initial_sheep):
            x, y = self._random_position()
            self.sheep.append(self._spawn_sheep(x, y))

        for _ in range(self.config.initial_wolves):
            x, y = self._random_position()
            self.wolves.append(self._spawn_wolf(x, y))

    def _move_random(self, x: int, y: int) -> tuple[int, int]:
        dx, dy = random.choice(((1, 0), (-1, 0), (0, 1), (0, -1), (0, 0)))
        return ((x + dx) % self.width, (y + dy) % self.height)

    def _toroidal_delta(self, source: int, target: int, size: int) -> int:
        direct = target - source
        if abs(direct) <= size / 2:
            return int(math.copysign(1, direct)) if direct else 0
        wrapped = -1 if direct > 0 else 1
        return wrapped

    def _move_toward(self, x: int, y: int, target_x: int, target_y: int) -> tuple[int, int]:
        dx = self._toroidal_delta(x, target_x, self.width)
        dy = self._toroidal_delta(y, target_y, self.height)
        if abs(target_x - x) > abs(target_y - y):
            return ((x + dx) % self.width, y)
        return (x, (y + dy) % self.height)

    def _distance_sq(self, x1: int, y1: int, x2: int, y2: int) -> int:
        dx = min(abs(x1 - x2), self.width - abs(x1 - x2))
        dy = min(abs(y1 - y2), self.height - abs(y1 - y2))
        return dx * dx + dy * dy

    def _update_grass(self) -> None:
        for x in range(self.width):
            for y in range(self.height):
                if self.grass_timer[x][y] > 0:
                    self.grass_timer[x][y] -= 1

    def step(self) -> None:
        self._update_grass()

        next_sheep: list[Sheep] = []
        newborn_sheep: list[Sheep] = []
        for sheep in self.sheep:
            sheep.age += 1
            sheep.energy -= self.config.sheep_energy_loss
            sheep.x, sheep.y = self._move_random(sheep.x, sheep.y)

            if self.grass_timer[sheep.x][sheep.y] == 0:
                sheep.energy += self.config.sheep_gain_from_food
                self.grass_timer[sheep.x][sheep.y] = self.config.grass_regrowth_steps

            if sheep.energy <= 0:
                continue

            next_sheep.append(sheep)

            if random.random() * 100 < self.config.sheep_reproduce_rate and sheep.energy >= 6.0:
                sheep.energy *= 0.5
                newborn_sheep.append(self._spawn_sheep(sheep.x, sheep.y, sheep.energy))

        next_sheep.extend(newborn_sheep)

        sheep_by_cell: dict[tuple[int, int], list[Sheep]] = {}
        for sheep in next_sheep:
            sheep_by_cell.setdefault((sheep.x, sheep.y), []).append(sheep)

        next_wolves: list[Wolf] = []
        newborn_wolves: list[Wolf] = []
        for wolf in self.wolves:
            wolf.age += 1
            wolf.energy -= self.config.wolf_energy_loss

            visible_sheep = [
                sheep
                for sheep in next_sheep
                if self._distance_sq(wolf.x, wolf.y, sheep.x, sheep.y)
                <= self.config.wolf_sight_radius * self.config.wolf_sight_radius
            ]
            if visible_sheep:
                target = min(
                    visible_sheep,
                    key=lambda sheep: self._distance_sq(wolf.x, wolf.y, sheep.x, sheep.y),
                )
                wolf.x, wolf.y = self._move_toward(wolf.x, wolf.y, target.x, target.y)
            else:
                wolf.x, wolf.y = self._move_random(wolf.x, wolf.y)

            prey_stack = sheep_by_cell.get((wolf.x, wolf.y), [])
            if prey_stack:
                eaten = prey_stack.pop()
                wolf.energy += self.config.wolf_gain_from_food
                next_sheep = [sheep for sheep in next_sheep if sheep.id != eaten.id]

            if wolf.energy <= 0:
                continue

            next_wolves.append(wolf)

            if random.random() * 100 < self.config.wolf_reproduce_rate and wolf.energy >= 14.0:
                wolf.energy *= 0.5
                newborn_wolves.append(self._spawn_wolf(wolf.x, wolf.y, wolf.energy))

        next_wolves.extend(newborn_wolves)

        self.sheep = next_sheep
        self.wolves = next_wolves
        self.time_step += 1

    def get_grass_layer(self) -> list[dict[str, object]]:
        cells: list[dict[str, object]] = []
        for x in range(self.width):
            for y in range(self.height):
                timer = self.grass_timer[x][y]
                ratio = 1.0 - min(timer / max(self.config.grass_regrowth_steps, 1), 1.0)
                green = int(85 + ratio * 140)
                red = int(45 + ratio * 30)
                blue = int(25 + ratio * 35)
                cells.append(
                    {
                        "id": f"grass:{x}:{y}",
                        "x": x,
                        "y": y,
                        "icon": "square",
                        "size": 1.0,
                        "color": f"#{red:02x}{green:02x}{blue:02x}",
                        "data": {"regrowth_timer": timer},
                    }
                )
        return cells

    def get_sheep_count(self) -> float:
        return float(len(self.sheep))

    def get_wolf_count(self) -> float:
        return float(len(self.wolves))

    def get_available_grass_fraction(self) -> float:
        total = self.width * self.height
        if total == 0:
            return 0.0
        available = sum(1 for row in self.grass_timer for timer in row if timer == 0)
        return available / total