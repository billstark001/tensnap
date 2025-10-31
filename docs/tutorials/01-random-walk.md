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

Create a simple agent that performs random walk:

```python
class Walker:
    """An agent that performs random walk"""
    
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

## Step 4: Create Simulation Class

```python
class RandomWalkSimulation:
    """Main simulation logic"""
    
    def __init__(self, config: Config):
        self.config = config
        self.walkers: list[Walker] = []
        self.time_step = 0
    
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

## Step 5: Set Up TenSnap Integration

Import TenSnap components and create the visualization layer:

```python
from tensnap import TenSnapServer, GridEnvironmentModel, AgentModel
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import quick_bind, chart, button

# Create TenSnap components
config = Config()
server = TenSnapServer(port=8765)
grid = GridEnvironmentModel(id="main", width=50, height=50)
simulation = RandomWalkSimulation(config)
sim_manager = SimulationManager(step_interval=0.1)

# Automatically bind configuration parameters
params = quick_bind(target=config, exclude=["world_size"])
```

## Step 6: Define Initialization

```python
async def init_simulation():
    """Initialize simulation and visualization"""
    grid.agents.clear()
    simulation.initialize()
    await sim_manager.stop()
    
    # Create TenSnap agents for each walker
    for walker in simulation.walkers:
        agent = AgentModel(
            id=walker.id,
            x=walker.x,
            y=walker.y,
            color="#3498db",
            icon="circle",
            size=8,
            update_source=walker  # Automatically sync with walker
        )
        grid.add_agent(agent)
    
    # Send initial state
    sim_manager.time_step = 0
    await server.start_time_step(0)
    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)
    await server.end_time_step(0)
```

## Step 7: Define Simulation Step

```python
async def on_step(step: int):
    """Execute one simulation step and update visualization"""
    if not simulation.walkers:
        return
    
    await server.start_time_step(step)
    
    # Run simulation logic
    simulation.step()
    
    # Update visualization
    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)
    
    await server.end_time_step(step)
```

## Step 8: Add Interactive Controls

```python
@button("reset", "Reset Simulation")
async def reset():
    """Reset button handler"""
    await init_simulation()

@chart("avg_distance", "Average Distance from Center", color="#e74c3c")
def track_distance() -> float:
    """Track average distance from center"""
    return simulation.get_average_distance()

@chart("population", "Number of Walkers", color="#2ecc71")
def track_population() -> float:
    """Track number of walkers"""
    return len(simulation.walkers)
```

## Step 9: Main Function

```python
async def main():
    """Main entry point"""
    # Setup simulation step handler
    sim_manager.on_step = on_step
    
    # Initialize
    await init_simulation()
    
    # Register with server
    server.add_environment(grid)
    for param in params:
        server.add_parameter(param)
    server.auto_register_from_globals(globals())
    sim_manager.register_to(server)
    
    print(f"Random Walk Simulation starting on ws://localhost:8765")
    print("Open your browser to http://localhost:5173")
    await server.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Step 10: Run Your Simulation

1. **Start the Web Interface** (in one terminal):
   ```bash
   cd tensnap
   pnpm dev:web
   ```

2. **Run Your Simulation** (in another terminal):
   ```bash
   python random_walk.py
   ```

3. **Open Browser**: Navigate to `http://localhost:5173`

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

### Exercise 2: Bounded Walk

Prevent agents from wrapping around edges:

```python
def step_bounded(self, step_size: float):
    """Step with boundary reflection instead of wrapping"""
    angle = random.uniform(0, 2 * math.pi)
    dx = math.cos(angle) * step_size
    dy = math.sin(angle) * step_size
    
    new_x = self.x + dx
    new_y = self.y + dy
    
    # Reflect at boundaries
    if new_x < 0 or new_x >= self.world_size:
        dx = -dx
    if new_y < 0 or new_y >= self.world_size:
        dy = -dy
    
    self.x = max(0, min(self.world_size - 0.1, self.x + dx))
    self.y = max(0, min(self.world_size - 0.1, self.y + dy))
```

### Exercise 3: Add Trail Visualization

Track where agents have been:

```python
class Walker:
    def __init__(self, walker_id: str, world_size: int):
        # ... existing code ...
        self.trail_length = 0
    
    def step(self, step_size: float):
        # ... existing code ...
        self.trail_length += step_size

@chart("total_distance", "Total Distance Traveled", color="#9b59b6")
def track_total_distance() -> float:
    if not simulation.walkers:
        return 0.0
    return sum(w.trail_length for w in simulation.walkers)
```

## Complete Code

The complete code for this tutorial is available at: [examples/random_walk.py](../../packages/tensnap-python/tensnap/examples/) (if created)

## Next Steps

Congratulations! You've built your first TenSnap simulation. Next, try:

- **[Tutorial 2: Flocking Behavior](./02-flocking.md)** - Learn about agent interactions
- Explore the [User Guide](../user-guide/user-guide.md) for more features
- Check out more [examples](../../packages/tensnap-python/tensnap/examples/)

## Troubleshooting

### Agents Not Moving

- Ensure `simulation.step()` is being called
- Check that `step_size` is not zero
- Verify `on_step` is registered: `sim_manager.on_step = on_step`

### Web Interface Not Connecting

- Ensure Python simulation is running first
- Check that port 8765 is not blocked
- Verify both terminals are running

### Parameters Not Appearing

- Check that parameters are registered: `server.add_parameter(param)`
- Verify `quick_bind()` didn't exclude your parameters
- Make sure `server.auto_register_from_globals(globals())` is called

## Summary

You've learned:

✅ Basic TenSnap project structure  
✅ Creating agents and environments  
✅ Automatic parameter binding with `quick_bind()`  
✅ Implementing simulation logic separately from visualization  
✅ Using charts to track metrics  
✅ Adding interactive buttons  

Continue to the next tutorial to learn about agent interactions!
