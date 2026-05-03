# Tutorial 2: Flocking Behavior

**Difficulty**: Intermediate  
**Time**: 30-40 minutes

This tutorial now maps directly to the runnable repository example in `examples/python/flock.py` and `examples/python/flock_viz.py`.

## Learning Objectives

In this tutorial, you will:

- build a multi-agent flocking simulation with the current `tensnap` decorators
- expose heading, size, color, and debug metadata on each bird
- add a trajectory layer that depends on the bird layer
- register charts for emergent flock statistics

## Prerequisites

- completed [Tutorial 1: Simple Random Walk](./01-random-walk.md)
- Python 3.10+
- TenSnap installed, or this repository checked out locally

## What We Are Building

We will implement a standard Boids-style flock with three local rules:

1. **Separation**: avoid crowding neighbors
2. **Alignment**: steer toward the neighborhood's average velocity
3. **Cohesion**: move toward the neighborhood's average position

The final example exposes:

- editable flocking parameters
- arrow-shaped birds whose heading follows their velocity
- trajectory trails behind each bird
- charts for average speed and alignment order parameter

## Step 1: Create the Simulation File

Create `flock.py` with the following content:

```python
"""Pure flocking simulation without any visualization dependencies"""

import random
import math
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from tensnap import (
    agent,
    env,
    agent_layer,
    grid_layer,
    trajectory_layer,
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


@agent(x=True, y=True, size=True, icon=True, color=True, data=True, heading=True)
class Bird:
    """A single bird agent in the flock"""

    size = 0.5
    icon = "arrow"
    color = "#3498DB"

    def __init__(
        self, bird_id: str, x: float, y: float, heading: Optional[float] = None
    ):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = (
            heading if heading is not None else random.uniform(0, 2 * math.pi)
        )
        self.vx = math.cos(self.heading) * random.uniform(0.2, 0.6)
        self.vy = math.sin(self.heading) * random.uniform(0.2, 0.6)

    def get_speed(self) -> float:
        """Get current speed of the bird"""
        return math.sqrt(self.vx * self.vx + self.vy * self.vy)

    def update_position(self, world_width: float, world_height: float) -> None:
        """Update bird position with boundary wrapping"""
        self.x = (self.x + self.vx) % world_width
        self.y = (self.y + self.vy) % world_height

        speed = self.get_speed()
        if speed > 0.01:
            self.heading = math.atan2(self.vy, self.vx)

    @property
    def data(self) -> Dict[str, Any]:
        return {
            "vx": self.vx,
            "vy": self.vy,
            "speed": self.get_speed(),
        }


@trajectory_layer(agent_layer_id="birds", width=False)
@agent_layer("birds", item_iterable_projector="birds", coord_offset=True)
@grid_layer(width="width", height="height")
@env()
class FlockSimulation:
    """Main flocking simulation class"""

    length = 5
    color = "#2563EB"

    coord_offset = "float"

    def __init__(self, config: Optional[FlockConfig] = None):
        self.config = config or FlockConfig()
        self.birds: List[Bird] = []
        self.time_step = 0

    @property
    def width(self) -> int:
        return int(self.config.world_width)

    @property
    def height(self) -> int:
        return int(self.config.world_height)

    def initialize(self) -> None:
        """Initialize the simulation with birds"""
        self.birds.clear()
        self.time_step = 0

        center_x = self.config.world_width / 2
        center_y = self.config.world_height / 2
        spawn_radius = self.config.spawn_radius

        for i in range(int(self.config.num_agents + 0.5)):
            x = center_x + random.uniform(-spawn_radius, spawn_radius)
            y = center_y + random.uniform(-spawn_radius, spawn_radius)
            bird = Bird(f"bird_{i}", x, y)
            self.birds.append(bird)

    def update_bird(self, bird: Bird) -> None:
        """Update a single bird using flocking rules"""
        sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
        neighbors = 0

        for other in self.birds:
            if other.id == bird.id:
                continue

            dx = bird.x - other.x
            dy = bird.y - other.y
            dist = math.sqrt(dx * dx + dy * dy)

            if 0 < dist < self.config.cohesion_distance:
                neighbors += 1

                if dist < self.config.separation_distance:
                    sep_x += dx / dist
                    sep_y += dy / dist

                if dist < self.config.alignment_distance:
                    align_x += other.vx
                    align_y += other.vy

                coh_x += other.x
                coh_y += other.y

        if neighbors > 0:
            sep_x /= neighbors
            sep_y /= neighbors
            align_x /= neighbors
            align_y /= neighbors
            coh_x = (coh_x / neighbors) - bird.x
            coh_y = (coh_y / neighbors) - bird.y

            force_x = sep_x * 1.5 + align_x + coh_x
            force_y = sep_y * 1.5 + align_y + coh_y

            bird.vx += force_x * 0.1
            bird.vy += force_y * 0.1

            speed = math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy)
            if speed > self.config.max_speed:
                bird.vx = (bird.vx / speed) * self.config.max_speed
                bird.vy = (bird.vy / speed) * self.config.max_speed

    def step(self) -> None:
        """Perform one simulation step"""
        for bird in self.birds:
            self.update_bird(bird)

        for bird in self.birds:
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

        avg_vx = sum(bird.vx for bird in self.birds) / len(self.birds)
        avg_vy = sum(bird.vy for bird in self.birds) / len(self.birds)
        avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)

        individual_avg = self.get_average_speed()

        return avg_speed / individual_avg if individual_avg > 0 else 0.0
```

### Why this works

- `@agent(...)` includes `heading=True`, so the arrow icon rotates with the bird's direction.
- `@agent_layer(..., coord_offset=True)` enables floating-point coordinates for smooth movement.
- `@trajectory_layer(agent_layer_id="birds")` creates a dedicated trajectory layer that depends on the bird layer.
- `length = 5` and `color = "#2563EB"` provide default trajectory metadata.

## Step 2: Create the Visualization Entry Point

Create `flock_viz.py` with the following content:

```python
"""TenSnap visualization for the flocking simulation"""

import asyncio
import os

import import_config  # noqa: F401

from tensnap import (
    chart,
    SimulationScenario,
    BindParametersConfig,
)

from flock import FlockSimulation, FlockConfig

server_port = int(os.environ.get("TENSNAP_SERVER_PORT", "8765"))
scenario = SimulationScenario(port=server_port)

config = FlockConfig()
model = FlockSimulation(config)


@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    return model.get_average_speed()


@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def calculate_order_parameter() -> float:
    return model.get_order_parameter()


async def main() -> None:
    """Run the flock visualization"""

    model.initialize()

    scenario.add_environment(model)
    scenario.add_parameters(config, BindParametersConfig(exclude="world_.+"))
    scenario.add_charts(globals())

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

- `BindParametersConfig(exclude="world_.+")` keeps the world dimensions fixed while exposing the flock behavior controls.
- `scenario.add_charts(globals())` registers the two module-level chart functions.
- `register_model_handler(model.initialize, model.step, model.initialize)` gives the built-in `reset` control a deterministic meaning.

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
pip install tensnap
python flock_viz.py
```

Use either the local renderer from `pnpm dev:web` or the hosted app at `https://tensnap.netlify.app`.

## What You Should See

- sliders for separation, alignment, cohesion, max speed, agent count, and spawn radius
- arrow-shaped birds moving smoothly with continuous headings
- trajectory trails behind the birds
- a chart for average speed
- a chart for flock order parameter

## How to Read the Result

- at the beginning, birds start with random headings and the order parameter is low
- as local rules take effect, the birds organize and the order parameter rises
- increasing `separation_distance` makes the flock spread out
- decreasing `cohesion_distance` makes it harder for the flock to hold together

## Exercises

### Exercise 1: Add Predator Avoidance

Add a predator and a repulsion force:

```python
@agent(x=True, y=True, size=True, icon=True, color=True)
class Predator:
    size = 1.0
    icon = "triangle"
    color = "#DC2626"

    def __init__(self, x: float, y: float):
        self.id = "predator"
        self.x = x
        self.y = y
```

Then add predator avoidance inside `update_bird` by applying an extra force when a bird gets too close.

### Exercise 2: Color Birds by Speed

Replace the fixed `color` attribute with a property:

```python
@property
def color(self) -> str:
    ratio = min(self.get_speed() / self.config.max_speed, 1.0)
    if ratio < 0.5:
        return "#2563EB"
    return "#F97316"
```

If you do this, the renderer will automatically reflect the new per-bird color because `color=True` is already included in the `@agent(...)` binding.

### Exercise 3: Tune the Trail Layer

Change the trajectory defaults on `FlockSimulation`:

```python
length = 12
color = "#7C3AED"
```

You can also expose additional trajectory metadata by passing parameters such as `width=` or `z_index=` to `@trajectory_layer(...)`.

## References

- `examples/python/flock.py`
- `examples/python/flock_viz.py`
- `packages/tensnap-python/README.md`
- `docs/api-reference/python-api.md`