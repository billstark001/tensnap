# TenSnap Architecture

This document provides a comprehensive overview of TenSnap's architecture, design decisions, and implementation details for maintainers and contributors.

## Table of Contents

1. [System Overview](#system-overview)
2. [Design Philosophy](#design-philosophy)
3. [Component Architecture](#component-architecture)
4. [Communication Protocol](#communication-protocol)
5. [Data Flow](#data-flow)
6. [Performance Considerations](#performance-considerations)
7. [Future Architecture Plans](#future-architecture-plans)

## System Overview

TenSnap follows a client-server architecture with clear separation between simulation logic, communication layer, and visualization.

```
┌─────────────────────────────────────────────────────────────────┐
│                     TenSnap System Architecture                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  Simulation      │         │  Communication   │         │  Visualization   │
│  Backend         │◄───────►│  Layer           │◄───────►│  Frontend        │
│                  │         │                  │         │                  │
│  - Python Model  │         │  - WebSocket     │         │  - React UI      │
│  - Java (planned)│         │  - MessagePack   │         │  - D3/Leafer     │
│  - Any Language  │         │  - State Sync    │         │  - Recharts      │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

### Core Principles

1. **Language Agnostic**: Simulation logic can be written in any language
2. **Decoupled Components**: Clear boundaries between model, communication, and view
3. **Performance First**: Optimized for real-time updates with many agents
4. **User-Friendly**: Multiple API levels for different user expertise

## Design Philosophy

### Separation of Concerns

TenSnap separates three primary concerns:

#### 1. Simulation Logic (Pure Model)

- Domain-specific simulation code
- No visualization dependencies
- Testable independently
- Reusable across different visualization tools

```python
# Pure simulation - no TenSnap dependencies
class FlockSimulation:
    def step(self):
        for bird in self.birds:
            bird.update_velocity(self.birds)
            bird.update_position()
```

#### 2. Integration Layer (Bindings)

- Connects simulation to TenSnap
- Manages parameters, charts, buttons
- Handles state synchronization
- Language-specific implementations

```python
# Integration layer - TenSnap bindings
from tensnap import TenSnapServer, GridEnvironmentModel
server = TenSnapServer()
grid = GridEnvironmentModel()
# ... bind parameters, charts, etc.
```

#### 3. Visualization Layer (Frontend)

- Pure view logic
- Receives state updates
- Handles user interaction
- No simulation logic

### Multi-Granularity API Design

TenSnap provides APIs at different abstraction levels:

#### Level 1: High-Level Decorators (Beginners)

```python
@chart("population", "Population")
def track_pop():
    return len(agents)

params = quick_bind(config)
```

**Target Users**: Students, researchers new to programming  
**Benefits**: Minimal code, automatic binding, convention over configuration

#### Level 2: Object-Oriented API (Intermediate)

```python
param = parameter(id="speed", label="Speed", value=1.0, min=0.1, max=5.0)
server.add_parameter(param)

chart_obj = Chart(id="pop", label="Population", collect_func=count_agents)
server.add_chart(chart_obj)
```

**Target Users**: Professional researchers, developers  
**Benefits**: Explicit control, better IDE support, clear data flow

#### Level 3: Protocol-Level Access (Advanced)

```python
# Direct WebSocket message construction
message = {
    "type": "agent_batch_update",
    "payload": {
        "env_id": "main",
        "updates": [...]
    }
}
await websocket.send(msgpack.packb(message))
```

**Target Users**: Framework developers, performance optimization experts  
**Benefits**: Maximum control, custom message types, direct protocol access

## Component Architecture

### Monorepo Structure

```
tensnap/
├── packages/
│   ├── tensnap-python/          # Python bindings
│   │   └── tensnap/
│   │       ├── models/          # Data models
│   │       ├── bindings/        # High-level API
│   │       ├── server.py        # WebSocket server
│   │       ├── simulation.py    # Simulation manager
│   │       └── examples/        # Example models
│   │
│   ├── tensnap-web/             # Web frontend (React)
│   │   └── src/
│   │       ├── components/      # UI components
│   │       ├── store/           # State management (Zustand)
│   │       ├── utils/           # Utilities
│   │       └── types/           # TypeScript types
│   │
│   └── tensnap-tauri/           # Desktop app (Tauri)
│       ├── src/                 # Web content
│       └── src-tauri/           # Rust backend
│
└── docs/                        # Documentation
```

### Python Backend Architecture

#### Server Component (`server.py`)

**Responsibilities**:
- Manage WebSocket connections
- Broadcast state updates to clients
- Handle parameter changes from clients
- Coordinate simulation timing

**Key Classes**:

```python
class TenSnapServer:
    """Main WebSocket server"""
    - environments: Dict[str|int, EnvironmentModel]
    - parameters: Dict[str, Parameter]
    - charts: Dict[str, Chart]
    - buttons: Dict[str, Callable]
    - clients: Set[WebSocketServerProtocol]
    
    async def run()
    async def broadcast(message)
    async def handle_client_message(message)
```

**Optimizations**:
- Message batching for reduced overhead
- Differential updates (only send changes)
- MessagePack for efficient serialization
- Connection pooling

#### Models Component (`models/`)

**Data Models**:

```python
# agent.py
class AgentModel:
    """Represents a single agent"""
    - Stores agent properties (position, color, etc.)
    - Supports update_source for automatic syncing
    - Generates update dictionaries

# environment.py
class GridEnvironmentModel:
    """2D grid environment"""
    - Manages agents in 2D space
    - Background image support (NumPy arrays)
    - Batch update generation

class GraphEnvironmentModel:
    """Network/graph environment"""
    - Manages nodes and edges
    - Agent positioning on graph
    - Network topology updates

# communication.py
TypedDict definitions for WebSocket messages:
    - ParameterState
    - EnvironmentState
    - ChartState
    - StateSyncResponse
```

#### Bindings Component (`bindings/`)

**High-Level API Implementation**:

```python
# parameters.py
- parameter(): Create parameter manually
- bind_parameter(): Bind single attribute
- quick_bind(): Auto-detect all parameters
- ParameterBinding: Bidirectional property binding

# charts.py
- @chart: Decorator for chart functions
- Chart class: Chart data management

# buttons.py
- @button: Decorator for button actions

# registry.py
- Global registration system
- Auto-discovery of decorated functions
```

**Parameter Binding Architecture**:

```python
class ParameterBinding:
    """Two-way binding between object attribute and UI parameter"""
    
    def __init__(self, target, attr_name, param):
        self.target = target
        self.attr_name = attr_name
        self.param = param
    
    @property
    def value(self):
        """Read from target object"""
        return getattr(self.target, self.attr_name)
    
    @value.setter
    def value(self, val):
        """Write to target object"""
        setattr(self.target, self.attr_name, val)
        self.param.value = val  # Also update parameter
```

### Frontend Architecture

#### Technology Stack

- **React 18**: UI framework
- **TypeScript**: Type safety
- **Zustand**: State management
- **Vite**: Build tool
- **D3.js**: Data visualization
- **Leafer UI**: Canvas rendering
- **Recharts**: Chart components
- **Radix UI**: Component primitives

#### State Management

```typescript
// store/websocket.ts
interface WebSocketStore {
  socket: WebSocket | null;
  connected: boolean;
  connect: (url: string) => void;
  disconnect: () => void;
  sendMessage: (message: any) => void;
}

// store/scenario.ts
interface ScenarioStore {
  parameters: Map<string, Parameter>;
  environments: Map<string, Environment>;
  charts: Map<string, Chart>;
  updateParameter: (id: string, value: any) => void;
  updateEnvironment: (id: string, state: EnvironmentState) => void;
}
```

#### Component Hierarchy

```
App
├── Providers (Context providers)
├── ToolBar (Top menu)
├── ParameterControl (Left panel)
│   ├── Slider components
│   ├── Enum dropdowns
│   └── Button components
├── ViewRenderer (Center area)
│   ├── GridEnvironmentView
│   │   ├── Canvas rendering (Leafer)
│   │   ├── Agent visualization
│   │   └── Background image
│   ├── GraphEnvironmentView
│   │   ├── Network visualization (D3)
│   │   └── Node/edge rendering
│   └── ChartView
│       └── Line charts (Recharts)
└── FileSystem (File management)
```

#### WebSocket Client

```typescript
class WebSocketManager {
  private socket: WebSocket | null = null;
  private messageQueue: Message[] = [];
  
  connect(url: string) {
    this.socket = new WebSocket(url);
    this.socket.onmessage = this.handleMessage;
  }
  
  private handleMessage(event: MessageEvent) {
    const data = msgpack.decode(event.data);
    switch (data.type) {
      case 'state_sync':
        this.handleStateSync(data.payload);
        break;
      case 'agent_batch_update':
        this.handleAgentUpdate(data.payload);
        break;
      // ... more handlers
    }
  }
}
```

### Desktop Application (Tauri)

**Architecture**:
- Embeds web frontend
- Rust backend for system access
- Native window management
- File system access

**Benefits**:
- No browser required
- Native performance
- OS integration
- Offline capability

## Communication Protocol

### WebSocket Protocol

TenSnap uses WebSocket for bidirectional communication with MessagePack serialization.

#### Message Format

```javascript
{
  "type": "message_type",
  "payload": { /* message-specific data */ }
}
```

#### Message Types

**Server → Client**:

```typescript
type ServerMessage =
  | { type: "time_step_start", payload: { step: number } }
  | { type: "time_step_end", payload: { step: number } }
  | { type: "agent_batch_update", payload: AgentUpdate[] }
  | { type: "environment_update", payload: EnvironmentState }
  | { type: "chart_update", payload: ChartDataPoint }
  | { type: "state_sync", payload: StateSyncResponse }
  | { type: "error", payload: { message: string } }
```

**Client → Server**:

```typescript
type ClientMessage =
  | { type: "state_sync", payload: ClientStateRequest }
  | { type: "parameter_change", payload: { id: string, value: any } }
  | { type: "button_click", payload: { id: string } }
```

### State Synchronization

TenSnap uses a differential state sync protocol:

1. **Client connects** → Sends current state (parameters, environments, charts it knows about)
2. **Server compares** → Determines what's added/removed/updated
3. **Server responds** → Sends only differences
4. **Client updates** → Applies changes to local state

**Benefits**:
- Handles reconnections gracefully
- Minimal bandwidth usage
- Supports multiple concurrent clients
- Hot-reload friendly

## Data Flow

### Initialization Flow

```
1. User starts Python simulation
   └─→ Creates TenSnapServer, environments, parameters
   
2. User opens web interface
   └─→ React app loads, attempts WebSocket connection
   
3. WebSocket connects
   └─→ Client sends state_sync request with empty state
   
4. Server responds
   └─→ Sends all parameters, environments, charts, buttons
   
5. UI initializes
   └─→ Renders controls, environments, charts
```

### Simulation Step Flow

```
1. User clicks "Play" in UI
   └─→ Client sends button_click("play")
   
2. Server receives click
   └─→ Starts SimulationManager
   
3. SimulationManager calls on_step
   ├─→ Server sends time_step_start
   ├─→ User simulation code runs
   ├─→ Agents update positions
   ├─→ Server sends agent_batch_update
   ├─→ Charts collect data points
   ├─→ Server sends chart_update
   └─→ Server sends time_step_end
   
4. Client receives updates
   ├─→ Updates agent positions in environment
   ├─→ Adds data points to charts
   └─→ Triggers re-render
   
5. Repeat steps 3-4 until stopped
```

### Parameter Change Flow

```
1. User moves slider in UI
   └─→ Client sends parameter_change message
   
2. Server receives message
   ├─→ Validates change (runtime_change_allowed?)
   ├─→ Updates parameter value
   └─→ Updates bound object attribute
   
3. Simulation uses new value
   └─→ Next step uses updated parameter
```

## Performance Considerations

### Backend Optimizations

1. **Message Batching**: Group multiple updates into single WebSocket message
2. **Differential Updates**: Only send changed agent properties
3. **MessagePack**: Binary serialization (faster than JSON)
4. **Async I/O**: Non-blocking WebSocket communication
5. **Update Source Pattern**: Avoid redundant property copies

### Frontend Optimizations

1. **Canvas Rendering**: Use Leafer UI for efficient agent rendering
2. **Virtual Scrolling**: For large parameter lists
3. **Memoization**: React.memo for expensive components
4. **Web Workers**: Offload heavy computations (planned)
5. **Incremental Updates**: Only re-render changed components

### Scalability Limits

**Current Performance** (tested):
- **Agents**: Up to 10,000 agents at 30 FPS
- **Update Rate**: 50-100 updates per second
- **Clients**: Multiple clients (5+) simultaneously
- **Network**: ~100 KB/s average bandwidth

**Bottlenecks**:
- Browser rendering (canvas)
- WebSocket message throughput
- JavaScript chart rendering

**Future Improvements**:
- WebGL rendering for >10k agents
- Binary diff protocol
- WebRTC for lower latency
- Server-side rendering option

## Future Architecture Plans

### Language Bindings

**Planned**:
- Java bindings (Maven package)
- JavaScript bindings (npm package)
- Go bindings (Go module)
- MATLAB bindings (toolbox)

**Architecture**:
- Shared protocol specification
- Language-specific implementations
- Common test suite

### Cloud Deployment

**Goals**:
- Web-hosted simulations
- Collaborative modeling
- Persistent state storage

**Components**:
- Authentication service
- Simulation hosting backend
- Shared workspace storage

### AI-Assisted Workflows

**Integration Points**:
- Natural language model description
- Auto-generated parameter bindings
- Suggested visualizations
- Documentation generation

### Advanced Visualization

**Planned Features**:
- 3D environments (Three.js)
- VR/AR support
- Real-time video export
- Interactive analysis tools

## Contributing to Architecture

When proposing architectural changes:

1. **Document motivation**: Why is the change needed?
2. **Analyze impact**: What components are affected?
3. **Consider backwards compatibility**: Can existing code still work?
4. **Performance implications**: Will this affect performance?
5. **Test coverage**: How will changes be tested?

See [Contributing Guidelines](./contributing.md) for more details.

## References

- **[Protocol Documentation](./protocol.md)** - Detailed protocol specification
- **[Development Setup](./development-setup.md)** - Setting up development environment
- **[Python API Reference](../api-reference/python-api.md)** - API documentation
