# Getting Started with TenSnap

This guide will help you get up and running with TenSnap in just a few minutes.

The current stable Python surface is `SimulationScenario` plus decorators/readback helpers from `tensnap.bindings`. If you want runnable references, prefer `examples/python/`, `examples/python_mesa/`, and `packages/tensnap-python/README.md`. Tutorials 1-4 are backed by runnable examples; tutorials 5-6 are still planned.

## What You'll Need

- **Python 3.10 or higher** (for Python bindings)
- **Node.js 18+ and pnpm 8+** (for web interface development)
- A web browser (Chrome, Firefox, Safari, or Edge)

## Quick Start (Python)

### 1. Install TenSnap

You can install the Python bindings from PyPI:

```bash
pip install tensnap
```

Or install from source if you are developing against this repository:

```bash
git clone https://github.com/billstark001/tensnap.git
cd tensnap
cd packages/tensnap-python
pip install -e .
```

### 2. Run Your First Example

TenSnap comes with several example simulations. Let's run the flocking simulation:

```bash
# From the root directory
pnpm install  # Install JavaScript dependencies
pnpm dev:py:flock  # Run the flock example

# Or run directly from examples directory
cd examples/python
python flock_viz.py
```

This will:

1. Start a WebSocket server on port 8765
2. Expose the renderer at <http://localhost:3200> when `pnpm dev:web` is running
3. Let you connect from the local renderer or the hosted site at <https://tensnap.netlify.app>

### 3. Interact with the Simulation

Once the interface loads, you'll see:

- **Control Panel**: Parameters you can adjust (for example separation, alignment, and cohesion in the flocking demo)
- **Visualization Area**: The active environment view
- **Charts**: Real-time metric plots when the model registers charts
- **Toolbar**: Built-in renderer-driven controls such as `start`, `step`, and `reset`

Try these interactions:

1. **Click Play** to start the simulation
2. **Adjust sliders** to change parameters in real-time
3. **Click Reset** to restart with new parameters
4. **Drag views** to rearrange the interface

## Understanding the Example

The current recommended Python workflow is:

1. Attach environment/layer/item metadata with decorators from `tensnap.bindings`.
2. Register model/config/chart/action bindings with `SimulationScenario.add_all(...)`.
3. Let `SimulationScenario` handle sync and incremental updates.

```python
import asyncio

from tensnap import SimulationScenario
from tensnap.bindings import (
    agent,
    agent_layer,
    chart,
    env,
    grid_layer,
    params,
)


@agent(x="position[0]", y="position[1]")
class Bird:
    def __init__(self, bird_id: int, position: tuple[int, int]):
        self.id = bird_id
        self.position = position


@grid_layer(width="width", height="height")
@agent_layer("birds", item_iterable_projector="birds")
@env(id="main")
class Aviary:
    def __init__(self):
        self.width = 20
        self.height = 10
        self.birds = [Bird(1, (2, 3)), Bird(2, (4, 5))]

    def step(self) -> None:
        for bird in self.birds:
            x, y = bird.position
            bird.position = (x + 1, y)

    @chart("population", "Population")
    def population(self) -> int:
        return len(self.birds)


@params(include=["speed"])
class Config:
    speed = 1.0


scenario = SimulationScenario(port=8765)
model = Aviary()
config = Config()

scenario.add_all(model)
scenario.add_all(config)


async def main() -> None:
    await scenario.register_model_handler(model_step=model.step)
    await scenario.run()


if __name__ == "__main__":
    asyncio.run(main())
```

## What's Next?

- **[Installation Guide](./installation.md)** - Set up TenSnap for development or production
- **[User Guide](./user-guide.md)** - Learn about all features in detail
- **[Tutorials](../tutorials/)** - Runnable tutorials for Random Walk, Flocking, Predator-Prey, and Network Dynamics, with later chapters still planned
- **[Python API Reference](../api-reference/python-api.md)** - Explore the complete API

## Common Issues

### WebSocket Connection Failed

**Problem**: The web interface shows "Disconnected" or connection errors.

**Solution**:

- Ensure the Python simulation is running
- Check that port 8765 is not blocked by a firewall
- Verify the port matches in both server and client

### Port Already in Use

**Problem**: Error message "Address already in use"

**Solution**:

```bash
# Use a different port
TENSNAP_SERVER_PORT=8766 python your_simulation.py
```

### Module Not Found

**Problem**: `ImportError: No module named 'tensnap'`

**Solution**:

```bash
# Install in development mode
cd packages/tensnap-python
pip install -e .
```

## Getting Help

If you encounter issues:

1. Check the [User Guide](./user-guide.md) for detailed explanations
2. Look at example code: [Python examples](../../examples/python/) and [Mesa examples](../../examples/python_mesa/)
3. Open an issue on [GitHub](https://github.com/billstark001/tensnap/issues)
