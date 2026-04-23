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
- **Environment binders**: `GridEnvironmentBinder`, `GraphEnvironmentBinder`, `GraphEnvironmentBinderNX` - Connect your model objects to TenSnap's canonical wire format
- **Agent accessors / decorators**: `make_grid_agent_accessor()`, `make_graph_agent_accessor_nx()`, `@bind_grid_agent()` - Describe which fields from your objects should be synchronized
- **Parameters**: Configurable values exposed to the UI (sliders, dropdowns, toggles)
- **Charts**: Real-time data visualization
- **Buttons**: Trigger actions in your simulation

## Building Your First Model

### Step 1: Set Up the Scenario

```python
from tensnap import SimulationScenario
import asyncio

# Create scenario instance
scenario = SimulationScenario(port=8765)
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
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

# Bind your model to a canonical 2d environment
grid = GridEnvironmentBinder(
    id="main",
    environment=my_simulation,
    agent_iterable_accessor="agents",
    agent_accessor=make_grid_agent_accessor(
        id="id",
        heading=True,
        color=True,
        icon=True,
    ),
)
scenario.add_environment(grid)

# Register init/step handlers
await scenario.register_model_handler(
    init_func=my_simulation.initialize,
    step_func=my_simulation.step,
)
```

### Step 4: Run the Server

```python
async def main():
    print("Starting TenSnap server on ws://localhost:8765")
    await scenario.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Agents and Environments

### Grid Environments

Grid-oriented simulations are usually connected through `GridEnvironmentBinder` plus an agent accessor or `@bind_grid_agent()` metadata:

```python
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

class Bird:
    def __init__(self):
        self.id = "agent_1"
        self.x = 50.0
        self.y = 50.0
        self.heading = 0.0
        self.color = "#FF5733"
        self.icon = "circle"
        self.size = 10

grid = GridEnvironmentBinder(
    id="world",
    environment=my_model,
    agent_iterable_accessor="birds",
    agent_accessor=make_grid_agent_accessor(
        id="id",
        heading=True,
        color=True,
        icon=True,
        size=True,
    ),
)
```

The synchronized agent payloads are plain dictionaries derived from your Python objects, not mutable `AgentModel` instances.

#### Resource Layers

For protocol v0.2, prefer representing terrain, sugar fields, heatmaps, or per-cell state as a dedicated layer of square agents instead of baking the field into a NumPy background image.

```python
def build_sugar_layer(model):
    cells = []
    for x in range(model.grid.width):
        for y in range(model.grid.height):
            sugar = int(model.sugar[(x, y)])
            cells.append(
                {
                    "id": f"sugar:{x}:{y}",
                    "x": x,
                    "y": y,
                    "icon": "square",
                    "size": 1.0,
                    "color": sugar_to_color(sugar),
                    "data": {"sugar": sugar},
                }
            )
    return {
        "layer_id": "sugar",
        "layer_type": "agent",
        "agents": cells,
    }
```

Legacy local `background` shortcuts can still be convenient for quick experiments, but layered agents are easier to diff, inspect, and compose with other layers.

### Graph Environments

Graph-oriented simulations are typically backed by your own graph structure and exposed with `GraphEnvironmentBinder` or `GraphEnvironmentBinderNX`:

```python
import networkx as nx
from tensnap import GraphEnvironmentBinderNX

graph = nx.Graph()
graph.add_node("node_1", x=0, y=0, color="#3498db")
graph.add_node("node_2", x=100, y=100, color="#e74c3c")
graph.add_edge("node_1", "node_2", weight=1.0, color="#95a5a6")

graph_env = GraphEnvironmentBinderNX(id="network", graph=graph)
```

### Agent Properties

The most common synchronized agent fields are still the same; they just come from your source objects or accessors rather than a mutable `AgentModel` class:

```python
agent_state = {
    "id": "unique_id",
    "x": 25.0,            # X position
    "y": 30.0,            # Y position
    "heading": 1.57,      # Heading in radians (0 = right, π/2 = up)
    "color": "#FF5733",   # Hex color string
    "icon": "arrow",      # Visual representation
    "size": 12,           # Size in pixels
    "label": "Agent 1",   # Optional text label
    "node_id": None       # For graph-oriented layouts
}
```

#### Available Icons

- `circle` - Simple circle
- `square` - Square shape
- `arrow` - Directional arrow (uses heading)
- `triangle` - Triangle
- `diamond` - Diamond shape

### Efficient Agent Updates

Binders re-read your source objects on every sync, so you usually update your own model objects directly instead of mutating a TenSnap-side mirror object:

```python
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

class Bird:
    def __init__(self):
        self.id = "bird_1"
        self.x = 0.0
        self.y = 0.0
        self.heading = 0.0

bird = Bird()

binder = GridEnvironmentBinder(
    id="birds",
    environment={"birds": [bird], "width": 50, "height": 50},
    agent_iterable_accessor="birds",
    environment_accessor={"width": "width", "height": "height"},
    agent_accessor=make_grid_agent_accessor(id="id", heading=True),
)

bird.x = 10.0
bird.y = 5.0

# Binder reads the current object state whenever it serializes.
current_state = binder.get_state()
current_agents = current_state["layers"][0].get("agents", [])
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

### SimulationLoop

For low-level control, `SimulationLoop` registers the default `start` and `step` actions that the renderer can trigger:

```python
from tensnap import SimulationLoop

# Create loop with desired step interval metadata
sim_loop = SimulationLoop(
    on_start=initialize_model,
    on_step=advance_model,
    step_interval=0.05,
)

# Register default start / step actions on the server
sim_loop.register_to(server)

# Access state
current_step = sim_loop.time_step

# Reset local clock when your simulation resets
sim_loop.reset_clock()
```

### Manual Simulation Control

Without `SimulationLoop`, control timing yourself:

```python
async def run_simulation():
    step = 0
    while True:
        await server.start_time_step(step)
        
        # Your simulation logic
        my_model.step()
        
        # Update visualization
        updates = grid.generate_agent_updates()
        await server.update_layer_agents("main", "agents", updates=updates)
        
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
   - Settings (including language preferences)

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

### Language Settings

TenSnap supports multiple languages:

- **English** (default)
- **Chinese** (中文)
- **Japanese** (日本語)

To change the language:

1. Open **Tools → Settings**
2. Select your preferred language from the **Language** dropdown
3. The interface will update immediately

The language preference is saved automatically and will be restored when you return to TenSnap. The system also detects your browser's language on first use.

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
await server.update_layer_agents("main", "agents", updates=updates)
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
from tensnap import GridEnvironmentBinder

# Create multiple binders
habitat = GridEnvironmentBinder(id="habitat", environment=habitat_model)
resource_map = GridEnvironmentBinder(id="resources", environment=resource_model)

# Register both
server.add_environment(habitat)
server.add_environment(resource_map)

# Each binder is serialized independently during sync / updates.
```

## Best Practices

### Performance Optimization

1. **Use Layer-Scoped Batch Updates**: Prefer `update_layer_agents()` over individual updates and always provide the target `layer_id`
2. **Limit Update Frequency**: Use an appropriate `step_interval` in `SimulationLoop` or `SimulationScenario`
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
        await server.update_layer_agents("main", "agents", updates=updates)
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
- **[Python Examples](../../examples/python/)** - Standard Python examples
- **[Mesa Examples](../../examples/python_mesa/)** - Mesa-based examples
- **[Protocol Documentation](../maintainer-guide/protocol.md)** - Understand the WebSocket protocol
