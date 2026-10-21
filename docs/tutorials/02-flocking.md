# Tutorial 2: Flocking Behavior

**Difficulty**: Intermediate  
**Time**: 30-40 minutes

This tutorial builds the flocking dynamics used in `examples/python/flock.py` and its visualization entry point. The runnable lesson below includes the complete stepping model; the repository version additionally demonstrates monitors and snapshot restoration.

## Learning Objectives

In this tutorial, you will:

- build a multi-agent flocking simulation with the current `tensnap` decorators
- expose heading, size, color, and debug metadata on each bird
- add a trajectory layer that depends on the bird layer
- register charts for emergent flock statistics

## Prerequisites

- completed [Tutorial 1: Simple Random Walk](./01-random-walk.md)
- Python 3.10+
- the matching binding installed as described in [Tutorial 1](./01-random-walk.md#setup)

## What We Are Building

We will implement a Boids-inspired flock with three local rules:

1. **Separation**: avoid crowding neighbors
2. **Alignment**: steer toward the neighborhood's average velocity
3. **Cohesion**: move toward the neighborhood's average displacement on the torus

This is a teaching variant, not a canonical Reynolds implementation. Each rule has its own radius and neighbor count. A tick computes all new velocities from the old state, commits them together, and then moves the birds. Both interactions and movement use toroidal boundaries.

The final example exposes:

- runtime flocking controls and initialization controls for population, spawn radius, and seed
- arrow-shaped birds whose heading follows their velocity
- trajectory trails behind each bird
- one chart with named series for average speed and alignment order parameter

## Step 1: Create the Simulation File

Create `flock.py` with the following content:

```python
"""Synchronous Boids-inspired dynamics on a torus."""

import math
import random
from dataclasses import dataclass
from typing import Any

from tensnap import (
    NumberParameter,
    agent,
    agent_layer,
    env,
    grid_layer,
    params,
    trajectory_layer,
)


@params(
    exclude=r"world_.+",
    custom_bindings={
        "seed": NumberParameter(
            "", min=0, max=2**32 - 1, step=1, allow_runtime_change=False
        ),
        "num_agents": NumberParameter("", step=1, allow_runtime_change=False),
        "spawn_radius": NumberParameter("", allow_runtime_change=False),
    },
)
@dataclass
class FlockConfig:
    """Configuration for flocking simulation"""

    separation_distance: float = 2.0
    alignment_distance: float = 5.0
    cohesion_distance: float = 8.0
    max_speed: float = 0.8
    num_agents: int = 50
    world_width: float = 40.0
    world_height: float = 40.0
    spawn_radius: float = 10.0
    seed: int = 7

    def __post_init__(self):
        """Optional model-side checks for direct Python configuration."""
        for name in ("world_width", "world_height"):
            value = getattr(self, name)
            if not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be finite and positive")
        for name in (
            "separation_distance",
            "alignment_distance",
            "cohesion_distance",
            "max_speed",
            "spawn_radius",
        ):
            value = getattr(self, name)
            if not math.isfinite(value) or value < 0:
                raise ValueError(f"{name} must be finite and nonnegative")
        for name in ("num_agents", "seed"):
            value = getattr(self, name)
            if (
                isinstance(value, bool)
                or not math.isfinite(value)
                or value < 0
                or int(value) != value
            ):
                raise ValueError(f"{name} must be a nonnegative integer")
            setattr(self, name, int(value))


@agent(size=0.5, icon="arrow", color="#3498DB")
class Bird:
    """A single bird agent in the flock"""

    def __init__(self, bird_id: str, x: float, y: float, rng: random.Random):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = rng.uniform(0, 2 * math.pi)
        speed = rng.uniform(0.2, 0.6)
        self.vx = math.cos(self.heading) * speed
        self.vy = math.sin(self.heading) * speed

    def get_speed(self) -> float:
        """Get current speed of the bird"""
        return math.sqrt(self.vx * self.vx + self.vy * self.vy)

    def update_position(self, world_width: float, world_height: float) -> None:
        """Update bird position with boundary wrapping"""
        self.x = (self.x + self.vx) % world_width
        self.y = (self.y + self.vy) % world_height

        # Update heading based on velocity
        speed = self.get_speed()
        if speed > 0.01:
            self.heading = math.atan2(self.vy, self.vx)

    @property
    def data(self) -> dict[str, Any]:
        return {
            "vx": self.vx,
            "vy": self.vy,
            "speed": self.get_speed(),
        }


@trajectory_layer(
    agent_layer_id="birds",
    width=False,
    length=5,
    color="#2563EB",
    on_agent_delete="retain",
    on_state_sync="preserve",
    on_reset="clear",
)
@agent_layer("birds", coord_offset="float")
@grid_layer()
@env()
class FlockSimulation:
    """Main flocking simulation class"""

    def __init__(self, config: FlockConfig | None = None):
        self.config = config or FlockConfig()
        self.rng = random.Random(self.config.seed)
        self.birds: list[Bird] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return int(self.config.world_width)

    @property
    def height(self) -> int:
        return int(self.config.world_height)

    def initialize(self) -> None:
        """Initialize the simulation with birds"""
        self.config.__post_init__()  # Optional: recheck direct Python edits.
        self.birds.clear()
        self.time_step = 0

        self.rng.seed(self.config.seed)
        # Create birds in the center area
        center_x = self.config.world_width / 2
        center_y = self.config.world_height / 2
        spawn_radius = self.config.spawn_radius

        for i in range(self.config.num_agents):
            x = (
                center_x + self.rng.uniform(-spawn_radius, spawn_radius)
            ) % self.config.world_width
            y = (
                center_y + self.rng.uniform(-spawn_radius, spawn_radius)
            ) % self.config.world_height
            bird = Bird(f"bird_{i}", x, y, self.rng)
            self.birds.append(bird)

    def next_velocity(self, bird: Bird) -> tuple[float, float]:
        """Read the old population using minimum-image displacements on the torus."""
        sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
        separation_neighbors = alignment_neighbors = cohesion_neighbors = 0
        width, height = self.config.world_width, self.config.world_height
        for other in self.birds:
            if other.id == bird.id:
                continue
            dx = (other.x - bird.x + width / 2) % width - width / 2
            dy = (other.y - bird.y + height / 2) % height - height / 2
            dist = math.hypot(dx, dy)
            if 0 < dist < self.config.separation_distance:
                separation_neighbors += 1
                sep_x -= dx / dist
                sep_y -= dy / dist
            if 0 < dist < self.config.alignment_distance:
                alignment_neighbors += 1
                align_x += other.vx
                align_y += other.vy
            if 0 < dist < self.config.cohesion_distance:
                cohesion_neighbors += 1
                coh_x += dx
                coh_y += dy
        if separation_neighbors:
            sep_x /= separation_neighbors
            sep_y /= separation_neighbors
        if alignment_neighbors:
            align_x /= alignment_neighbors
            align_y /= alignment_neighbors
        if cohesion_neighbors:
            coh_x /= cohesion_neighbors
            coh_y /= cohesion_neighbors
        vx = bird.vx + (1.5 * sep_x + align_x + coh_x) * 0.1
        vy = bird.vy + (1.5 * sep_y + align_y + coh_y) * 0.1
        speed = math.hypot(vx, vy)
        if speed > self.config.max_speed:
            vx *= self.config.max_speed / speed
            vy *= self.config.max_speed / speed
        return vx, vy

    def step(self) -> None:
        """Compute every velocity before moving any bird (a synchronous tick)."""
        velocities = [self.next_velocity(bird) for bird in self.birds]
        for bird, (vx, vy) in zip(self.birds, velocities):
            bird.vx, bird.vy = vx, vy
            bird.update_position(self.config.world_width, self.config.world_height)
        self.time_step += 1

    def get_average_speed(self) -> float:
        """Calculate average speed of all birds"""
        if not self.birds:
            return 0.0

        speeds = [bird.get_speed() for bird in self.birds]
        return sum(speeds) / len(speeds)

    def get_order_parameter(self) -> float:
        """Measure flock alignment (0=random, 1=aligned)"""
        if not self.birds:
            return 0.0

        # Average velocity
        avg_vx = sum(bird.vx for bird in self.birds) / len(self.birds)
        avg_vy = sum(bird.vy for bird in self.birds) / len(self.birds)
        avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)

        # Average individual speed
        individual_avg = self.get_average_speed()

        return avg_speed / individual_avg if individual_avg > 0 else 0.0
```

### Why this works

- `@agent(size=0.5, icon="arrow", color="#3498DB")` supplies constants for appearance and discovers each bird's `id`, `x`, `y`, `heading`, and `data`.
- `@agent_layer("birds", coord_offset="float")` enables floating-point coordinates for smooth movement.
- `@trajectory_layer(agent_layer_id="birds")` creates a dedicated trajectory layer that depends on the bird layer.
- `length=5` and `color="#2563EB"` on `@trajectory_layer(...)` provide the trail metadata.

### Why the update is synchronous

`next_velocity()` only reads birds. `step()` first stores every result in `velocities`, then assigns velocities and positions. Updating a bird immediately inside the first loop would let later birds see partially updated neighbors and make list order part of the model's dynamics.

The displacement formula maps each coordinate difference into half the world's extent. Thus birds near opposite edges can still be close neighbors. Separation, alignment, and cohesion count their neighbors independently; a small cohesion radius must not accidentally disable the other two rules. Coincident birds are excluded from these distance-based forces.

The model owns its initialization RNG. You may omit `seed`: `FlockConfig()` uses 7, while `FlockConfig(seed=42)` selects another repeatable initial flock. Population, spawn radius, and seed take effect on reset. The distance controls and speed cap affect subsequent steps.

### Optional model-side parameter checks

The hand-written `__post_init__()` checks, including the explicit call in `initialize()`, are optional. TenSnap does not require this method to bind a dataclass or register parameters. Frontend controls normally keep submitted values within the declared `min`/`max` bounds and use the declared `step`. The example retains these checks for configuration created or edited directly in Python and for restored configuration; world dimensions, for example, are not exposed as frontend controls here. If your lesson does not need these extra checks, omit both `__post_init__()` and its call in `initialize()`.

## Step 2: Create the Visualization Entry Point

Create `flock_viz.py` with the following content:

```python
# examples/python/flock_viz.py
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os

# Configure import path (pip-installed vs source)
import import_config  # noqa: F401
from flock import FlockConfig, FlockSimulation
from tensnap import (
    SimulationScenario,
    chart,
)

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

config = FlockConfig()
model = FlockSimulation(config)


# These two model-wide diagnostics share a chart with named series.
@chart(
    "average_speed",
    "Flock Dynamics",
    data_list=[
        ("average_speed", "#2ECC71", "Average Speed"),
        ("order_parameter", "#E74C3C", "Flock Order Parameter"),
    ],
)
def calculate_flock_dynamics() -> dict[str, float]:
    return {
        "average_speed": model.get_average_speed(),
        "order_parameter": model.get_order_parameter(),
    }


# Main function
async def main() -> None:
    """Run the flock visualization"""

    model.initialize()

    scenario.add_all(model)
    scenario.add_all(config)
    scenario.add_all(globals())
    await scenario.register_model_handler(
        model.initialize,
        model.step,
        model.initialize,
    )

    print(f"TenSnap Flock Visualization started on ws://localhost:{server_port}")
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

As in Tutorial 1, remove `import import_config` if you are copying the file outside the repository after installing `tensnap` from PyPI.

### Why this works

- `@params(...)` keeps the world dimensions out of the UI and separates initialization controls from runtime behavior controls.
- `scenario.add_all(globals())` registers the module-level chart with its two named series without turning module constants into parameters.
- `register_model_handler(model.initialize, model.step, model.initialize)` gives the built-in `reset` control a deterministic meaning.

The repository entry point also assigns a model ID and checkpoint schema for its additional restore hooks. Those hooks are separate from this lesson's stepping and plotting code; see `capture_checkpoint()` and `restore_checkpoint()` in `examples/python/flock.py` when adding exact continuation, including the local RNG state.

## Step 3: Run the Tutorial

### Option A: Run from this repository

In one terminal:

```bash
pnpm dev:web
```

In another terminal:

```bash
cd examples/python
TENSNAP_USE_SOURCE=1 python flock_viz.py
```

Or from the repository root:

```bash
pnpm dev:py:flock
```

### Option B: Run from a standalone directory

```bash
python flock_viz.py
```

Use either the local renderer from `pnpm dev:web` or the hosted app at `https://tensnap.netlify.app`.

## What You Should See

- controls for separation, alignment, cohesion, max speed, agent count, spawn radius, and seed
- arrow-shaped birds moving smoothly with continuous headings
- trajectory trails behind the birds
- a chart containing average speed and flock order parameter series

## How to Read the Result

- birds start with random headings; the initial order parameter depends on the sampled population
- local rules can produce organized motion; the outcome depends on parameters and the initial state
- increasing `separation_distance` makes the flock spread out
- decreasing `cohesion_distance` makes it harder for the flock to hold together

The order parameter here is the magnitude of the mean velocity divided by mean speed. It measures velocity alignment, with faster birds contributing more; it is not a claim of consensus or a guarantee that all birds form one spatial cluster. The implementation returns zero when mean speed is zero.

## Exercises

### Exercise 1: Add Predator Avoidance

Add a predator and a repulsion force:

```python
@agent()
class Predator:
    size = 1.0
    icon = "triangle"
    color = "#DC2626"

    def __init__(self, x: float, y: float):
        self.id = "predator"
        self.x = x
        self.y = y
```

Add a `predators` collection to the model and an `@agent_layer("predators")` declaration so it is visible. Then add predator avoidance inside `next_velocity()` using toroidal displacement. Include the extra force in the returned velocity without moving any bird until the commit loop in `step()`.

### Exercise 2: Color Birds by Speed

Remove `color="#3498DB"` from `@agent(...)` and add a property to `Bird`. This uses a fixed speed threshold for the display, so `Bird` does not need access to the model's config:

```python
@property
def color(self) -> str:
    if self.get_speed() < 0.4:
        return "#2563EB"
    return "#F97316"
```

The inferred `color` field now reads the property. A fixed `color` argument on the decorator would override it.

### Exercise 3: Tune the Trail Layer

Change the arguments on `FlockSimulation`'s existing trajectory decorator, keeping its other arguments:

```python
@trajectory_layer(
    agent_layer_id="birds", width=False, length=12, color="#7C3AED",
    on_agent_delete="retain", on_state_sync="preserve", on_reset="clear",
)
```

You can also expose additional trajectory metadata by passing parameters such as `width=` or `z_index=` to `@trajectory_layer(...)`.

### Exercise 4: Test the Update Schedule

With the same initial birds, reverse their list order before a step and compare positions by bird ID. The synchronous rule should give the same result up to floating-point rounding. Then try an immediate per-bird update and inspect how the result changes. Keep that asynchronous variant explicitly named if you retain it as a separate experiment.

## References

- `examples/python/flock.py`
- `examples/python/flock_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`
