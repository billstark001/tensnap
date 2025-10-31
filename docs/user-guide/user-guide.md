# TenSnap User Guide

This comprehensive guide covers all aspects of using TenSnap for agent-based modeling and visualization.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Building Your First Model](#building-your-first-model)
3. [Agents and Environments](#agents-and-environments)
4. [Parameters and Controls](#parameters-and-controls)
5. [Charts and Visualization](#charts-and-visualization)
6. [Simulation Management](#simulation-management)
7. [User Interface](#user-interface)
8. [Advanced Features](#advanced-features)
9. [Best Practices](#best-practices)

## Core Concepts

### Architecture Overview

TenSnap consists of three main components:

1. **Simulation Backend**: Your model logic written in Python (or other languages)
2. **WebSocket Server**: Handles communication between backend and frontend
3. **Web Frontend**: Interactive visualization interface built with React

```
┌─────────────────┐         ┌──────────────┐         ┌─────────────────┐
│   Your Model    │ <──────>│   TenSnap    │ <──────>│   Web UI        │
│   (Python)      │ WebSocket Server       │ WebSocket Browser/Tauri  │
└─────────────────┘         └──────────────┘         └─────────────────┘
```

### Key Components

- **Server**: `TenSnapServer` - Manages WebSocket connections and broadcasts updates
- **Environments**: `GridEnvironmentModel`, `GraphEnvironmentModel` - Spatial contexts for agents
- **Agents**: `AgentModel` - Individual entities in your simulation
- **Parameters**: Configurable values exposed to the UI (sliders, dropdowns, toggles)
- **Charts**: Real-time data visualization
- **Buttons**: Trigger actions in your simulation

## Building Your First Model

### Step 1: Set Up the Server

```python
from tensnap import TenSnapServer, GridEnvironmentModel, AgentModel
import asyncio

# Create server instance
server = TenSnapServer(port=8765)

# Create environment
grid = GridEnvironmentModel(id="main", width=50, height=50)
server.add_environment(grid)
```

### Step 2: Define Your Model Logic

Separate your simulation logic from visualization:

```python
class MySimulation:
    def __init__(self, config):
        self.config = config
        self.agents = []
        self.time = 0
    
    def initialize(self):
        """Set up initial state"""
        self.agents = [
            self.create_agent(i) 
            for i in range(self.config.num_agents)
        ]
    
    def step(self):
        """Execute one time step"""
        for agent in self.agents:
            agent.move()
            agent.interact(self.agents)
        self.time += 1
```

### Step 3: Connect to TenSnap

```python
from tensnap.simulation import SimulationManager

# Create simulation manager
sim_manager = SimulationManager(step_interval=0.05)

# Define step handler
async def on_step(step: int):
    await server.start_time_step(step)
    
    # Run your simulation logic
    my_simulation.step()
    
    # Update visualization
    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)
    
    await server.end_time_step(step)

# Connect
sim_manager.on_step = on_step
sim_manager.register_to(server)
```

### Step 4: Run the Server

```python
async def main():
    print("Starting TenSnap server on ws://localhost:8765")
    await server.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Agents and Environments

### Grid Environments

Grid environments provide a 2D spatial context for agents:

```python
from tensnap import GridEnvironmentModel, AgentModel

# Create grid
grid = GridEnvironmentModel(
    id="world",
    width=100,
    height=100
)

# Add agents to grid
agent = AgentModel(
    id="agent_1",
    x=50.0,
    y=50.0,
    heading=0.0,      # Direction in radians
    color="#FF5733",  # Hex color
    icon="circle",    # Icon type: circle, square, arrow, etc.
    size=10           # Size in pixels
)
grid.add_agent(agent)
```

#### Background Images

Display NumPy arrays as grid backgrounds:

```python
import numpy as np

# Create background data (e.g., heatmap, terrain)
background = np.random.rand(100, 100)
grid.set_background(background)
```

### Graph Environments

Graph environments represent network structures:

```python
from tensnap import GraphEnvironmentModel

# Create graph
graph = GraphEnvironmentModel(id="network")

# Add nodes
graph.add_node(id="node_1", x=0, y=0, color="#3498db")
graph.add_node(id="node_2", x=100, y=100, color="#e74c3c")

# Add edges
graph.add_edge(
    source="node_1",
    target="node_2",
    weight=1.0,
    color="#95a5a6"
)

# Agents can be attached to nodes or edges
agent = AgentModel(id="agent_1", node_id="node_1")
graph.add_agent(agent)
```

### Agent Properties

Agents support various visual properties:

```python
agent = AgentModel(
    id="unique_id",
    x=25.0,            # X position
    y=30.0,            # Y position
    heading=1.57,      # Heading in radians (0 = right, π/2 = up)
    color="#FF5733",   # Hex color string
    icon="arrow",      # Visual representation
    size=12,           # Size in pixels
    label="Agent 1",   # Optional text label
    node_id=None       # For graph environments
)
```

#### Available Icons

- `circle` - Simple circle
- `square` - Square shape
- `arrow` - Directional arrow (uses heading)
- `triangle` - Triangle
- `diamond` - Diamond shape

### Efficient Agent Updates

Use `update_source` for automatic property syncing:

```python
class Bird:
    def __init__(self):
        self.x = 0.0
        self.y = 0.0
        self.heading = 0.0

bird = Bird()

# Agent automatically reads from bird object
agent = AgentModel(
    id="bird_1",
    x=bird.x,
    y=bird.y,
    heading=bird.heading,
    update_source=bird  # Auto-sync properties
)

# Updates happen automatically
grid.generate_agent_updates()  # Reads from bird.x, bird.y, bird.heading
```

## Parameters and Controls

### Manual Parameter Definition

```python
from tensnap.bindings.basic import parameter

# Slider parameter
population = parameter(
    id="population",
    label="Population Size",
    value=100,
    min=10,
    max=500,
    step=10
)
server.add_parameter(population)

# Access value in your code
num_agents = population.value
```

### Enum Parameters

```python
behavior_mode = parameter(
    id="behavior",
    label="Behavior Mode",
    value="flocking",
    options=["flocking", "random_walk", "seeking"]
)
```

### Automatic Parameter Binding

Bind class attributes automatically:

```python
from dataclasses import dataclass
from tensnap.bindings.basic import quick_bind

@dataclass
class Config:
    population: int = 100
    speed: float = 1.0
    vision_range: float = 5.0

config = Config()

# Automatically create parameters for all attributes
params = quick_bind(target=config)

# Register all parameters
for param in params:
    server.add_parameter(param)

# Values update automatically
print(config.population)  # Reflects slider value
```

#### Excluding Attributes

```python
params = quick_bind(
    target=config,
    exclude=["internal_variable", "constant"]
)
```

#### Customizing Ranges

```python
from tensnap.bindings.basic import auto_detect_parameters, AutoDetectConfig

params = auto_detect_parameters(
    target=config,
    config=AutoDetectConfig(
        int_min=0,
        int_max=1000,
        float_min=0.0,
        float_max=10.0,
        float_step=0.1
    )
)
```

### Buttons

Buttons trigger actions in your simulation:

```python
from tensnap.bindings.basic import button

@button("reset", "Reset Simulation")
async def reset_simulation():
    """Called when user clicks Reset button"""
    await initialize_model()
    await server.start_time_step(0)
    # Update visualization
    await server.end_time_step(0)

# Auto-register buttons from module globals
server.auto_register_from_globals(globals())
```

### Runtime Parameter Changes

Control whether parameters can change during simulation:

```python
# Parameter only changeable when simulation is stopped
setup_param = parameter(
    id="world_size",
    value=50,
    allow_runtime_change=False
)

# Parameter can change anytime
behavior_param = parameter(
    id="aggression",
    value=0.5,
    allow_runtime_change=True
)
```

## Charts and Visualization

### Creating Charts

```python
from tensnap.bindings.basic import chart

@chart("population", "Population Over Time", color="#3498db")
def track_population() -> float:
    """Return current population count"""
    return len(simulation.agents)

@chart("average_speed", "Average Speed", color="#e74c3c")
def track_speed() -> float:
    """Return average agent speed"""
    speeds = [agent.get_speed() for agent in simulation.agents]
    return sum(speeds) / len(speeds) if speeds else 0.0

# Auto-register charts
server.auto_register_from_globals(globals())
```

### Chart Data Collection

Charts automatically collect data points each time step. The frontend handles data storage and display.

### Multiple Series

Create multiple charts to display different metrics:

```python
@chart("births", "Birth Rate", color="#2ecc71")
def track_births():
    return simulation.births_this_step

@chart("deaths", "Death Rate", color="#e74c3c")
def track_deaths():
    return simulation.deaths_this_step
```

## Simulation Management

### SimulationManager

Manages simulation timing and execution:

```python
from tensnap.simulation import SimulationManager

# Create manager with desired step interval
sim_manager = SimulationManager(step_interval=0.05)  # 50ms per step

# Define step handler
async def on_step(step: int):
    # Your simulation logic
    pass

sim_manager.on_step = on_step

# Control simulation
await sim_manager.start()  # Begin simulation
await sim_manager.stop()   # Pause simulation
await sim_manager.step()   # Execute single step

# Access state
current_step = sim_manager.time_step
is_running = sim_manager.is_running
```

### Manual Simulation Control

Without SimulationManager, control timing yourself:

```python
async def run_simulation():
    step = 0
    while True:
        await server.start_time_step(step)
        
        # Your simulation logic
        my_model.step()
        
        # Update visualization
        updates = grid.generate_agent_updates()
        await server.update_agents_batch("main", updates)
        
        await server.end_time_step(step)
        step += 1
        await asyncio.sleep(0.05)
```

## User Interface

### Interface Layout

The TenSnap interface consists of:

1. **Top Toolbar**
   - File operations (save, load, export)
   - View controls
   - Settings

2. **Left Panel** - Parameters and Controls
   - Sliders for numeric parameters
   - Dropdowns for enum parameters
   - Buttons for actions

3. **Center Area** - Environment Visualization
   - Interactive grid or graph view
   - Pan and zoom
   - Agent visualization

4. **Right Panel** - Charts
   - Real-time data plots
   - Multiple chart views
   - Export options

5. **Bottom Toolbar** - Simulation Controls
   - Play/Pause button
   - Step button (single step execution)
   - Speed control
   - Time step display

### Customizing Layout

The interface uses a flexible layout system. Users can:

- **Drag views** to reposition
- **Resize views** by dragging edges
- **Minimize/maximize** views
- **Save layouts** for later use

### Exporting Data

#### Export Snapshots

Users can export:
- **Environment images** (PNG, JPEG)
- **Chart data** (CSV, JSON)
- **Simulation state** (JSON)

#### Programmatic Export

```python
# Save environment state
state = grid.to_dict()
with open("state.json", "w") as f:
    json.dump(state, f)
```

## Advanced Features

### Custom Agent Update Logic

For complex agents with many properties:

```python
class ComplexAgent:
    def __init__(self, agent_id):
        self.id = agent_id
        self.x = 0.0
        self.y = 0.0
        self.energy = 100.0
        self.age = 0
    
    def to_update(self):
        """Custom update method"""
        return {
            'id': self.id,
            'x': self.x,
            'y': self.y,
            'color': self.get_color_by_energy(),
            'size': self.get_size_by_age()
        }
    
    def get_color_by_energy(self):
        # Color based on energy level
        if self.energy > 75:
            return "#2ecc71"
        elif self.energy > 25:
            return "#f39c12"
        else:
            return "#e74c3c"
```

### Batch Updates

For performance with many agents:

```python
# Collect all updates
updates = [agent.to_update() for agent in simulation.agents]

# Send in single batch
await server.update_agents_batch("main", updates)
```

### State Synchronization

TenSnap uses differential updates to minimize bandwidth:

```python
# Only changed agents are sent to clients
# The server automatically tracks changes
updates = grid.generate_agent_updates()  # Only returns changed agents
```

### Multiple Environments

Display multiple environments simultaneously:

```python
# Create multiple environments
habitat = GridEnvironmentModel(id="habitat", width=50, height=50)
resource_map = GridEnvironmentModel(id="resources", width=50, height=50)

# Register both
server.add_environment(habitat)
server.add_environment(resource_map)

# Update independently
await server.update_environment("habitat")
await server.update_environment("resources")
```

## Best Practices

### Performance Optimization

1. **Use Batch Updates**: Prefer `update_agents_batch()` over individual updates
2. **Limit Update Frequency**: Use appropriate `step_interval` in SimulationManager
3. **Minimize Data Transfer**: Only send changed agent properties
4. **Use update_source**: Let TenSnap automatically read agent properties

### Code Organization

1. **Separate Concerns**: Keep simulation logic independent of visualization
2. **Use Configuration Objects**: Group related parameters in dataclasses
3. **Modular Design**: Break complex simulations into manageable components

```python
# Good: Separate simulation and visualization
class Simulation:
    """Pure simulation logic"""
    pass

class Visualization:
    """TenSnap integration"""
    def __init__(self, simulation):
        self.simulation = simulation
        self.setup_tensnap()
```

### Error Handling

```python
async def on_step(step: int):
    try:
        await server.start_time_step(step)
        simulation.step()
        updates = grid.generate_agent_updates()
        await server.update_agents_batch("main", updates)
        await server.end_time_step(step)
    except Exception as e:
        logger.error(f"Error in step {step}: {e}")
        await sim_manager.stop()
        raise
```

### Testing

Test your simulation logic independently:

```python
def test_simulation_step():
    sim = MySimulation(config)
    sim.initialize()
    
    initial_count = len(sim.agents)
    sim.step()
    
    assert len(sim.agents) >= 0
    # More assertions...
```

## Next Steps

- **[Tutorials](../tutorials/)** - Follow detailed examples
- **[Python API Reference](../api-reference/python-api.md)** - Complete API documentation
- **[Examples](../../packages/tensnap-python/tensnap/examples/)** - Study example implementations
- **[Protocol Documentation](../maintainer-guide/protocol.md)** - Understand the WebSocket protocol
