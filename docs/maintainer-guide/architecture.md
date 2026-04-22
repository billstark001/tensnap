# TenSnap Architecture

Architecture overview for maintainers and contributors.

## System Overview

TenSnap separates simulation logic, communication, and visualization:

```text
┌──────────────┐    WebSocket    ┌──────────────┐
│  Python      │◄───────────────►│  React       │
│  Backend     │   MessagePack   │  Frontend    │
│              │                 │              │
│ • Scenario   │                 │ • Zustand    │
│ • Server     │                 │ • Leafer UI  │
│ • SimLoop    │                 │ • Recharts   │
└──────────────┘                 └──────────────┘
```

**Design Principles**:

- **Language Agnostic**: Protocol supports any backend language
- **Decoupled**: Clear separation of concerns
- **Real-time**: Optimized for fast updates with many agents
- **Flexible APIs**: High-level decorators to low-level protocol access

Protocol v0.2 note: Python-side `GridEnvironmentBinder` and `GraphEnvironmentBinder*` are now compatibility-oriented shortcut APIs. The canonical synchronized state is always `uniform` or `2d` plus explicit layers; graph edges are no longer treated as environment-level payload.

## API Levels

### High-Level (Decorator-Based Binding)

Metadata binding with class decorators for automatic synchronization:

```python
from tensnap import SimulationScenario, bind_grid_agent, bind_grid_environment, chart

# Define agent with metadata binding
@bind_grid_agent(heading=True, color=True, size=True)
class Bird:
    def __init__(self, bird_id, x, y):
        self.id = bird_id
        self.x = x
        self.y = y
        self.heading = 0
        self.color = "#3498db"
        self.size = 5

# Define environment with metadata binding
@bind_grid_environment(coord_offset=True, trajectory_length=True)
class FlockSimulation:
    coord_offset = "float"
    trajectory_length = 5
    
    def __init__(self):
        self.birds = []
    
    @property
    def width(self): return 50
    
    @property
    def height(self): return 50

# Unified scenario interface
scenario = SimulationScenario(port=8765)
scenario.add_environment(GridEnvironmentBinder(id="main", environment=model, agent_iterable_accessor='birds'))
scenario.add_parameters(config)  # Auto-detect from dataclass
scenario.add_charts(globals())   # Auto-detect @chart decorators
```

### Mid-Level (Binder Classes)

Explicit environment configuration with accessor functions:

```python
from tensnap import GridEnvironmentBinder, make_grid_agent_accessor

binder = GridEnvironmentBinder(
    id="main",
    environment=model,
    agent_accessor=make_grid_agent_accessor(heading=True, color=True)
)
scenario.add_environment(binder)
```

### Low-Level (Direct API)

Server and loop management:

```python
from tensnap import TenSnapServer, SimulationLoop

server = TenSnapServer(port=8765)
loop = SimulationLoop(step_interval=0.1)
server.add_environment(environment)
server.add_parameter(param, getter=lambda: model.speed, setter=lambda v: setattr(model, 'speed', v))
```

### Protocol-Level (Advanced)

Direct message control:

```python
await server.update_agents_batch("main", updates)
await server.update_charts(time_step)
```

## Python Backend

### Core Components

**`scenario.py`** - Unified high-level API orchestrating server, simulation loop, handlers, and environment binders.

Key class: `SimulationScenario` - Main entry point providing:

- Simplified setup with `add_environment()`, `add_parameters()`, `add_charts()`, `add_actions()`
- Handler registration via `register_handler()` or `register_model_handler()`
- Automatic state synchronization through handlers

**`server.py`** - WebSocket server managing connections and broadcasting updates.

Features:

- Batched message queue for efficiency
- MessagePack/JSON serialization
- Async I/O with non-blocking operations
- State sync by replaying canonical env/layer/entity messages against the renderer's state summary

**`sim_loop.py`** - Simulation execution manager with operation queue.

Actions: `start()`, `stop()`, `toggle()`, `step_once()`

Uses queue to serialize control commands and prevent race conditions.

### Binding System

**Decorator-Based Metadata Binding**: Class decorators for automatic agent/environment property synchronization.

Agent decorators:

- `@bind_grid_agent()` - 2D grid agents with position, heading, color, size, trajectory
- `@bind_graph_agent_nx()` - NetworkX graph nodes
- `@bind_uniform_agent()` - Basic agent properties

Environment decorators:

- `@bind_grid_environment()` - Grid-oriented shortcut that lowers to a canonical `2d` environment with layer metadata
- `@bind_graph_environment()` - Graph-oriented shortcut that lowers to a canonical `2d` environment with an explicit edge layer
- `@bind_uniform_environment()` - Basic environments

**Binder Classes**: Explicit adapters connecting user models to TenSnap protocol.

- `GridEnvironmentBinder` - Grid-oriented convenience wrapper over a canonical `2d` environment
- `GraphEnvironmentBinderNX` - NetworkX graph integration via canonical `2d` + edge-layer state
- `UniformEnvironmentBinder` - Simple agent list

Binders accept environment objects and use accessor functions/metadata to extract agent/environment properties. Internally they now expose canonical layer-oriented state to the transport layer, even when the public API still uses grid/graph terminology.

**Mesa 3 Integration**: Dedicated binding support for Mesa 3 framework.

- `@bind_mesa_grid_agent()` - Mesa agent metadata binding
- `@bind_mesa_grid_environment()` - Mesa model metadata binding
- `@bind_datacollector()` - Automatic chart generation from Mesa DataCollector
- `MesaSimulationHandler` - Specialized handler for Mesa models with automatic initialization

### Auto-Detection

**Parameters**: Auto-detect from dataclass fields/attributes with `BindParametersConfig` for exclusion patterns.

**Charts**: `@chart(id, label)` decorator for functions returning scalar or multi-series data.

**Actions**: `@action(id, label)` decorator for button handlers.

## Frontend (React/TypeScript)

**Tech Stack**: React 18, TypeScript, Zustand, Vite, Leafer UI, Recharts

`@tensnap/core` keeps the shared drawing logic but depends only on `@leafer-ui/core`.
Runtime-specific platform packages are imported by consumer packages:

- `@tensnap/web` and `@tensnap/benchmark` import `leafer-ui`
- `@tensnap/agent` imports `@leafer-ui/node`

### State Management (Zustand)

Store organized into slices:

- Environments with agents
- Parameters
- Charts with time-series data
- Current time
- Logs

Key methods:

- `setData()` - Apply incremental updates
- `updateAgents()` - Batch agent updates
- `addChartData()` - Add chart points

### WebSocket Client

`WebSocketManager` features:

- MessagePack/JSON support
- Auto-reconnect with exponential backoff
- Event-based message routing
- Optional message validation

### Components

Views dynamically generated from state:

- **Parameters**: Auto-generated controls (sliders, dropdowns, buttons)
- **Environments**: Leafer UI canvas for grid/graph visualization
- **Charts**: Recharts for time-series data

### Desktop App (Tauri)

Wraps web frontend with Rust backend for native file system access.

## Communication Protocol

All messages: `{ type: string, payload: object }`

Encoding: MessagePack (binary) or JSON

### Key Messages

**Server → Client**:

- `time_step_start/end` - Step boundaries
- `environment_update` - Full environment state with grid trajectory/coordinate config
- `agent_batch_update` - Incremental agent changes with create/delete/update operations
- `chart_update` - Chart data/operations
- `state_sync` - Differential sync response
- `log` - Server logs

**Client → Server**:

- `state_sync` - Request state synchronization
- `parameter_change` - Update parameter
- `button_click` - Trigger action

### State Synchronization

Enables reconnection without data loss:

1. Client sends current state on connect
2. Server computes diff (added/removed/updated)
3. Server responds with only changes
4. Client applies incremental update

Supports hot-reload and multi-client sync.

## Data Flow

### Initialization

1. Backend starts WebSocket server
2. Frontend connects and sends `state_sync` request
3. Backend computes diff (all new on first connect)
4. Frontend receives state and renders UI

### Simulation Loop

1. User clicks button → `button_click` message
2. Backend calls handler (e.g., `SimulationLoop.toggle()`)
3. Each step:
   - Send `time_step_start`
   - Execute model code
   - Send `agent_batch_update` (with create/delete/update operations)
   - Send `chart_update`
   - Send `time_step_end`
4. Frontend updates visualization with trajectories and coordinate transformations in real-time

### Parameter Change

1. User adjusts control → `parameter_change` message
2. Backend calls setter, updates internal value
3. Model uses new value on next step

## Performance

**Optimizations**:

- Batched message queue (0.1s flush interval)
- MessagePack binary serialization
- Async I/O
- Differential updates (only changed properties)
- Leafer UI canvas rendering
- Zustand state management

## References

- [Protocol Documentation](./protocol.md)
- [Development Setup](./development-setup.md)
- [Python API Reference](../api-reference/python-api.md)
- [Contributing Guidelines](./contributing.md)
