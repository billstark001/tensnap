# Tutorial 3: Predator-Prey Dynamics

**Difficulty**: Intermediate  
**Time**: 35-45 minutes

This tutorial maps directly to the runnable repository example in `examples/python/predator_prey.py` and `examples/python/predator_prey_viz.py`.

## Learning Objectives

In this tutorial, you will:

- build a simulation with multiple agent layers
- model births, deaths, and predation using plain Python objects
- expose a renewable resource field as its own visual layer
- track population curves with charts registered through `SimulationScenario`

## Prerequisites

- completed [Tutorial 1: Simple Random Walk](./01-random-walk.md)
- ideally completed [Tutorial 2: Flocking Behavior](./02-flocking.md)
- Python 3.10+

## What We Are Building

We will create a toroidal ecosystem with:

- **sheep** that wander, eat grass, and reproduce
- **wolves** that chase sheep, lose energy over time, and reproduce
- **grass** that regrows after being eaten

The finished example has four synchronized layers:

- `grid`
- `grass`
- `sheep`
- `wolves`

It also publishes three charts:

- sheep population
- wolf population
- fraction of grass currently available

The default parameter values are intentionally aligned with the built-in `examples/js` wolf-sheep preset for world size, initial populations, food gain, grass regrowth, and reproduction defaults. The movement and interaction rules in this tutorial remain simpler than the built-in adapter.

## Step 1: Create the Simulation File

Create `predator_prey.py` with the following content:

```python
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
```

### Why this works

- The environment has three explicit agent layers on top of the base grid: `grass`, `sheep`, and `wolves`.
- Birth and death are modeled by inserting and removing objects from `self.sheep` and `self.wolves`.
- The grass field is exposed as a square-agent layer built from dictionaries, so it can be inspected just like any other synchronized layer.
- Sheep and wolf icons use asset references (`asset:<id>`), so the same SVGs can be reused across many synchronized items without inlining image data into every agent payload.

## Step 2: Create the Visualization Entry Point

Create `predator_prey_viz.py` with the following content:

```python
"""TenSnap visualization entrypoint for the predator-prey example."""

from __future__ import annotations

import asyncio
import os
from pathlib import Path

import import_config  # noqa: F401

from tensnap import BindParametersConfig, SimulationScenario, chart

from predator_prey import (
    PredatorPreyConfig,
    PredatorPreySimulation,
    SHEEP_ASSET_ID,
    WOLF_ASSET_ID,
)

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, step_interval=0.15)

config = PredatorPreyConfig()
model = PredatorPreySimulation(config)


def resolve_asset_path(name: str) -> Path:
    local_assets = Path(__file__).resolve().parent / "assets" / name
    repo_assets = Path(__file__).resolve().parents[2] / "assets" / name
    for candidate in (local_assets, repo_assets):
        if candidate.exists():
            return candidate
    raise FileNotFoundError(
        f"Could not find asset '{name}'. Checked {local_assets} and {repo_assets}."
    )


async def publish_animal_assets() -> None:
    await scenario.server.publish_asset(
        SHEEP_ASSET_ID,
        resolve_asset_path("sheep.svg").read_bytes(),
        "image/svg+xml",
        label="Sheep",
    )
    await scenario.server.publish_asset(
        WOLF_ASSET_ID,
        resolve_asset_path("wolf.svg").read_bytes(),
        "image/svg+xml",
        label="Wolf",
    )


@chart("sheep_count", "Sheep", color="#F8FAFC")
def track_sheep() -> float:
    return model.get_sheep_count()


@chart("wolf_count", "Wolves", color="#111827")
def track_wolves() -> float:
    return model.get_wolf_count()


@chart("grass_fraction", "Available Grass", color="#16A34A")
def track_grass() -> float:
    return model.get_available_grass_fraction()


async def main() -> None:
    model.initialize()
    await publish_animal_assets()

    scenario.add_environment(model)
    scenario.add_parameters(config, BindParametersConfig(exclude=["width", "height"]))
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Predator-Prey started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

As in the earlier tutorials, remove `import import_config` if you are copying the file outside the repository after installing `tensnap` from PyPI.

### How the asset flow works

The asset-specific part is this line shape:

```python
await scenario.server.publish_asset(
    "wolf-sheep:sheep",
    Path("sheep.svg").read_bytes(),
    "image/svg+xml",
    label="Sheep",
)
```

and then, on the agent class:

```python
icon = "asset:wolf-sheep:sheep"
```

That is the whole pattern:

1. Load bytes from a file.
2. Publish the asset once with a stable asset id and MIME type.
3. Reference it from agents with `asset:<asset_id>`.

This is better than embedding SVG text into every item payload because the renderer caches assets separately and reuses them across all matching items.

## Step 3: Run the Tutorial

### Option A: Run from this repository

In one terminal:

```bash
pnpm dev:web
```

In another terminal:

```bash
cd examples/python
TENSNAP_USE_SOURCE=1 python predator_prey_viz.py
```

Or from the repository root:

```bash
pnpm dev:py:predator-prey
```

### Option B: Run from a standalone directory

```bash
pip install tensnap
python predator_prey_viz.py
```

Use either the local renderer from `pnpm dev:web` or the hosted app at `https://tensnap.netlify.app`.

If you copy this example outside the repository, keep `sheep.svg` and `wolf.svg` next to the script under an `assets/` folder, or update `resolve_asset_path()` to point at your own asset location.

## What You Should See

- a green-brown grass field layer
- sheep rendered with the shared sheep SVG asset
- wolves rendered with the shared wolf SVG asset
- charts for sheep count, wolf count, and available grass fraction

## How to Read the Result

- if sheep population explodes, the grass fraction will usually drop first
- if wolves overconsume sheep, wolf population later collapses from starvation
- the system often oscillates rather than converging to a fixed point

This is the first tutorial where entity creation and deletion are part of the normal runtime path, so it is a good reference for how the current Python binding surface handles lifecycle-heavy simulations.

## Exercises

### Exercise 1: Make Wolves Faster Hunters

Increase `wolf_sight_radius` and `wolf_gain_from_food`, then compare the resulting oscillation curves.

### Exercise 2: Add a Second Grass Metric

Track the average grass regrowth timer:

```python
@chart("avg_regrowth_timer", "Average Grass Timer", color="#65A30D")
def track_regrowth() -> float:
    total = model.width * model.height
    if total == 0:
        return 0.0
    return sum(sum(row) for row in model.grass_timer) / total
```

### Exercise 3: Split Species into Different Icons or Sizes

Because sheep and wolves already live in separate layers, you can change one species without affecting the other. Try larger wolves or square sheep and observe which choices make the dynamics easier to read.

### Exercise 4: Add a Third Animal Asset

Create a new SVG file, publish it with `scenario.server.publish_asset(...)`, and point a new species or terrain item at `asset:<your_id>`. This is the same pattern you would use for logos, sprites, or icon sets reused across many items.

## References

- `examples/python/predator_prey.py`
- `examples/python/predator_prey_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`
