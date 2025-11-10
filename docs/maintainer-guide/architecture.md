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

## API Levels

### High-Level (Decorators)

Auto-discovery with minimal boilerplate:

```python
from tensnap import SimulationScenario, action, chart

scenario = SimulationScenario()
scenario.add_parameters(config)  # Auto-detect from dataclass/object
scenario.add_charts(globals())   # Auto-detect @chart decorators

@chart("population", "Population Count")
def get_population():
    return len(agents)
```

### Low-Level (Direct API)

Explicit control:

```python
from tensnap import TenSnapServer, NumberParameter

server = TenSnapServer()
param = NumberParameter(id="speed", label="Speed", value=1.0, min=0.1, max=5.0)
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

**`scenario.py`** - High-level orchestration combining server, simulation loop, and auto-binding.

**`server.py`** - WebSocket server managing connections and broadcasting updates.

Key features:

- Batched message queue for efficiency
- MessagePack/JSON serialization
- Async I/O with non-blocking operations
- State sync with differential updates

**`sim_loop.py`** - Simulation execution manager with operation queue.

Actions: `start()`, `stop()`, `toggle()`, `step_once()`

Uses queue to serialize control commands and prevent race conditions.

### Environment Binders

Adapters connecting user models to TenSnap protocol:

- `UniformEnvironmentBinder` - Simple agent list
- `GridEnvironmentBinder` - 2D grid with width/height
- `NXGraphEnvironmentBinder` - NetworkX graph integration

### Auto-Detection

**Parameters**: Auto-detect from dataclass fields/attributes with configurable regex patterns.

**Charts**: `@chart(id, label)` decorator for functions returning chart data. Supports multi-series.

**Actions**: `@action(id, label)` decorator for button handlers.

## Frontend (React/TypeScript)

**Tech Stack**: React 18, TypeScript, Zustand, Vite, Leafer UI, Recharts

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
- `environment_update` - Full environment state
- `agent_batch_update` - Incremental agent changes
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
   - Send `agent_batch_update`
   - Send `chart_update`
   - Send `time_step_end`
4. Frontend updates visualization in real-time

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

**Tested Performance**:

- 10,000+ agents at 30 FPS
- 50-100 updates/sec
- Multiple concurrent clients
- ~100 KB/s bandwidth

## References

- [Protocol Documentation](./protocol.md)
- [Development Setup](./development-setup.md)
- [Python API Reference](../api-reference/python-api.md)
- [Contributing Guidelines](./contributing.md)
