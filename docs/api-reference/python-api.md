# Python API Reference

Complete reference documentation for the TenSnap Python bindings after the major refactoring.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Scenario API (Recommended)](#scenario-api-recommended)
3. [Bindings & Decorators](#bindings--decorators)
4. [Server API (Low-level)](#server-api-low-level)
5. [Models](#models)
6. [Environment Binders](#environment-binders)
7. [Type Definitions](#type-definitions)

## Quick Start

The recommended way to use TenSnap is through the `SimulationScenario` API, which provides a high-level interface for managing simulations.

```python
import asyncio
from tensnap import (
    SimulationScenario,
    GridEnvironmentBinder,
    make_grid_agent_accessor,
    BindParametersConfig,
    chart,
)
from dataclasses import dataclass

# Define configuration
@dataclass
class Config:
    num_agents: int = 50
    speed: float = 1.0

# Create scenario
config = Config()
scenario = SimulationScenario(port=8765)

# Add environment
grid = GridEnvironmentBinder(
    id="main",
    environment=my_model,
    agent_accessor=make_grid_agent_accessor(heading=True, color=True)
)
scenario.add_environment(grid)

# Add parameters from config object
scenario.add_parameters(config, BindParametersConfig(exclude="private_.+"))

# Add charts using decorators
@chart("population", "Population Count", color="#3498db")
def track_population():
    return len(my_model.agents)

scenario.add_charts(globals())

# Register handlers
scenario.register_model_handler(
    init_func=my_model.initialize,
    step_func=my_model.step
)

# Run
async def main():
    await scenario.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Scenario API (Recommended)

### SimulationScenario

High-level API for managing complete simulations. Combines server, simulation loop, and automatic binding detection. This is the recommended entry point for most users.

```python
from tensnap import SimulationScenario

scenario = SimulationScenario(
    host="localhost",
    port=8765,
    use_msgpack=False,
    step_interval=0.05
)
```

#### Constructor Parameters

- `host` (str, default="localhost"): Server host address
- `port` (int, default=8765): WebSocket server port
- `use_msgpack` (bool, default=False): Use MessagePack serialization instead of JSON for better performance
- `step_interval` (float, default=0.05): Time between simulation steps in seconds

#### Properties

- `server` (TenSnapServer): Access to underlying WebSocket server
- `sim_manager` (SimulationLoop): Access to simulation loop manager
- `env_binders` (Dict[str, EnvironmentModel]): Registered environment binders

#### Methods

##### `add_environment(env: EnvironmentModel)`

Register an environment binder with the scenario.

```python
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

grid = GridEnvironmentBinder(
    id="main",
    environment=my_simulation,
    agent_accessor=make_grid_agent_accessor(heading=True, color=True, icon=True)
)
scenario.add_environment(grid)
```

##### `add_parameters(obj: Any, config: BindParametersConfig = None)`

Automatically detect and bind parameters from an object (dataclass, regular class, or dict).

```python
from tensnap import BindParametersConfig
from dataclasses import dataclass

@dataclass
class Config:
    population: int = 100
    speed: float = 1.0
    _internal: str = "private"  # Will be excluded

config = Config()

# Exclude fields matching pattern
scenario.add_parameters(config, BindParametersConfig(exclude="^_.*"))

# Or include only specific fields
scenario.add_parameters(config, BindParametersConfig(include=["population", "speed"]))
```

##### `add_charts(namespace: dict)`

Automatically register all `@chart` decorated functions from a namespace (typically `globals()`).

```python
from tensnap import chart

@chart("avg_speed", "Average Speed", color="#2ecc71")
def calculate_speed():
    return sum(a.speed for a in agents) / len(agents)

@chart("stats", "Statistics", data_list=[
    ("mean", "#3498db", "Mean"),
    ("median", "#e74c3c", "Median")
])
def calculate_stats():
    return {"mean": calc_mean(), "median": calc_median()}

scenario.add_charts(globals())
```

##### `add_actions(namespace: dict)`

Automatically register all `@action` decorated functions from a namespace.

```python
from tensnap import action

@action("reset", "Reset Simulation")
async def reset_sim():
    model.initialize()
    # Reset logic here

@action("pause", "Pause")
def pause_sim():
    scenario.sim_manager.stop()

scenario.add_actions(globals())
```

##### `register_model_handler(init_func: Callable, step_func: Callable)`

Register simulation initialization and step functions that will be called automatically.

```python
def init_simulation():
    model.initialize()
    for agent in model.agents:
        grid.add_agent(agent)

def step_simulation():
    model.step()

scenario.register_model_handler(
    init_func=init_simulation,
    step_func=step_simulation
)
```

##### `async run()`

Start the WebSocket server and run the simulation indefinitely until interrupted.

```python
import asyncio

async def main():
    await scenario.run()

if __name__ == "__main__":
    asyncio.run(main())
```

## Bindings & Decorators

### Parameter Bindings

TenSnap provides several ways to bind parameters to your simulation.

#### Using the `bind` decorator

```python
from tensnap.bindings.basic import bind
from dataclasses import dataclass

@dataclass
class Config:
    @bind("number", min=10, max=500, step=10)
    population: int = 100
    
    @bind("number", min=0.1, max=5.0, step=0.1)
    speed: float = 1.0
    
    @bind("enum", options=["flocking", "random", "seeking"])
    mode: str = "flocking"
    
    @bind("boolean")
    debug_mode: bool = False
```

#### Using `BindParametersConfig`

Automatically detect parameters from objects:

```python
from tensnap import BindParametersConfig

# Exclude private fields
config = BindParametersConfig(exclude="^_.*")

# Include only specific fields
config = BindParametersConfig(include=["population", "speed"])

# Include private fields
config = BindParametersConfig(include_private=True)

# Use regex patterns
config = BindParametersConfig(
    include="^(num|max|min)_.*",  # Include fields starting with num_, max_, min_
    exclude=".*_internal$"  # Exclude fields ending with _internal
)
```

#### Manual Parameter Creation

```python
from tensnap.bindings.basic import (
    NumberParameter,
    EnumParameter,
    BooleanParameter,
    StringParameter,
    ActionParameter
)

# Number parameter (slider)
speed_param = NumberParameter(
    id="speed",
    label="Agent Speed",
    value=1.0,
    min=0.1,
    max=5.0,
    step=0.1,
    allow_runtime_change=True
)

# Enum parameter (dropdown)
mode_param = EnumParameter(
    id="mode",
    label="Behavior Mode",
    value="flocking",
    options=["flocking", "random", "seeking"],
    labels={"flocking": "Flocking Behavior", "random": "Random Walk"}  # Optional custom labels
)

# Boolean parameter (checkbox)
debug_param = BooleanParameter(
    id="debug",
    label="Debug Mode",
    value=False
)

# Action parameter (button)
reset_param = ActionParameter(
    id="reset",
    label="Reset Simulation"
)
```

### Chart Decorator

The `@chart` decorator creates chart definitions that automatically collect data.

#### Single Chart

```python
from tensnap import chart

@chart("population", "Population Count", color="#3498db")
def track_population():
    return len(model.agents)
```

#### Multi-Series Chart

```python
from tensnap import chart

@chart("statistics", "Population Statistics", data_list=[
    ("mean_speed", "#3498db", "Mean Speed"),
    ("max_speed", "#e74c3c", "Max Speed"),
    ("min_speed", "#2ecc71", "Min Speed")
])
def calculate_stats():
    speeds = [a.speed for a in model.agents]
    return {
        "mean_speed": sum(speeds) / len(speeds),
        "max_speed": max(speeds),
        "min_speed": min(speeds)
    }

# Or return as tuple/list matching data_list order
@chart("xy_data", "XY Data", data_list=[
    ("x_values", "#3498db"),
    ("y_values", "#e74c3c")
])
def calculate_xy():
    return (calc_x(), calc_y())  # Returns tuple
```

**Parameters:**
- `id` (str): Unique chart identifier
- `label` (str): Display label in UI
- `color` (str, optional): Hex color code for single charts
- `data_list` (List[SimplifiedChartMetadata], optional): For multi-series charts. Each item can be:
  - `str`: chart id only
  - `(str, str)`: (id, color)
  - `(str, str, str)`: (id, color, label)
  - `ChartMetadataDict`: Full dictionary

### Action Decorator

The `@action` decorator creates button controls.

```python
from tensnap import action

@action("reset", "Reset Simulation")
async def reset_simulation():
    model.initialize()
    await clear_and_update()

@action("step_once", "Step Once")
def single_step():
    model.step()

# Without explicit ID (uses function name)
@action()
def pause():
    scenario.sim_manager.stop()
```

**Parameters:**
- `id` (str, optional): Button identifier (defaults to function name)
- `label` (str, optional): Display label (defaults to formatted function name)
- `allow_runtime_change` (bool, default=True): Whether button is enabled during runtime

## Server API (Low-level)

### TenSnapServer

Low-level WebSocket server for handling client connections and broadcasting updates. Most users should use `SimulationScenario` instead, but this provides more control.

```python
from tensnap import TenSnapServer

server = TenSnapServer(
    host="localhost",
    port=8765,
    use_msgpack=False
)
```

#### Constructor Parameters

- `host` (str, default="localhost"): Server host address
- `port` (int, default=8765): WebSocket server port
- `use_msgpack` (bool, default=False): Use MessagePack binary serialization

#### Properties

- `clients` (set[WebSocketServerProtocol]): Set of connected clients
- `environments` (Dict[str, EnvironmentModel]): Registered environments
- `parameters` (Dict[str, Parameter]): Registered parameters
- `charts` (Dict[str, Tuple[ChartGroupMetadata, Callable]]): Registered charts
- `button_handlers` (Dict[str, Callable]): Registered action handlers

#### Methods

##### `add_environment(env: EnvironmentModel)`

Register an environment with the server.

```python
from tensnap import GridEnvironmentModel

grid = GridEnvironmentModel(id="main", width=50, height=50)
server.add_environment(grid)
```

##### `add_parameter(param: Parameter, getter: Callable = None, setter: Callable = None)`

Register a parameter control with optional getter/setter functions.

```python
from tensnap.bindings.basic import NumberParameter

param = NumberParameter(
    id="speed",
    label="Agent Speed",
    value=1.0,
    min=0.1,
    max=5.0
)

# With getter/setter for binding to external state
def get_speed():
    return config.speed

def set_speed(value):
    config.speed = value

server.add_parameter(param, getter=get_speed, setter=set_speed)
```

##### `add_chart(getter: Callable, chart: ChartGroupMetadata)`

Register a chart with its data getter function.

```python
from tensnap.bindings.basic import ChartGroupMetadata

chart_meta = ChartGroupMetadata(
    id="pop",
    label="Population",
    color="#3498db"
)

def get_population():
    return len(model.agents)

server.add_chart(get_population, chart_meta)
```

##### `add_action(action_parameter: ActionParameter, handler: Callable, add_parameter: bool = True)`

Register an action button with its handler function.

```python
from tensnap.bindings.basic import ActionParameter

action = ActionParameter(id="reset", label="Reset")

async def reset_handler():
    model.initialize()

server.add_action(action, reset_handler, add_parameter=True)
```

##### `remove_environment(env_id: str | int)`

Remove an environment from the server.

```python
server.remove_environment("main")
```

##### `remove_parameter(param_id: str)`

Remove a parameter.

```python
server.remove_parameter("speed")
```

##### `remove_chart(chart_id: str)`

Remove a chart.

```python
server.remove_chart("population")
```

##### `remove_action(action_id: str, remove_parameter: bool = True)`

Remove an action button.

```python
server.remove_action("reset", remove_parameter=True)
```

##### `async run()`

Start the WebSocket server and run until interrupted.

```python
await server.run()
```

##### `async start_time_step(time: int)`

Signal the start of a simulation time step.

```python
await server.start_time_step(step)
```

##### `async end_time_step(time: int = None)`

Signal the end of a simulation time step.

```python
await server.end_time_step(step)
```

##### `async update_agents_batch(env_id: str | int, updates: list[dict])`

Send batch agent updates for an environment.

```python
updates = [
    {"id": "agent1", "x": 10.5, "y": 20.3},
    {"id": "agent2", "x": 15.1, "y": 18.7, "color": "#ff0000"}
]
await server.update_agents_batch("main", updates)
```

##### `async update_charts(time: int = None)`

Update all registered charts by calling their getter functions.

```python
await server.update_charts(step)
```

##### `async clear_charts(chart_ids: list[str] = None)`

Clear chart data on the client side.

```python
await server.clear_charts()  # Clear all
await server.clear_charts(["chart1", "chart2"])  # Clear specific charts
```

##### `async log_message(level: str, message: str)`

Send a log message to connected clients.

```python
await server.log_message("info", "Simulation started")
await server.log_message("warning", "Low population detected")
await server.log_message("error", "Critical error occurred")
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
    node_id=None
)
```

#### Constructor Parameters

- `id` (str): Unique identifier for the agent
- `x` (float): X-coordinate position
- `y` (float): Y-coordinate position
- `heading` (float, optional): Direction in radians (0 = right, π/2 = up)
- `color` (str, default="#000000"): Hex color code
- `icon` (str, default="circle"): Visual icon type ("circle", "arrow", "square", etc.)
- `size` (int, default=10): Size in pixels
- `label` (str, optional): Text label displayed near agent
- `node_id` (str, optional): For graph environments, the node this agent is on

#### Properties

All constructor parameters are accessible as properties and can be modified:

```python
agent.x = 50.0
agent.color = "#00FF00"
current_heading = agent.heading
```

#### Methods

##### `to_dict() -> dict`

Convert agent to dictionary representation for serialization.

```python
agent_dict = agent.to_dict()
# {'id': 'agent_1', 'x': 25.0, 'y': 30.0, ...}
```

##### `update_from(source: object, mapping: dict = None)`

Update agent properties from another object.

```python
class Bird:
    def __init__(self):
        self.x = 10
        self.y = 20
        self.heading = 1.57

bird = Bird()
agent.update_from(bird)  # Automatically maps matching attributes
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
- `background` (np.ndarray | None): Background image data (NumPy array)

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

Set background image from NumPy array. Useful for heatmaps or terrain visualization.

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

Generate update dictionaries for all agents that have changed since last call.

```python
# Automatically detects changed agents
updates = grid.generate_agent_updates()
await server.update_agents_batch("main", updates)
```

##### `get_model_dict() -> dict`

Get environment metadata as dictionary.

```python
env_dict = grid.get_model_dict()
```

##### `get_agent_list(is_update: bool = False) -> list[dict]`

Get agent data as list of dictionaries.

```python
agents = grid.get_agent_list()
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

Add an agent to the graph. Agent should have `node_id` set.

```python
agent = AgentModel(id="a1", node_id="node_1", x=0, y=0)
graph.add_agent(agent)
```

##### `generate_agent_updates() -> list[dict]`

Generate update dictionaries for changed agents.

```python
updates = graph.generate_agent_updates()
await server.update_agents_batch("network", updates)
```

## Environment Binders

### GridEnvironmentBinder

Connects a grid-based simulation model to TenSnap, automatically syncing agent states.

```python
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

grid = GridEnvironmentBinder(
    id="main",
    environment=simulation_model,
    agent_accessor=make_grid_agent_accessor(
        heading=True,
        color=True,
        icon=True,
        size=False
    )
)
```

#### Constructor Parameters

- `id` (str | int): Environment identifier
- `environment` (Any): Your simulation model object
- `agent_accessor` (Callable): Function that extracts agent data from simulation objects

#### Helper: `make_grid_agent_accessor()`

Creates an accessor function for grid agents.

```python
from tensnap import make_grid_agent_accessor

# Create accessor that reads heading, color, and icon from simulation agents
accessor = make_grid_agent_accessor(
    heading=True,    # Read heading attribute
    color=True,      # Read color attribute
    icon=True,       # Read icon attribute
    size=False,      # Don't read size (use default)
    label=False      # Don't read label
)
```

**Parameters:**
- `heading` (bool, default=False): Whether to read heading attribute
- `color` (bool, default=False): Whether to read color attribute
- `icon` (bool, default=False): Whether to read icon attribute
- `size` (bool, default=False): Whether to read size attribute
- `label` (bool, default=False): Whether to read label attribute

### UniformEnvironmentBinder

Generic environment binder for custom environments.

```python
from tensnap import UniformEnvironmentBinder

env = UniformEnvironmentBinder(
    id="custom",
    environment=my_model,
    agent_accessor=lambda agent: {
        'id': agent.id,
        'x': agent.position[0],
        'y': agent.position[1],
        'color': agent.get_color()
    }
)
```

## Type Definitions

### ParameterState

Type definition for parameter state sent over WebSocket.

```typescript
interface ParameterState {
  id: string;
  type: "number" | "enum" | "action" | "boolean" | "string";
  label: string;
  value: any;
  min?: number;              // For number type
  max?: number;              // For number type
  step?: number;             // For number type
  options?: Array<string>;   // For enum type
  labels?: Dict<string, string>;  // Optional custom labels for enum options
  allowRuntimeChange: boolean;
}
```

### ChartState

Type definition for chart state.

```typescript
interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}

interface ChartGroupMetadata extends ChartMetadata {
  dataList?: Array<ChartMetadata>;  // For multi-series charts
}
```

### AgentUpdate

Type definition for agent updates.

```typescript
interface AgentUpdate {
  id: string;
  x?: number;
  y?: number;
  heading?: number;
  color?: string;
  icon?: string;
  size?: number;
  label?: string;
  node_id?: string;
  [key: string]: any;  // Custom properties
}
```

## Migration from Old API

If you're updating from the pre-refactoring version:

### Old Way (Before Refactoring)

```python
from tensnap import TenSnapServer
from tensnap.bindings.basic import parameter, chart, button

server = TenSnapServer()

# Manual parameter creation
pop_param = parameter("population", "Population", value=100, min=10, max=500)
server.add_parameter(pop_param)

# Manual chart registration
@chart("pop_chart", "Population")
def track_pop():
    return len(agents)
server.auto_register_from_globals(globals())

# Manual button registration
@button("reset", "Reset")
async def reset():
    pass
server.auto_register_from_globals(globals())
```

### New Way (After Refactoring)

```python
from tensnap import SimulationScenario, chart, action, BindParametersConfig
from dataclasses import dataclass

scenario = SimulationScenario()

# Automatic parameter binding from config
@dataclass
class Config:
    population: int = 100

config = Config()
scenario.add_parameters(config)

# Chart decorator remains similar
@chart("pop_chart", "Population", color="#3498db")
def track_pop():
    return len(agents)
scenario.add_charts(globals())

# Button is now called 'action'
@action("reset", "Reset")
async def reset():
    pass
scenario.add_actions(globals())
```

### Key Changes

1. **`button` → `action`**: Button decorator renamed to `action`
2. **`SimulationScenario`**: New high-level API that combines server + simulation loop
3. **Automatic parameter binding**: Use `add_parameters()` with dataclasses or objects
4. **`BindParametersConfig`**: Fine-grained control over parameter auto-detection
5. **Environment binders**: New `GridEnvironmentBinder` for automatic agent syncing
6. **Chart colors**: Now specified in decorator, not just metadata
7. **Type system**: Stronger typing with `NumberParameter`, `EnumParameter`, etc.

## See Also

- [Protocol Documentation](../maintainer-guide/protocol.md) - WebSocket protocol specification
- [Architecture Overview](../maintainer-guide/architecture.md) - System architecture
- [Getting Started Guide](../user-guide/getting-started.md) - User guide
- [Examples](../../packages/tensnap-python/tensnap/examples/) - Complete example simulations
