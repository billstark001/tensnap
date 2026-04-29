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

`LayeredEnvironmentBinder`, `LayeredEnvironmentBinder`, `LayeredEnvironmentBinder`, `@bind_2d_env()`, and `@bind_2d_env()` remain convenient local binding APIs. On the wire they now lower to the protocol v0.2 canonical model: environment `type` is always `uniform` or `2d`, while grid and graph semantics are expressed through layers.

```python
import asyncio
from tensnap import (
    SimulationScenario,
    LayeredEnvironmentBinder,
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
grid = LayeredEnvironmentBinder(
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
scenario.add_actions({})

# Run
async def main():
    await scenario.register_model_handler(
        my_model.initialize,
        my_model.step,
    )
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
- `env_binders` (Dict[str, EnvironmentBinderProtocol]): Registered environment binders

#### Methods

##### `add_environment(env: EnvironmentBinderProtocol)`

Register an environment binder with the scenario.

For protocol v0.2, environment binders are transport-side sugar. `LayeredEnvironmentBinder` emits a canonical `2d` environment with a grid layer; graph binders emit a canonical `2d` environment with explicit agent and edge layers.

```python
from tensnap import LayeredEnvironmentBinder, make_grid_agent_accessor

grid = LayeredEnvironmentBinder(
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

`scenario.add_actions({})` also registers the default renderer-driven controls: `start`, `step`, and `reset`. There is no default `stop`; if you need backend-side stop behavior, register an explicit custom action for it.

```python
from tensnap import action

@action("reset", "Reset Simulation")
async def reset_sim():
    model.initialize()
    # Reset logic here

@action("randomize", "Randomize Positions")
def randomize_positions():
    model.randomize_positions()

scenario.add_actions(globals())
```

##### `async register_model_handler(model_init: Callable | None = None, model_step: Callable | None = None)`

Register simulation initialization and step functions that will be called automatically.

```python
def init_simulation():
    model.initialize()
    for agent in model.agents:
        grid.add_agent(agent)

def step_simulation():
    model.step()

scenario.add_actions({})

await scenario.register_model_handler(
    model_init=init_simulation,
    model_step=step_simulation,
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
    ActionMetadata,
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

# Action metadata (button)
reset_action = ActionMetadata(
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

# Explicit backend-side stop remains opt-in rather than a built-in control.
@action("halt", "Halt Backend")
def halt_backend():
    model.stop_requested = True
```

**Parameters:**

- `id` (str, optional): Button identifier (defaults to function name)
- `label` (str, optional): Display label (defaults to formatted function name)
- `continuous` (bool, default=False): Mark the action as renderer-driven continuous work. The built-in `start` action uses `continuous=True`.
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
- `environments` (Dict[str, EnvironmentBinderProtocol]): Registered environments
- `parameters` (Dict[str, Parameter]): Registered parameters
- `charts` (Dict[str, Tuple[ChartGroupMetadata, Callable]]): Registered charts
- `button_handlers` (Dict[str, Callable]): Registered action handlers

#### Methods

##### `add_environment(env: EnvironmentBinderProtocol)`

Register an environment with the server.

```python
from tensnap import LayeredEnvironmentBinder

binder = LayeredEnvironmentBinder(id="main", environment=my_model)
server.add_environment(binder)
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

##### `add_action(action: ActionMetadata, handler: Callable)`

Register an action button with its handler function.

```python
from tensnap.bindings.basic import ActionMetadata

action = ActionMetadata(id="reset", label="Reset")

async def reset_handler():
    model.initialize()

server.add_action(action, reset_handler)
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

##### `async update_layer_metadata(env_id: str | int, layer_id: str, data: dict[str, Any])`

Send a metadata update for one explicit layer.

```python
await server.update_layer_metadata(
    "main",
    "grid",
    {"width": 50, "height": 50},
)
```

##### `async update_layer_agents(env_id: str | int, layer_id: str, *, creates=None, updates=None, deletes=None)`

Send layer-scoped agent creates, updates, and deletes.

```python
await server.update_layer_agents(
    "main",
    "agents",
    creates=[{"id": "agent1", "x": 10.5, "y": 20.3}],
    updates=[{"id": "agent2", "x": 15.1, "y": 18.7, "color": "#ff0000"}],
    deletes=["agent3"],
)
```

##### `async update_layer_edges(env_id: str | int, layer_id: str, *, creates=None, updates=None, deletes=None)`

Send layer-scoped edge creates, updates, and deletes.

```python
await server.update_layer_edges(
    "main",
    "edges",
    creates=[{"source": "a", "target": "b", "color": "#666666"}],
)
```

##### `async replace_layer_state(env_id: str | int, layer_state: EnvironmentLayerState)`

Replace one existing layer by deleting and recreating it.

```python
await server.replace_layer_state(
    "main",
    {
        "layer_id": "patches",
        "layer_type": "agent",
        "agents": [{"id": "patch:0:0", "x": 0, "y": 0, "icon": "square"}],
    },
)
```

##### `async replace_environment_layers(env_id: str | int, env_type: Literal["uniform", "2d"], layers: list[EnvironmentLayerState])`

Recreate an environment snapshot from a new list of layers.

```python
await server.replace_environment_layers(
    "main",
    "2d",
    [{"layer_id": "agents", "layer_type": "agent", "agents": updates}],
)
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

TenSnap's Python package currently exposes low-level model shapes as TypedDicts and accessor outputs. It does **not** expose mutable `AgentModel`, `GridEnvironmentModel`, or `GraphEnvironmentModel` runtime classes.

For most users, `LayeredEnvironmentBinder`, `LayeredEnvironmentBinder`, `LayeredEnvironmentBinder`, and the decorator/accessor helpers are the correct public API.

### Agent State Dictionaries

Agent state is represented as plain dictionaries produced by decorators such as `@bind_grid_agent()` or helpers such as `make_grid_agent_accessor()`.

```python
from tensnap import make_grid_agent_accessor

class Bird:
    def __init__(self):
        self.id = "agent_1"
        self.x = 25.0
        self.y = 30.0
        self.heading = 0.0
        self.color = "#FF5733"
        self.icon = "circle"
        self.size = 10

accessor = make_grid_agent_accessor(
    id="id",
    heading=True,
    color=True,
    icon=True,
    size=True,
)

agent_state = accessor(Bird())
```

#### Common Fields

- `id` (str): Unique identifier for the agent
- `x` (float): X-coordinate position
- `y` (float): Y-coordinate position
- `heading` (float, optional): Direction in radians (0 = right, π/2 = up)
- `color` (str, optional): Hex color code
- `icon` (str, optional): Visual icon type (`circle`, `arrow`, `square`, etc.)
- `size` (int | float, optional): Visual size
- `label` (str, optional): Text label displayed near the agent
- `node_id` (str, optional): For graph-oriented layouts, the node the agent is attached to

#### Exported Types

- `AgentModelDict`
- `GridAgentModelDict`
- `GraphAgentModelDict`
- `UniformAgentModelDict`

```python
from tensnap import GridAgentModelDict

agent_state: GridAgentModelDict = {
    "id": "agent_1",
    "x": 25.0,
    "y": 30.0,
    "heading": 0.0,
}
```

### PureGridEnvironmentModel

Low-level grid environment metadata is represented as a plain dictionary, usually produced by `make_grid_environment_accessor()`.

```python
from tensnap import make_grid_environment_accessor

class GridModel:
    width = 100
    height = 100
    coord_offset = "float"

accessor = make_grid_environment_accessor(
    id="main",
    width="width",
    height="height",
    coord_offset=True,
)

grid_meta = accessor(GridModel())
```

#### Common Fields

- `id` (str | int): Unique identifier for the environment
- `type` (`grid` in the local compatibility view): Local grid-oriented metadata shape
- `width` (int): Grid width in cells
- `height` (int): Grid height in cells
- `coord_offset` (optional): Coordinate offset mode
- `background` (legacy local shortcut): Optional background payload for quick local bindings. For protocol-facing models, prefer dedicated square-agent layers or a custom `get_state()` that emits extra layers.

#### Exported Types

- `PureGridEnvironmentModel`
- `EnvironmentLayerState`
- `EnvironmentState`

```python
from tensnap import PureGridEnvironmentModel

grid_meta: PureGridEnvironmentModel = {
    "id": "main",
    "type": "grid",
    "width": 100,
    "height": 100,
}
```

##### Layered Field Visualization

For heatmaps, terrain, resource fields, or cell-state views, the recommended v0.2 representation is an additional layer of square agents rather than a serialized NumPy image.

```python
def build_resource_layer(width: int, height: int, values: list[list[int]]):
    return {
        "layer_id": "resources",
        "layer_type": "agent",
        "agents": [
            {
                "id": f"resource:{x}:{y}",
                "x": x,
                "y": y,
                "icon": "square",
                "size": 1.0,
                "color": color_for_value(values[x][y]),
                "data": {"value": values[x][y]},
            }
            for x in range(width)
            for y in range(height)
        ],
    }
```

This keeps the wire model inspectable and lets you stack resource, agent, and edge layers without overloading a single background field.

### PureGraphEnvironmentModel

Low-level graph metadata is also represented as a plain dictionary. In practice, you will usually bind your graph with `LayeredEnvironmentBinder` or `LayeredEnvironmentBinder` instead of constructing this shape by hand.

```python
graph_meta = {
    "id": "network",
    "type": "graph",
    "edges": [
        {"source": "node_1", "target": "node_2", "weight": 1.0},
    ],
}
```

#### Common Fields

- `id` (str | int): Unique identifier for the environment
- `type` (`graph` in the local compatibility view): Local graph-oriented metadata shape
- `edges` (list[GraphEdgeDict]): Edge list used by graph binders

#### Exported Types

- `PureGraphEnvironmentModel`
- `GraphEdgeDict`

### Canonical Layered State

At the transport boundary, binders now lower to canonical `EnvironmentState` payloads whose environment `type` is always `uniform` or `2d`, with grid and graph semantics expressed via layers.

```python
from tensnap import EnvironmentState

state: EnvironmentState = {
    "id": "main",
    "type": "2d",
    "layers": [
        {"layer_id": "grid", "layer_type": "grid", "data": {"width": 100, "height": 100}},
        {"layer_id": "agents", "layer_type": "agent", "agents": []},
    ],
}
```

## Environment Binders

All Python environment binders now target the same protocol v0.2 ownership model:

- Environment `type` is `uniform` or `2d`
- Grid metadata lives in a layer, not in a distinct environment type
- Graph connectivity lives in an edge layer, not in the environment payload itself

The grid and graph binder names are retained as convenience wrappers around that canonical representation.

### LayeredEnvironmentBinder

Connects a grid-based simulation model to TenSnap, automatically syncing agent states. On the wire this becomes a canonical `2d` environment with a `grid` layer plus a separate `agent` layer.

Trajectory rendering is no longer configured through `trajectory_length` or `trajectory_color` on the binder or model. If you need trails, emit an explicit `trajectory` layer with `data.dependency_layer_ids = {"agent": "agents"}` and optional default `length`, `width`, and `color` metadata.

```python
from tensnap import LayeredEnvironmentBinder, make_grid_agent_accessor

grid = LayeredEnvironmentBinder(
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
5. **Environment binders**: New `LayeredEnvironmentBinder` for automatic agent syncing
6. **Chart colors**: Now specified in decorator, not just metadata
7. **Type system**: Stronger typing with `NumberParameter`, `EnumParameter`, etc.

## See Also

- [Protocol Documentation](../maintainer-guide/protocol.md) - WebSocket protocol specification
- [Architecture Overview](../maintainer-guide/architecture.md) - System architecture
- [Getting Started Guide](../user-guide/getting-started.md) - User guide
- [Python Examples](../../examples/python/) - Standard Python examples
- [Mesa Examples](../../examples/python_mesa/) - Mesa-based examples
