# Tutorial 1: Simple Random Walk

**Difficulty**: Beginner  
**Time**: 15-20 minutes

## Learning Objectives

In this tutorial, you'll learn:

- How to set up a basic TenSnap simulation
- Create and visualize agents on a grid
- Add interactive parameter controls
- Implement simple movement logic
- Use charts to track simulation data

## Prerequisites

- Python 3.10+ installed
- TenSnap installed (see [Installation Guide](../user-guide/installation.md))
- Basic Python knowledge

## What We're Building

A simple simulation where agents perform random walks on a 2D grid. You'll be able to:

- Control the number of agents with a slider
- Adjust movement speed
- Watch agents move in real-time
- Track average agent distance from origin

Protocol note: this tutorial uses `@bind_2d_env()` and `LayeredEnvironmentBinder()` as convenient grid-oriented APIs. Under protocol v0.2 they now emit a canonical `2d` environment with explicit layers rather than a distinct backend `grid` environment type.

## Step 1: Project Setup

Create a new Python file called `random_walk.py`:

```python
# random_walk.py
"""Simple random walk simulation with TenSnap"""

import asyncio
import random
import math
from dataclasses import dataclass
```

## Step 2: Define Configuration

Use a dataclass to hold configurable parameters:

```python
@dataclass
class Config:
    """Simulation configuration"""
    num_agents: int = 20
    step_size: float = 0.5
    world_size: int = 50
```

## Step 3: Define Agent Class

Create an agent class with TenSnap metadata binding:

```python
from tensnap import bind_grid_agent

@bind_grid_agent(color=True, size=True)
class Walker:
    """An agent that performs random walk"""
    
    color = "#3498db"
    size = 8
    
    def __init__(self, walker_id: str, world_size: int):
        self.id = walker_id
        self.world_size = world_size
        # Start in center
        self.x = world_size / 2.0
        self.y = world_size / 2.0
    
    def step(self, step_size: float):
        """Take one random step"""
        # Random angle
        angle = random.uniform(0, 2 * math.pi)
        
        # Move in that direction
        dx = math.cos(angle) * step_size
        dy = math.sin(angle) * step_size
        
        # Update position with wrapping
        self.x = (self.x + dx) % self.world_size
        self.y = (self.y + dy) % self.world_size
    
    def distance_from_center(self) -> float:
        """Calculate distance from world center"""
        center = self.world_size / 2.0
        dx = self.x - center
        dy = self.y - center
        return math.sqrt(dx * dx + dy * dy)
```

The `@bind_grid_agent()` decorator tells TenSnap which properties to sync automatically.

## Step 4: Create Simulation Class

Add environment metadata binding:

```python
from tensnap import bind_2d_env

@bind_2d_env()
class RandomWalkSimulation:
    """Main simulation logic"""
    
    def __init__(self, config: Config):
        self.config = config
        self.walkers: list[Walker] = []
        self.time_step = 0
    
    @property
    def width(self) -> int:
        return self.config.world_size
    
    @property
    def height(self) -> int:
        return self.config.world_size
    
    def initialize(self):
        """Create initial walkers"""
        self.walkers.clear()
        self.time_step = 0
        
        for i in range(self.config.num_agents):
            walker = Walker(f"walker_{i}", self.config.world_size)
            self.walkers.append(walker)
    
    def step(self):
        """Execute one simulation step"""
        for walker in self.walkers:
            walker.step(self.config.step_size)
        self.time_step += 1
    
    def get_average_distance(self) -> float:
        """Calculate average distance from center"""
        if not self.walkers:
            return 0.0
        distances = [w.distance_from_center() for w in self.walkers]
        return sum(distances) / len(distances)
```

The `@bind_2d_env()` decorator enables automatic environment synchronization.

## Step 5: Set Up TenSnap Integration

Import TenSnap components and create the scenario:

```python
from tensnap import SimulationScenario, LayeredEnvironmentBinder, BindParametersConfig, chart, action

# Create simulation and scenario
config = Config()
simulation = RandomWalkSimulation(config)
scenario = SimulationScenario(port=8765, step_interval=0.1)

# Create environment binder
grid = LayeredEnvironmentBinder(
    id="main",
    environment=simulation,
    agent_iterable_projector='walkers'
)
```

## Step 6: Define Interactive Controls and Charts

There are 5 preset actions in the Python binding's simulation handler:

- Start (`start`)
- Stop (`stop`)
- Step (`step`)
- Start/Stop (`start_stop`)
- Reset (`reset`)

These 5 preset actions are also preserved words. They might be triggered by the toolbar's buttons. Since they can fulfill all the purpose of this model, we don't need to add any new actions.

We want to add the following 2 charts to track the average distance and population.

```python

@chart("avg_distance", "Average Distance from Center", color="#e74c3c")
def track_distance() -> float:
    """Track average distance from center"""
    return simulation.get_average_distance()

@chart("population", "Number of Walkers", color="#2ecc71")
def track_population() -> float:
    """Track number of walkers"""
    return len(simulation.walkers)
```

## Step 7: Main Function

```python
async def main():
    """Main entry point"""
    # Initialize simulation
    simulation.initialize()
    
    # Register components with scenario
    scenario.add_environment(grid)
    scenario.add_parameters(config, BindParametersConfig(exclude="world_size"))
    scenario.add_charts(globals())
    scenario.add_actions(globals())
    
    # Register model handlers
    await scenario.register_model_handler(
        simulation.initialize,
        simulation.step
    )
    
    print(f"Random Walk Simulation starting on ws://localhost:8765")
    await scenario.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Step 8: Run Your Simulation

1. **Run Your Simulation** (in another terminal):

   ```bash
   python random_walk.py
   ```

2. **Open Browser**: Navigate to `https://tensnap.netlify.app`

3. In case the online instance is down, you may clone the repository, run `pnpm dev:web` and access `localhost:3200` as well.

## What You Should See

- **Left Panel**: Sliders for "num_agents" and "step_size"
- **Center**: Grid with blue dots (agents) moving randomly
- **Right Panel**: Two charts showing distance and population
- **Bottom**: Play/Pause/Step controls

## Exercises

Try extending the simulation:

### Exercise 1: Add Colors

Modify agents to change color based on distance from center:

```python
def get_color_by_distance(walker: Walker) -> str:
    distance = walker.distance_from_center()
    max_dist = walker.world_size / 2.0
    ratio = min(distance / max_dist, 1.0)
    
    # Interpolate from blue to red
    if ratio < 0.5:
        return "#3498db"  # Blue
    else:
        return "#e74c3c"  # Red

# In init_simulation():
agent = AgentModel(
    # ... other params ...
    color=get_color_by_distance(walker)
)

# In on_step(), update colors:
for agent in grid.agents:
    walker = next(w for w in simulation.walkers if w.id == agent.id)
    agent.color = get_color_by_distance(walker)
```

### Exercise 2: Add Trajectories

Trajectory trails are now a dedicated `trajectory` layer instead of a `@bind_2d_env()` flag. Add a layer with `dependency_layer_ids.agent = "agents"` and a default trail length in its metadata:

```python
{
    "layer_id": "trails",
    "layer_type": "trajectory",
    "data": {
        "dependency_layer_ids": {"agent": "agents"},
        "length": 10,
    },
}
```

### Exercise 3: Track Total Distance

Add cumulative distance tracking:

```python
@bind_grid_agent(color=True, size=True, data=True)
class Walker:
    def __init__(self, walker_id: str, world_size: int):
        # ... existing code ...
        self.total_distance = 0.0
    
    def step(self, step_size: float):
        # ... existing code ...
        self.total_distance += step_size
    
    @property
    def data(self):
        return {"total_distance": self.total_distance}

@chart("total_distance", "Total Distance Traveled", color="#9b59b6")
def track_total_distance() -> float:
    if not simulation.walkers:
        return 0.0
    return sum(w.total_distance for w in simulation.walkers)
```

## Complete Code

The complete code for this tutorial can be adapted from the available examples in [examples/python/](../../examples/python/)

## Next Steps

Congratulations! You've built your first TenSnap simulation. Next, try:

- **[Tutorial 2: Flocking Behavior](./02-flocking.md)** - Learn about agent interactions
- Explore the [User Guide](../user-guide/user-guide.md) for more features
- Check out more examples: [Python examples](../../examples/python/) and [Mesa examples](../../examples/python_mesa/)

## Troubleshooting

### Agents Not Moving

- Ensure `simulation.step()` is being called
- Check that `step_size` is not zero
- Verify handlers are registered: `await scenario.register_model_handler()`

### Web Interface Not Connecting

- Ensure Python simulation is running first
- Check that port 8765 is not blocked
- Verify both terminals are running

### Parameters Not Appearing

- Check that parameters are registered: `scenario.add_parameters(config)`
- Verify `BindParametersConfig(exclude=...)` didn't exclude your parameters
- Ensure the config object has the expected attributes

## Summary

You've learned:

✅ Basic TenSnap project structure  
✅ Decorator-based metadata binding with `@bind_grid_agent` and `@bind_2d_env`  
✅ Using `SimulationScenario` for unified setup  
✅ Automatic parameter binding from dataclass config  
✅ Creating charts and actions with decorators  
✅ Implementing simulation logic separately from visualization  

Continue to the next tutorial to learn about agent interactions!
