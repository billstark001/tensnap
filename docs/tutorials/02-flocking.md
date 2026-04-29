# Tutorial 2: Flocking Behavior

**Difficulty**: Intermediate  
**Time**: 30-40 minutes

## Learning Objectives

In this tutorial, you'll learn:

- Implementing agent-agent interactions
- Using metadata decorators for complex agent properties
- Adding heading and trajectory visualization
- Working with multi-agent behavioral rules
- Tracking emergent system properties

## Prerequisites

- Python 3.10+ installed
- TenSnap installed
- Completed [Tutorial 1: Random Walk](./01-random-walk.md)

## What We're Building

A flocking simulation implementing three behavioral rules (Reynolds' Boids):

1. **Separation**: Avoid crowding neighbors
2. **Alignment**: Steer toward average heading of neighbors
3. **Cohesion**: Move toward average position of neighbors

You'll observe emergent flocking behavior as individual agents follow simple local rules.

Protocol note: this tutorial keeps the grid-oriented decorator and binder names for readability, but the synchronized protocol state is now canonical `2d` plus layers, not a separate backend `grid` environment type.

## Step 1: Project Setup

Create `flocking.py`:

```python
# flocking.py
"""Flocking simulation with TenSnap"""

import asyncio
import random
import math
from typing import List, Optional
from dataclasses import dataclass
```

## Step 2: Define Configuration

```python
@dataclass
class FlockConfig:
    """Flocking simulation parameters"""
    separation_distance: float = 2.0
    alignment_distance: float = 5.0
    cohesion_distance: float = 8.0
    max_speed: float = 0.8
    num_agents: int = 50
    world_width: float = 40.0
    world_height: float = 40.0
    spawn_radius: float = 10.0
```

These parameters control the three behavioral rules and agent properties.

## Step 3: Define Bird Agent

Create the bird agent with metadata binding:

```python
from tensnap import bind_grid_agent

@bind_grid_agent(size=True, icon=True, color=True, heading=True, data=True)
class Bird:
    """A single bird agent in the flock"""
    
    size = 5
    icon = "arrow"
    color = "#3498DB"
    
    def __init__(self, bird_id: str, x: float, y: float, heading: Optional[float] = None):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = heading if heading is not None else random.uniform(0, 2 * math.pi)
        self.vx = math.cos(self.heading) * random.uniform(0.2, 0.6)
        self.vy = math.sin(self.heading) * random.uniform(0.2, 0.6)
    
    def get_speed(self) -> float:
        """Get current speed"""
        return math.sqrt(self.vx * self.vx + self.vy * self.vy)
    
    def update_position(self, world_width: float, world_height: float):
        """Update position with wrapping"""
        self.x = (self.x + self.vx) % world_width
        self.y = (self.y + self.vy) % world_height
        
        # Update heading based on velocity
        speed = self.get_speed()
        if speed > 0.01:
            self.heading = math.atan2(self.vy, self.vx)
    
    @property
    def data(self):
        """Additional agent data for inspection"""
        return {
            "vx": self.vx,
            "vy": self.vy,
            "speed": self.get_speed(),
        }
```

Key features:

- `heading=True`: Arrow icon points in movement direction
- `data=True`: Expose velocity components for debugging
- `icon="arrow"`: Use directional visualization

## Step 4: Implement Flocking Simulation

Create the simulation environment:

```python
from tensnap import bind_2d_env

@bind_2d_env(coord_offset=True)
class FlockSimulation:
    """Main flocking simulation class"""
    
    coord_offset = "float"  # Use floating-point coordinates
    
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
        """Initialize birds in center area"""
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
```

The `coord_offset="float"` allows sub-pixel positioning for smooth movement.

## Step 5: Implement Flocking Rules

Add the core flocking behavior:

```python
    def update_bird(self, bird: Bird) -> None:
        """Update a single bird using flocking rules"""
        sep_x = sep_y = align_x = align_y = coh_x = coh_y = 0.0
        neighbors = 0
        
        # Check all other birds
        for other in self.birds:
            if other.id == bird.id:
                continue
            
            dx = bird.x - other.x
            dy = bird.y - other.y
            dist = math.sqrt(dx * dx + dy * dy)
            
            if 0 < dist < self.config.cohesion_distance:
                neighbors += 1
                
                # Rule 1: Separation - avoid crowding
                if dist < self.config.separation_distance:
                    sep_x += dx / dist
                    sep_y += dy / dist
                
                # Rule 2: Alignment - match velocity
                if dist < self.config.alignment_distance:
                    align_x += other.vx
                    align_y += other.vy
                
                # Rule 3: Cohesion - move toward center
                coh_x += other.x
                coh_y += other.y
        
        if neighbors > 0:
            # Average forces
            sep_x /= neighbors
            sep_y /= neighbors
            align_x /= neighbors
            align_y /= neighbors
            coh_x = (coh_x / neighbors) - bird.x
            coh_y = (coh_y / neighbors) - bird.y
            
            # Combine forces (separation weighted higher)
            force_x = sep_x * 1.5 + align_x + coh_x
            force_y = sep_y * 1.5 + align_y + coh_y
            
            # Update velocity
            bird.vx += force_x * 0.1
            bird.vy += force_y * 0.1
            
            # Speed limit
            speed = math.sqrt(bird.vx * bird.vx + bird.vy * bird.vy)
            if speed > self.config.max_speed:
                bird.vx = (bird.vx / speed) * self.config.max_speed
                bird.vy = (bird.vy / speed) * self.config.max_speed
    
    def step(self) -> None:
        """Perform one simulation step"""
        # Update all birds
        for bird in self.birds:
            self.update_bird(bird)
        
        # Update positions
        for bird in self.birds:
            bird.update_position(self.config.world_width, self.config.world_height)
        
        self.time_step += 1
```

## Step 6: Add Metrics

Track flock behavior with aggregate metrics:

```python
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
        
        # Average velocity vector
        avg_vx = sum(bird.vx for bird in self.birds) / len(self.birds)
        avg_vy = sum(bird.vy for bird in self.birds) / len(self.birds)
        avg_speed = math.sqrt(avg_vx**2 + avg_vy**2)
        
        # Average individual speed
        individual_avg = self.get_average_speed()
        
        return avg_speed / individual_avg if individual_avg > 0 else 0.0
```

The order parameter measures collective alignment: values near 1 indicate synchronized flocking.

## Step 7: Set Up TenSnap Integration

```python
from tensnap import SimulationScenario, LayeredEnvironmentBinder, BindParametersConfig, chart, action

# Create simulation and scenario
config = FlockConfig()
model = FlockSimulation(config)
scenario = SimulationScenario(port=8765)

# Create environment binder
grid = LayeredEnvironmentBinder(
    id="main",
    environment=model,
    agent_iterable_accessor='birds'
)

# Define charts
@chart("average_speed", "Average Speed", color="#2ECC71")
def calculate_average_speed() -> float:
    return model.get_average_speed()

@chart("order_parameter", "Flock Order Parameter", color="#E74C3C")
def calculate_order_parameter() -> float:
    return model.get_order_parameter()

@action("reset", "Reset Simulation")
async def reset():
    model.initialize()
```

## Step 8: Main Function

```python
async def main() -> None:
    """Run the flock visualization"""
    
    model.initialize()
    
    scenario.add_environment(grid)
    scenario.add_parameters(config, BindParametersConfig(exclude="world_.+"))
    scenario.add_charts(globals())
    scenario.add_actions(globals())
    
    await scenario.register_model_handler(
        model.initialize,
        model.step,
    )
    
    print(f"Flocking Simulation starting on ws://localhost:8765")
    print("Open your browser to http://localhost:3200")
    await scenario.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Step 9: Run Your Simulation

1. **Start the Web Interface** (in one terminal):

   ```bash
   cd tensnap
   pnpm dev:web
   ```

2. **Run Your Simulation** (in another terminal):

   ```bash
   python flocking.py
   ```

3. **Open Browser**: Navigate to `http://localhost:3200`

## What You Should See

- **Left Panel**: Sliders for separation, alignment, cohesion distances and speed
- **Center**: Grid with arrow-shaped birds moving in coordinated patterns
- **Trajectories**: Trails showing recent bird paths
- **Right Panel**: Charts showing average speed and order parameter
- **Bottom**: Play/Pause/Step controls

## Understanding the Behavior

Watch how the flock self-organizes:

1. **Initial Chaos**: Birds start with random headings
2. **Local Interaction**: Birds respond to nearby neighbors
3. **Emergent Flocking**: Coordinated movement patterns emerge
4. **Order Parameter**: Rises toward 1.0 as alignment increases

Try adjusting parameters:

- **Increase separation**: Birds spread out more
- **Decrease cohesion**: Flock breaks into sub-groups
- **Increase max_speed**: Faster, more dynamic movement

## Exercises

### Exercise 1: Add Predator Avoidance

Create a predator that birds flee from:

```python
@bind_grid_agent(size=True, icon=True, color=True)
class Predator:
    size = 10
    icon = "triangle"
    color = "#E74C3C"
    
    def __init__(self, x: float, y: float):
        self.id = "predator"
        self.x = x
        self.y = y

# In FlockSimulation.update_bird():
# Add predator avoidance force
if hasattr(self, 'predator'):
    dx = bird.x - self.predator.x
    dy = bird.y - self.predator.y
    dist = math.sqrt(dx * dx + dy * dy)
    if dist < 10:  # Flee range
        flee_x = (dx / dist) * 2.0
        flee_y = (dy / dist) * 2.0
        bird.vx += flee_x * 0.2
        bird.vy += flee_y * 0.2
```

### Exercise 2: Color by Speed

Visualize bird speed with color:

```python
@bind_grid_agent(size=True, icon=True, color=True, heading=True, data=True)
class Bird:
    # ... existing code ...
    
    @property
    def color(self) -> str:
        """Color based on speed"""
        speed = self.get_speed()
        ratio = min(speed / 1.0, 1.0)
        
        if ratio < 0.5:
            # Blue (slow) to green (medium)
            return f"#00{int(255 * ratio * 2):02x}ff"
        else:
            # Green (medium) to red (fast)
            return f"#{int(255 * (ratio - 0.5) * 2):02x}ff00"
```

### Exercise 3: Boundary Attraction

Add soft boundaries that guide birds back to center:

```python
def update_bird(self, bird: Bird) -> None:
    # ... existing flocking rules ...
    
    # Boundary force - attract toward center
    center_x = self.config.world_width / 2
    center_y = self.config.world_height / 2
    
    dx = center_x - bird.x
    dy = center_y - bird.y
    dist_from_center = math.sqrt(dx * dx + dy * dy)
    
    max_radius = min(self.config.world_width, self.config.world_height) / 2 * 0.8
    if dist_from_center > max_radius:
        pull_strength = (dist_from_center - max_radius) / max_radius
        bird.vx += (dx / dist_from_center) * pull_strength * 0.1
        bird.vy += (dy / dist_from_center) * pull_strength * 0.1
```

## Troubleshooting

### Birds Moving Too Fast

- Reduce `max_speed` in config
- Decrease force multiplication factor (currently 0.1)
- Increase `step_interval` in `SimulationScenario`

### No Flocking Behavior

- Check that distance parameters are appropriate for world size
- Ensure `num_agents` is sufficient (try 50+)
- Verify birds are initialized in overlapping neighborhoods

### Trajectories Not Showing

- Confirm your environment state includes a `trajectory` layer
- Check that `data.dependency_layer_ids.agent` points at the moving `agent` layer
- Set `data.length = 5` on that trajectory layer and keep `coord_offset="float"` on the agent layer for smooth trails

## Summary

You've learned:

✅ Implementing multi-agent interaction rules  
✅ Using `@bind_grid_agent()` with heading metadata  
✅ Configuring environment with `coord_offset` and an explicit trajectory layer  
✅ Measuring emergent system properties  
✅ Creating responsive visualizations of collective behavior  

## Next Steps

- **Tutorial 3: Predator-Prey Dynamics** - Learn about agent lifecycle and multiple agent types
- Explore [examples/sugarscape.py](../../examples/python_mesa/sugarscape.py) for resource competition
- Check out [examples/hk_viz.py](../../examples/python/hk_viz.py) for network-based dynamics

## References

- Reynolds, C. W. (1987). "Flocks, herds and schools: A distributed behavioral model"
- [Complete flock example](../../examples/python/flock_viz.py)
- [User Guide](../user-guide/user-guide.md)
