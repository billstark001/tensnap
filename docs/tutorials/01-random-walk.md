# Tutorial 1: Simple Random Walk

**Difficulty**: Beginner  
**Time**: 15-20 minutes

This tutorial walks through the complete model and visualization entry point in `examples/python/random_walk.py` and `examples/python/random_walk_viz.py`.

## Learning Objectives

In this tutorial, you will:

- build a minimal 2D simulation using the current `tensnap` Python API
- describe an environment with `@env`, `@grid_layer`, and `@agent_layer`
- register parameters and charts with `SimulationScenario`
- run the example locally against the TenSnap renderer

## Prerequisites

- Python 3.10+
- this repository checked out locally, or the examples and binding from the same released tag
- If you are running from this repository, Node.js 24+ and pnpm 12.x for `pnpm dev:web`

## What We Are Building

We will build a simple model where a group of walkers starts at the center of a square world and chooses a random heading on every step. Positions wrap at the boundary. We also retain unwrapped positions so we can measure diffusion without losing displacement each time a walker crosses an edge.

The finished example exposes:

- initialization controls for `num_agents` and `seed`, plus a runtime control for `step_size`
- a 2D environment view showing the walkers
- three charts: displayed distance from the center, population size, and mean squared unwrapped displacement (MSD)
- built-in renderer-driven controls: `start`, `step`, and `reset`

## Setup

For the current development checkout, install its matching Python binding from the repository root:

```bash
python -m pip install -e 'packages/tensnap-python[dev]'
```

Keep this environment active when running the tutorial. If you use documentation from a released tag, use that tag's matching binding instead. A current development example may need APIs newer than the latest package on PyPI.

## Step 1: Create the Model File

Create `random_walk.py` with the following content:

```python
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
```

### Why this works

- `@agent(size=0.8, color="#2563EB")` supplies fixed visual fields and discovers `id`, `x`, `y`, and `data` from each walker.
- `@grid_layer()` discovers grid metadata such as `width` and `height` from the model instance.
- `@agent_layer("walkers")` defaults to serializing `self.walkers` because the layer id and model field have the same name.
- `@env()` attaches the environment binding itself.

Together, these decorators let `SimulationScenario.add_all(model, ...)` build a canonical `2d` environment plus explicit layers under protocol v0.3.

### Randomness and parameter timing

The model owns one `random.Random` instance and passes it to each walker. Creating another model or reading a chart does not advance this model's random stream. `initialize()` reseeds the instance before rebuilding the population, so resetting an unchanged configuration repeats the walk.

Supplying a seed is optional: `RandomWalkConfig()` works as shown and uses this example's default seed, 7. `RandomWalkConfig(seed=42)` selects another repeatable experiment. TenSnap treats `seed` as an ordinary parameter; it does not require a seed or manage RNGs for the model. Omitting the argument here does **not** choose a new random seed on every reset.

`allow_runtime_change=False` makes `num_agents` and `seed` initialization controls. Stop the run, edit them, and reset to start the new experiment. Editing `step_size` can affect the next step of the current trajectory. Excluding `world_size` keeps it out of the control panel.

## Step 2: Create the Visualization Entry Point

Create `random_walk_viz.py` with the following content:

```python
"""TenSnap visualization entrypoint for the random-walk example."""

from __future__ import annotations

import asyncio
import os

import import_config  # noqa: F401
from random_walk import RandomWalkConfig, RandomWalkSimulation
from tensnap import SimulationScenario, chart

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


@chart("msd", "Mean Squared Unwrapped Displacement", color="#7C3AED")
def track_msd() -> float:
    return model.mean_squared_displacement()


async def main() -> None:
    model.initialize()

    scenario.add_all(model)
    scenario.add_all(config)
    scenario.add_all(globals())

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
- `add_all(model)` reads the environment decorators attached in `random_walk.py`.
- `add_all(config)` reads the `@params(...)` declaration from `RandomWalkConfig`.
- `@params(...)` keeps the world size out of the UI and declares when each exposed parameter takes effect.
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

If you copied the files into your own project, use the matching binding installed during Setup:

```bash
python random_walk_viz.py
```

For the renderer, use either:

- `pnpm dev:web` from this repository
- or the hosted app at `https://tensnap.netlify.app`

## What You Should See

- controls for `num_agents`, `step_size`, and `seed`
- a square 2D environment showing blue walkers
- a chart for average distance from the center
- a chart for walker count
- a chart for mean squared unwrapped displacement
- toolbar controls for `start`, `step`, and `reset`

## How to Read the Result

- `step` advances the model by one random move per walker.
- `start` keeps dispatching steps using `step_interval=0.1`.
- `reset` recreates the walkers at the center because we registered `model.initialize` as the reset handler.
- the population chart should stay constant unless you change the model to create or remove walkers.
- the displayed distance uses wrapped coordinates, so it is bounded by the world size. It is not a long-run diffusion statistic.
- with a fixed step size `s`, independent headings give expected MSD `t * s**2` after `t` steps. A finite population fluctuates around that expectation. Changing `step_size` partway through a run changes the corresponding per-step contribution.

## Exercises

### Exercise 1: Color Walkers by Distance

Remove the fixed `color` argument from `@agent(size=0.8, color="#2563EB")`, leaving `@agent(size=0.8)`, then add this property to `Walker`:

```python
@property
def color(self) -> str:
    ratio = min(self.distance_from_center() / (self.world_size / 2.0), 1.0)
    if ratio < 0.5:
        return "#2563EB"
    return "#DC2626"
```

The inferred `color` field now reads the property, so subsequent updates reflect the new value. Keeping the fixed decorator argument would override the property.

### Exercise 2: Add Trajectories

Add a trajectory layer above `@agent_layer(...)`:

```python
from tensnap import trajectory_layer


@trajectory_layer(agent_layer_id="walkers", length=10, color="#7C3AED")
@grid_layer()
@agent_layer("walkers")
@env()
class RandomWalkSimulation:
    # Keep the existing model implementation here.
    ...
```

This gives every walker a trail without changing the stepping logic.

### Exercise 3: Add a Fourth Chart

Track the total traveled distance:

```python
@chart("total_distance", "Total Distance", color="#7C3AED")
def track_total_distance() -> float:
    return sum(walker.total_distance for walker in model.walkers)
```

Then register charts exactly as before with `scenario.add_all(globals())`.

### Exercise 4: Check Reset Reproducibility

Run 20 steps and record several walker positions. Reset and run 20 steps again with the same configuration; the positions should match. Then change the seed and reset. For a diffusion comparison, repeat across several seeds and compare the mean MSD rather than judging a single trajectory.

## References

- `examples/python/random_walk.py`
- `examples/python/random_walk_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`
