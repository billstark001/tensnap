# Tutorial 1: Simple Random Walk

**Difficulty**: Beginner  
**Time**: 15-20 minutes

This tutorial now maps directly to the runnable repository example in `examples/python/random_walk.py` and `examples/python/random_walk_viz.py`.

## Learning Objectives

In this tutorial, you will:

- build a minimal 2D simulation using the current `tensnap` Python API
- describe an environment with `@env`, `@grid_layer`, and `@agent_layer`
- register parameters and charts with `SimulationScenario`
- run the example locally against the TenSnap renderer

## Prerequisites

- Python 3.10+
- TenSnap installed from PyPI, or this repository checked out locally
- If you are running from this repository, Node.js 18+ and `pnpm` for `pnpm dev:web`

## What We Are Building

We will build a simple model where a group of walkers starts at the center of a square world and chooses a random heading on every step.

The finished example exposes:

- two editable parameters: `num_agents` and `step_size`
- a 2D environment view showing the walkers
- two charts: average distance from the center and population size
- built-in renderer-driven controls: `start`, `step`, and `reset`

## Step 1: Create the Model File

Create `random_walk.py` with the following content:

```python
"""Pure random-walk simulation without visualization-specific code."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from tensnap import agent, agent_layer, env, grid_layer


@dataclass
class RandomWalkConfig:
    """Configuration for the random-walk simulation."""

    num_agents: int = 20
    step_size: float = 0.5
    world_size: int = 50


@agent(x=True, y=True, size=True, color=True, data=True)
class Walker:
    """A single walker that moves by choosing a random heading every step."""

    size = 0.8
    color = "#2563EB"

    def __init__(self, walker_id: str, world_size: int):
        self.id = walker_id
        self.world_size = world_size
        self.x = world_size / 2.0
        self.y = world_size / 2.0
        self.total_distance = 0.0

    def step(self, step_size: float) -> None:
        angle = random.uniform(0.0, 2.0 * math.pi)
        dx = math.cos(angle) * step_size
        dy = math.sin(angle) * step_size
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
        }


@grid_layer(width="width", height="height")
@agent_layer("walkers", item_iterable_projector="walkers")
@env()
class RandomWalkSimulation:
    """A simple 2D random-walk simulation."""

    def __init__(self, config: RandomWalkConfig | None = None):
        self.config = config or RandomWalkConfig()
        self.walkers: list[Walker] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return self.config.world_size

    @property
    def height(self) -> int:
        return self.config.world_size

    def initialize(self) -> None:
        self.walkers = [
            Walker(f"walker_{index}", self.config.world_size)
            for index in range(int(self.config.num_agents))
        ]
        self.time_step = 0

    def step(self) -> None:
        for walker in self.walkers:
            walker.step(self.config.step_size)
        self.time_step += 1

    def get_average_distance(self) -> float:
        if not self.walkers:
            return 0.0
        return sum(walker.distance_from_center() for walker in self.walkers) / len(
            self.walkers
        )
```

### Why this works

- `@agent(...)` tells TenSnap which fields of `Walker` should be projected into the synchronized item payload.
- `@grid_layer(...)` contributes grid metadata such as width and height.
- `@agent_layer(...)` tells TenSnap to serialize `self.walkers` as the `walkers` layer.
- `@env()` attaches the environment binding itself.

Together, these decorators let `SimulationScenario.add_environment(model)` build a canonical `2d` environment plus explicit layers under protocol v0.2.

## Step 2: Create the Visualization Entry Point

Create `random_walk_viz.py` with the following content:

```python
"""TenSnap visualization entrypoint for the random-walk example."""

from __future__ import annotations

import asyncio
import os

import import_config  # noqa: F401

from tensnap import BindParametersConfig, SimulationScenario, chart

from random_walk import RandomWalkConfig, RandomWalkSimulation

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port, step_interval=0.1)

config = RandomWalkConfig()
model = RandomWalkSimulation(config)


@chart("avg_distance", "Average Distance From Center", color="#DC2626")
def track_distance() -> float:
    return model.get_average_distance()


@chart("population", "Walker Count", color="#16A34A")
def track_population() -> float:
    return float(len(model.walkers))


async def main() -> None:
    model.initialize()

    scenario.add_environment(model)
    scenario.add_parameters(config, BindParametersConfig(exclude=["world_size"]))
    scenario.add_charts(globals())

    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Random Walk started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

If you are copying this example into a fresh directory after installing `tensnap` from PyPI, remove the `import import_config` line. That helper exists only in the repository examples so they can switch between the installed package and the local source tree.

### Why this works

- `SimulationScenario` is the high-level runtime entry point.
- `add_environment(model)` reads the decorators attached in `random_walk.py`.
- `add_parameters(...)` auto-discovers plain fields from `RandomWalkConfig`.
- `BindParametersConfig(exclude=["world_size"])` keeps the world size fixed while still exposing the other two controls.
- `register_model_handler(init, step, reset)` gives the built-in `reset` action explicit behavior.

## Step 3: Run the Tutorial

### Option A: Run from this repository

In one terminal:

```bash
pnpm dev:web
```

In another terminal:

```bash
cd examples/python
TENSNAP_USE_SOURCE=1 python random_walk_viz.py
```

Or from the repository root:

```bash
pnpm dev:py:random-walk
```

### Option B: Run from a standalone directory

If you copied the files into your own project and installed `tensnap`:

```bash
pip install tensnap
python random_walk_viz.py
```

For the renderer, use either:

- `pnpm dev:web` from this repository
- or the hosted app at `https://tensnap.netlify.app`

## What You Should See

- two sliders on the control panel for `num_agents` and `step_size`
- a square 2D environment showing blue walkers
- a chart for average distance from the center
- a chart for walker count
- toolbar controls for `start`, `step`, and `reset`

## How to Read the Result

- `step` advances the model by one random move per walker.
- `start` keeps dispatching steps using `step_interval=0.1`.
- `reset` recreates the walkers at the center because we registered `model.initialize` as the reset handler.
- the population chart should stay constant unless you change the model to create or remove walkers.

## Exercises

### Exercise 1: Color Walkers by Distance

Replace the fixed `color` class attribute with a property:

```python
@property
def color(self) -> str:
    ratio = min(self.distance_from_center() / (self.world_size / 2.0), 1.0)
    if ratio < 0.5:
        return "#2563EB"
    return "#DC2626"
```

Because the `@agent(...)` decorator already includes `color=True`, the renderer will pick up the new value automatically on subsequent syncs.

### Exercise 2: Add Trajectories

Add a trajectory layer above `@agent_layer(...)`:

```python
from tensnap import trajectory_layer


@trajectory_layer(agent_layer_id="walkers")
@grid_layer(width="width", height="height")
@agent_layer("walkers", item_iterable_projector="walkers")
@env()
class RandomWalkSimulation:
    length = 10
    color = "#7C3AED"
```

This gives every walker a trail without changing the stepping logic.

### Exercise 3: Add a Third Chart

Track the total traveled distance:

```python
@chart("total_distance", "Total Distance", color="#7C3AED")
def track_total_distance() -> float:
    return sum(walker.total_distance for walker in model.walkers)
```

Then register charts exactly as before with `scenario.add_charts(globals())`.

## References

- `examples/python/random_walk.py`
- `examples/python/random_walk_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`
