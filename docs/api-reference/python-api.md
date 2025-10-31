# Python API Reference

Complete reference documentation for the TenSnap Python bindings.

## Table of Contents

1. [Server](#server)
2. [Models](#models)
3. [Simulation Management](#simulation-management)
4. [Bindings](#bindings)
5. [Type Definitions](#type-definitions)

## Server

### TenSnapServer

Main WebSocket server for handling client connections and broadcasting updates.

```python
from tensnap import TenSnapServer

server = TenSnapServer(
    port=8765,
    host="localhost"
)
```

#### Constructor Parameters

- `port` (int, default=8765): WebSocket server port
- `host` (str, default="localhost"): Server host address

#### Methods

##### `add_environment(environment: EnvironmentModel)`

Register an environment with the server.

```python
grid = GridEnvironmentModel(id="main", width=50, height=50)
server.add_environment(grid)
```

##### `add_parameter(parameter: Parameter)`

Register a parameter control.

```python
from tensnap.bindings.basic import parameter

pop = parameter("population", "Population", value=100, min=10, max=500)
server.add_parameter(pop)
```

##### `auto_register_from_globals(globals_dict: dict)`

Automatically register decorated charts and buttons from a module's globals.

```python
# After defining @chart and @button decorated functions
server.auto_register_from_globals(globals())
```

##### `async run()`

Start the WebSocket server and run until interrupted.

```python
await server.run()
```

##### `async start_time_step(step: int)`

Signal the start of a simulation time step.

```python
await server.start_time_step(step)
```

##### `async end_time_step(step: int)`

Signal the end of a simulation time step.

```python
await server.end_time_step(step)
```

##### `async update_agents_batch(env_id: str | int, updates: list)`

Send batch agent updates for an environment.

```python
updates = grid.generate_agent_updates()
await server.update_agents_batch("main", updates)
```

##### `async update_environment(env_id: str | int)`

Force a full environment state update.

```python
await server.update_environment("main")
```

## Models

### AgentModel

Represents an individual agent in the simulation.

```python
from tensnap import AgentModel

agent = AgentModel(
    id="agent_1",
    x=25.0,
    y=30.0,
    heading=0.0,
    color="#FF5733",
    icon="circle",
    size=10,
    label=None,
    node_id=None,
    update_source=None
)
```

#### Constructor Parameters

- `id` (str): Unique identifier for the agent
- `x` (float): X-coordinate position
- `y` (float): Y-coordinate position
- `heading` (float, optional): Direction in radians (0 = right, π/2 = up)
- `color` (str, default="#000000"): Hex color code
- `icon` (str, default="circle"): Visual icon type
- `size` (int, default=10): Size in pixels
- `label` (str, optional): Text label displayed near agent
- `node_id` (str, optional): For graph environments, the node this agent is on
- `update_source` (object, optional): Object to read properties from automatically

#### Properties

All constructor parameters are accessible as properties:

```python
agent.x = 50.0
agent.color = "#00FF00"
current_heading = agent.heading
```

#### Methods

##### `to_dict() -> dict`

Convert agent to dictionary representation.

```python
agent_dict = agent.to_dict()
# {'id': 'agent_1', 'x': 25.0, 'y': 30.0, ...}
```

### GridEnvironmentModel

2D grid-based spatial environment for agents.

```python
from tensnap import GridEnvironmentModel

grid = GridEnvironmentModel(
    id="main",
    width=100,
    height=100
)
```

#### Constructor Parameters

- `id` (str | int): Unique identifier for this environment
- `width` (int): Grid width in cells
- `height` (int): Grid height in cells

#### Properties

- `agents` (list[AgentModel]): List of agents in this environment
- `background` (np.ndarray | None): Background image data

#### Methods

##### `add_agent(agent: AgentModel)`

Add an agent to the environment.

```python
agent = AgentModel(id="a1", x=10, y=20)
grid.add_agent(agent)
```

##### `remove_agent(agent_id: str)`

Remove an agent by ID.

```python
grid.remove_agent("a1")
```

##### `set_background(array: np.ndarray)`

Set background image from NumPy array.

```python
import numpy as np

# Create heatmap
heatmap = np.random.rand(100, 100)
grid.set_background(heatmap)
```

##### `clear_background()`

Remove background image.

```python
grid.clear_background()
```

##### `generate_agent_updates() -> list[dict]`

Generate update dictionaries for all agents with changes.

```python
# Automatically detects changed agents
updates = grid.generate_agent_updates()
await server.update_agents_batch("main", updates)
```

##### `to_dict() -> dict`

Convert environment to dictionary representation.

```python
env_dict = grid.to_dict()
```

### GraphEnvironmentModel

Network/graph-based environment for agents.

```python
from tensnap import GraphEnvironmentModel

graph = GraphEnvironmentModel(id="network")
```

#### Constructor Parameters

- `id` (str | int): Unique identifier for this environment

#### Properties

- `agents` (list[AgentModel]): List of agents
- `nodes` (list[GraphNode]): List of graph nodes
- `edges` (list[GraphEdge]): List of graph edges

#### Methods

##### `add_node(id: str, x: float, y: float, **kwargs)`

Add a node to the graph.

```python
graph.add_node(
    id="node_1",
    x=0,
    y=0,
    color="#3498db",
    size=20,
    label="Node 1"
)
```

**Parameters:**
- `id` (str): Unique node identifier
- `x` (float): X-coordinate for visualization
- `y` (float): Y-coordinate for visualization
- `color` (str, optional): Hex color code
- `size` (int, optional): Node size in pixels
- `label` (str, optional): Node label

##### `remove_node(node_id: str)`

Remove a node and all connected edges.

```python
graph.remove_node("node_1")
```

##### `add_edge(source: str, target: str, **kwargs)`

Add an edge between two nodes.

```python
graph.add_edge(
    source="node_1",
    target="node_2",
    weight=1.0,
    color="#95a5a6",
    directed=True
)
```

**Parameters:**
- `source` (str): Source node ID
- `target` (str): Target node ID
- `weight` (float, optional): Edge weight
- `color` (str, optional): Hex color code
- `directed` (bool, optional): Whether edge is directed

##### `remove_edge(source: str, target: str)`

Remove an edge between two nodes.

```python
graph.remove_edge("node_1", "node_2")
```

##### `add_agent(agent: AgentModel)`

Add an agent to the graph.

```python
agent = AgentModel(id="a1", node_id="node_1")
graph.add_agent(agent)
```

##### `generate_agent_updates() -> list[dict]`

Generate update dictionaries for changed agents.

```python
updates = graph.generate_agent_updates()
await server.update_agents_batch("network", updates)
```

## Simulation Management

### SimulationManager

Manages simulation timing and execution.

```python
from tensnap.simulation import SimulationManager

sim_manager = SimulationManager(
    step_interval=0.05
)
```

#### Constructor Parameters

- `step_interval` (float, default=0.05): Time between simulation steps in seconds

#### Properties

- `time_step` (int): Current simulation time step
- `is_running` (bool): Whether simulation is currently running
- `on_step` (Callable): Async callback function for each step

#### Methods

##### `async start()`

Start the simulation.

```python
await sim_manager.start()
```

##### `async stop()`

Stop the simulation.

```python
await sim_manager.stop()
```

##### `async step()`

Execute a single simulation step.

```python
await sim_manager.step()
```

##### `register_to(server: TenSnapServer)`

Register this manager with a server for automatic control binding.

```python
sim_manager.register_to(server)
```

#### Usage Example

```python
sim_manager = SimulationManager(step_interval=0.05)

async def on_step(step: int):
    await server.start_time_step(step)
    # Your simulation logic
    await server.end_time_step(step)

sim_manager.on_step = on_step
sim_manager.register_to(server)
```

## Bindings

### Parameters

#### `parameter()`

Create a parameter control manually.

```python
from tensnap.bindings.basic import parameter

# Slider parameter
slider_param = parameter(
    id="speed",
    label="Agent Speed",
    value=1.0,
    min=0.1,
    max=5.0,
    step=0.1,
    allow_runtime_change=True
)

# Enum parameter
enum_param = parameter(
    id="mode",
    label="Behavior Mode",
    value="flocking",
    options=["flocking", "random", "seeking"],
    allow_runtime_change=True
)
```

**Parameters:**
- `id` (str): Unique parameter identifier
- `label` (str): Display label in UI
- `value` (Any): Initial/current value
- `min` (float, optional): Minimum value (for numeric parameters)
- `max` (float, optional): Maximum value (for numeric parameters)
- `step` (float, optional): Step size (for numeric parameters)
- `options` (list[str], optional): Available options (for enum parameters)
- `allow_runtime_change` (bool, default=True): Can change during simulation

**Returns:** `Parameter` object

#### `bind_parameter()`

Bind a single object attribute as a parameter.

```python
from tensnap.bindings.basic import bind_parameter

class Config:
    def __init__(self):
        self.population = 100

config = Config()

param = bind_parameter(
    target=config,
    attr_name="population",
    label="Population Size",
    min=10,
    max=1000
)
```

**Parameters:**
- `target` (object): Object containing the attribute
- `attr_name` (str): Name of attribute to bind
- `label` (str): Display label
- `min` (float, optional): Minimum value
- `max` (float, optional): Maximum value
- `step` (float, optional): Step size
- `options` (list, optional): Options for enum parameters
- `allow_runtime_change` (bool, optional): Runtime change permission

**Returns:** `ParameterBinding` object

#### `bind_parameters_batch()`

Bind multiple attributes at once.

```python
from tensnap.bindings.basic import bind_parameters_batch

params = bind_parameters_batch(
    target=config,
    attributes={
        'population': {'label': 'Population', 'min': 10, 'max': 1000},
        'speed': {'label': 'Speed', 'min': 0.1, 'max': 5.0, 'step': 0.1}
    }
)
```

**Parameters:**
- `target` (object): Object containing attributes
- `attributes` (dict): Dictionary mapping attribute names to configuration

**Returns:** List of `ParameterBinding` objects

#### `quick_bind()`

Automatically detect and bind all compatible attributes.

```python
from tensnap.bindings.basic import quick_bind

params = quick_bind(
    target=config,
    exclude=['internal_var'],
    include_private=False
)
```

**Parameters:**
- `target` (object): Object to scan for parameters
- `exclude` (list[str], optional): Attribute names to exclude
- `include_private` (bool, default=False): Include attributes starting with `_`

**Returns:** List of `ParameterBinding` objects

#### `auto_detect_parameters()`

Detect parameters with custom configuration.

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

**Parameters:**
- `target` (object): Object to scan
- `config` (AutoDetectConfig): Detection configuration
- `exclude` (list[str], optional): Attributes to exclude

**Returns:** List of `ParameterBinding` objects

### Charts

#### `@chart` Decorator

Create a chart from a function.

```python
from tensnap.bindings.basic import chart

@chart("population_count", "Population", color="#3498db")
def track_population() -> float:
    """This function is called each time step"""
    return len(simulation.agents)

@chart("average_energy", "Avg Energy", color="#e74c3c")
def track_energy() -> float:
    energies = [a.energy for a in simulation.agents]
    return sum(energies) / len(energies) if energies else 0.0
```

**Parameters:**
- `id` (str): Unique chart identifier
- `label` (str): Display label in UI
- `color` (str, optional): Hex color code for chart line

**Returns:** Decorated function

The decorated function should:
- Take no arguments (or only arguments that can be provided by your code)
- Return a numeric value (int or float)
- Be called each time step to collect data points

### Buttons

#### `@button` Decorator

Create a button that triggers an action.

```python
from tensnap.bindings.basic import button

@button("reset", "Reset Simulation")
async def reset_simulation():
    """Called when user clicks the button"""
    simulation.reset()
    await initialize_visualization()

@button("export_data", "Export Data")
async def export_data():
    """Export simulation data"""
    data = simulation.get_data()
    with open("export.json", "w") as f:
        json.dump(data, f)
```

**Parameters:**
- `id` (str): Unique button identifier
- `label` (str): Button text in UI

**Returns:** Decorated async function

The decorated function should:
- Be async (use `async def`)
- Handle any necessary error cases
- Update visualization state if needed

## Type Definitions

### ParameterBinding

Bidirectional binding between Python object attribute and UI parameter.

```python
class ParameterBinding:
    target: object          # Object containing the attribute
    attr_name: str         # Attribute name
    param: Parameter       # Associated parameter
    
    @property
    def value(self) -> Any:
        """Get current value from target object"""
        
    @value.setter
    def value(self, val: Any):
        """Set value on target object"""
```

### Parameter

Represents a UI parameter control.

```python
class Parameter:
    id: str
    label: str
    value: Any
    min: Optional[float]
    max: Optional[float]
    step: Optional[float]
    options: Optional[List[str]]
    allow_runtime_change: bool
```

### Chart

Represents a data chart.

```python
class Chart:
    id: str
    label: str
    color: Optional[str]
    collect_func: Callable[[], float]  # Function to collect data
```

### AutoDetectConfig

Configuration for automatic parameter detection.

```python
@dataclass
class AutoDetectConfig:
    int_min: int = 0
    int_max: int = 100
    int_step: int = 1
    float_min: float = 0.0
    float_max: float = 10.0
    float_step: float = 0.1
    detect_enums: bool = True
    enum_threshold: int = 10  # Max unique values to treat as enum
```

## Examples

### Complete Basic Example

```python
import asyncio
from dataclasses import dataclass
from tensnap import TenSnapServer, GridEnvironmentModel, AgentModel
from tensnap.simulation import SimulationManager
from tensnap.bindings.basic import quick_bind, chart, button

@dataclass
class Config:
    num_agents: int = 50
    speed: float = 1.0

# Setup
config = Config()
server = TenSnapServer(port=8765)
grid = GridEnvironmentModel(id="main", width=50, height=50)
sim_manager = SimulationManager(step_interval=0.05)

# Bind parameters
params = quick_bind(config)
for param in params:
    server.add_parameter(param)

# Define charts
@chart("count", "Agent Count", color="#3498db")
def count_agents():
    return len(grid.agents)

# Define buttons
@button("reset", "Reset")
async def reset():
    grid.agents.clear()
    # Add new agents
    for i in range(config.num_agents):
        grid.add_agent(AgentModel(
            id=f"agent_{i}",
            x=float(i % 50),
            y=float(i // 50)
        ))

# Simulation step
async def on_step(step: int):
    await server.start_time_step(step)
    # Move agents
    for agent in grid.agents:
        agent.x = (agent.x + config.speed) % 50
    updates = grid.generate_agent_updates()
    await server.update_agents_batch("main", updates)
    await server.end_time_step(step)

# Main
async def main():
    sim_manager.on_step = on_step
    sim_manager.register_to(server)
    server.add_environment(grid)
    server.auto_register_from_globals(globals())
    await reset()
    await server.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## See Also

- **[User Guide](../user-guide/user-guide.md)** - Detailed usage guide
- **[Tutorials](../tutorials/)** - Step-by-step examples
- **[Examples](../../packages/tensnap-python/tensnap/examples/)** - Complete example implementations
