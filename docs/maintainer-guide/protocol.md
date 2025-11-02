# TenSnap WebSocket Protocol

This document specifies the WebSocket communication protocol between TenSnap simulation backends and the visualization frontend.

## Table of Contents

1. [Overview](#overview)
2. [Connection Lifecycle](#connection-lifecycle)
3. [Message Format](#message-format)
4. [Message Types](#message-types)
5. [State Synchronization](#state-synchronization)
6. [Data Types](#data-types)
7. [Implementation Examples](#implementation-examples)

## Overview

### Protocol Characteristics

- **Transport**: WebSocket (RFC 6455)
- **Serialization**: MessagePack (for efficiency) or JSON (for debugging)
- **Communication**: Bidirectional (client ↔ server)
- **Connection**: Persistent, reconnectable

### Design Goals

1. **Efficiency**: Minimize bandwidth for real-time updates
2. **Flexibility**: Support various simulation types
3. **Robustness**: Handle reconnections gracefully
4. **Simplicity**: Easy to implement in different languages

### Default Settings

- **Server Port**: 8765 (configurable)
- **Serialization**: MessagePack (binary)
- **Reconnection**: Automatic with exponential backoff

## Connection Lifecycle

### 1. Initial Connection

```
Client                                     Server
  |                                          |
  |  WebSocket Connect (ws://host:port)     |
  |----------------------------------------->|
  |                                          |
  |  Connection Established (101 Switching) |
  |<-----------------------------------------|
  |                                          |
```

### 2. State Synchronization

```
Client                                     Server
  |                                          |
  |  state_sync request (current state)     |
  |----------------------------------------->|
  |                                          |
  |  state_sync response (diff)             |
  |<-----------------------------------------|
  |                                          |
```

### 3. Simulation Running

```
Client                                     Server
  |                                          |
  |  parameter_change                       |
  |----------------------------------------->|
  |                                          |
  |  button_click (e.g., "play")            |
  |----------------------------------------->|
  |                                          |
  |  time_step_start                        |
  |<-----------------------------------------|
  |  agent_batch_update                     |
  |<-----------------------------------------|
  |  chart_update                             |
  |<-----------------------------------------|
  |  time_step_end                          |
  |<-----------------------------------------|
  |  (repeat for each step)                 |
```

### 4. Disconnection and Reconnection

```
Client                                     Server
  |                                          |
  |  Connection Lost                        |
  |  X                                   X  |
  |                                          |
  |  (wait, exponential backoff)            |
  |                                          |
  |  WebSocket Reconnect                    |
  |----------------------------------------->|
  |                                          |
  |  state_sync request (cached state)      |
  |----------------------------------------->|
  |                                          |
  |  state_sync response (diff)             |
  |<-----------------------------------------|
  |  (resume normal operation)              |
```

## Message Format

### Basic Structure

All messages follow this format:

```json
{
  "type": "message_type",
  "payload": { /* type-specific data */ }
}
```

### Serialization

#### MessagePack (Default)

```python
import msgpack

# Encode
message = {"type": "time_step_start", "payload": {"step": 42}}
binary_data = msgpack.packb(message)
await websocket.send(binary_data)

# Decode
binary_data = await websocket.recv()
message = msgpack.unpackb(binary_data)
```

#### JSON (Debug Mode)

```python
import json

# Encode
message = {"type": "time_step_start", "payload": {"step": 42}}
json_data = json.dumps(message)
await websocket.send(json_data)

# Decode
json_data = await websocket.recv()
message = json.loads(json_data)
```

## Message Types

### Server → Client Messages

#### 1. `time_step_start`

Signals the beginning of a simulation time step.

```typescript
{
  type: "time_step_start",
  payload: {
    step: number  // Current time step number
  }
}
```

**Example**:
```json
{
  "type": "time_step_start",
  "payload": {"step": 42}
}
```

#### 2. `time_step_end`

Signals the end of a simulation time step.

```typescript
{
  type: "time_step_end",
  payload: {
    step: number  // Current time step number
  }
}
```

#### 3. `agent_batch_update`

Updates multiple agents in an environment.

```typescript
{
  type: "agent_batch_update",
  payload: {
    env_id: string | number,  // Environment identifier
    updates: Array<{
      id: string,              // Agent ID
      x?: number,              // X position (optional)
      y?: number,              // Y position (optional)
      heading?: number,        // Heading in radians (optional)
      color?: string,          // Hex color (optional)
      size?: number,           // Size in pixels (optional)
      label?: string,          // Text label (optional)
      node_id?: string,        // For graph environments (optional)
      [key: string]: any       // Custom properties
    }>
  }
}
```

**Example**:
```json
{
  "type": "agent_batch_update",
  "payload": {
    "env_id": "main",
    "updates": [
      {"id": "agent_1", "x": 25.3, "y": 30.7, "heading": 1.57},
      {"id": "agent_2", "x": 40.1, "y": 15.2, "color": "#FF0000"}
    ]
  }
}
```

#### 4. `environment_update`

Updates entire environment state (rare, usually only on init).

```typescript
{
  type: "environment_update",
  payload: {
    id: string | number,
    type: "grid" | "graph",
    width?: number,           // For grid environments
    height?: number,          // For grid environments
    agents: Array<AgentState>,
    nodes?: Array<NodeState>, // For graph environments
    edges?: Array<EdgeState>, // For graph environments
    background?: string       // Hex-encoded numpy array
  }
}
```

#### 5. `chart_update`

Sends a data point for a chart.

```typescript
{
  type: "chart_update",
  payload: {
    chart_id: string,
    step: number,
    value: number
  }
}
```

**Example**:
```json
{
  "type": "chart_update",
  "payload": {
    "chart_id": "population",
    "step": 42,
    "value": 127.5
  }
}
```

#### 6. `state_sync`

Response to client's state synchronization request.

```typescript
{
  type: "state_sync",
  payload: {
    added_parameters: Array<ParameterState>,
    removed_parameters: Array<string>,
    updated_parameters: Array<ParameterState>,
    added_environments: Array<EnvironmentState>,
    removed_environments: Array<string | number>,
    updated_environments: Array<EnvironmentState>,
    added_charts: Array<ChartState>,
    removed_charts: Array<string>,
    updated_charts: Array<ChartState>
  }
}
```

#### 7. `error`

Reports an error from the server.

```typescript
{
  type: "error",
  payload: {
    message: string,
    code?: string,
    details?: any
  }
}
```

### Client → Server Messages

#### 1. `state_sync`

Request server state or send client's current state.

```typescript
{
  type: "state_sync",
  payload: {
    parameters: Array<string>,        // Known parameter IDs
    environments: Array<string | number>,  // Known environment IDs
    charts: Array<string>,            // Known chart IDs
    parameter_cache: {                // Cached parameter values
      [param_id: string]: any
    }
  }
}
```

**Example**:
```json
{
  "type": "state_sync",
  "payload": {
    "parameters": ["population", "speed"],
    "environments": ["main"],
    "charts": ["avg_speed"],
    "parameter_cache": {
      "population": 100,
      "speed": 1.5
    }
  }
}
```

#### 2. `parameter_change`

User changed a parameter value.

```typescript
{
  type: "parameter_change",
  payload: {
    id: string,
    value: any
  }
}
```

**Example**:
```json
{
  "type": "parameter_change",
  "payload": {
    "id": "population",
    "value": 150
  }
}
```

#### 3. `button_click`

User clicked a button.

```typescript
{
  type: "button_click",
  payload: {
    id: string
  }
}
```

**Example**:
```json
{
  "type": "button_click",
  "payload": {"id": "reset"}
}
```

## State Synchronization

### Why State Sync?

State synchronization allows:
- Reconnection without data loss
- Hot reload during development
- Multiple clients staying in sync
- Minimal bandwidth usage

### Sync Algorithm

1. **Client connects** and sends current state:
   ```json
   {
     "parameters": ["param1", "param2"],
     "parameter_cache": {"param1": 100, "param2": 0.5}
   }
   ```

2. **Server compares** with its state:
   - Added: Parameters on server but not in client list
   - Removed: Parameters in client list but not on server
   - Updated: Parameters with different values

3. **Server responds** with diff:
   ```json
   {
     "added_parameters": [/* new param3 */],
     "removed_parameters": ["param2"],
     "updated_parameters": [/* param1 with new value */]
   }
   ```

4. **Client applies** changes to local state

### Parameter Caching

Client caches parameter values to detect server-side changes:

```typescript
// Client sends last known values
parameter_cache: {
  "population": 100,
  "speed": 1.5
}

// Server detects "speed" changed to 2.0 on server
// Server includes "speed" in updated_parameters
```

## Data Types

### ParameterState

```typescript
interface ParameterState {
  id: string;
  type: "number" | "enum" | "button";
  label: string;
  value: any;
  min?: number;              // For slider
  max?: number;              // For slider
  step?: number;             // For slider
  options?: Array<string>;   // For enum
  allow_runtime_change: boolean;
  last_cached_value?: any;   // For sync
}
```

### EnvironmentState

```typescript
interface EnvironmentState {
  id: string | number;
  type: "grid" | "graph";
  width?: number;            // Grid only
  height?: number;           // Grid only
  agents: Array<AgentState>;
  nodes?: Array<NodeState>;  // Graph only
  edges?: Array<EdgeState>;  // Graph only
  background?: string;       // Hex-encoded numpy array
}
```

### AgentState

```typescript
interface AgentState {
  id: string;
  x: number;
  y: number;
  heading?: number;          // Radians
  color?: string;            // Hex color
  icon?: string;             // Icon type
  size?: number;             // Pixels
  label?: string;            // Text label
  node_id?: string;          // For graph environments
}
```

### NodeState (Graph Environments)

```typescript
interface NodeState {
  id: string;
  x: number;
  y: number;
  color?: string;
  size?: number;
  label?: string;
}
```

### EdgeState (Graph Environments)

```typescript
interface EdgeState {
  source: string;            // Source node ID
  target: string;            // Target node ID
  weight?: number;
  color?: string;
  directed?: boolean;
}
```

### ChartState

```typescript
interface ChartState {
  id: string;
  label: string;
  color?: string;            // Line color
}
```

## Implementation Examples

### Python Server Implementation

```python
import asyncio
import json
import msgpack
from websockets.server import serve, WebSocketServerProtocol

class TenSnapServer:
    def __init__(self, port=8765):
        self.port = port
        self.clients = set()
        self.parameters = {}
        self.environments = {}
        self.charts = {}
    
    async def handle_client(self, websocket: WebSocketServerProtocol):
        """Handle a client connection"""
        self.clients.add(websocket)
        try:
            async for message in websocket:
                data = msgpack.unpackb(message)
                await self.handle_message(websocket, data)
        finally:
            self.clients.remove(websocket)
    
    async def handle_message(self, websocket, message):
        """Process incoming message"""
        msg_type = message.get("type")
        payload = message.get("payload", {})
        
        if msg_type == "state_sync":
            response = self.generate_state_sync(payload)
            await self.send_message(websocket, "state_sync", response)
        elif msg_type == "parameter_change":
            self.handle_parameter_change(payload)
        elif msg_type == "button_click":
            await self.handle_button_click(payload)
    
    async def send_message(self, websocket, msg_type, payload):
        """Send message to specific client"""
        message = {"type": msg_type, "payload": payload}
        data = msgpack.packb(message)
        await websocket.send(data)
    
    async def broadcast(self, msg_type, payload):
        """Broadcast message to all clients"""
        message = {"type": msg_type, "payload": payload}
        data = msgpack.packb(message)
        await asyncio.gather(
            *[client.send(data) for client in self.clients],
            return_exceptions=True
        )
    
    async def run(self):
        """Start server"""
        async with serve(self.handle_client, "localhost", self.port):
            await asyncio.Future()  # Run forever
```

### JavaScript Client Implementation

```typescript
import msgpack from '@msgpack/msgpack';

class TenSnapClient {
  private socket: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  connect(url: string) {
    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';
    
    this.socket.onopen = () => {
      console.log('Connected');
      this.reconnectAttempts = 0;
      this.sendStateSync();
    };
    
    this.socket.onmessage = (event) => {
      const message = msgpack.decode(new Uint8Array(event.data));
      this.handleMessage(message);
    };
    
    this.socket.onclose = () => {
      console.log('Disconnected');
      this.attemptReconnect();
    };
  }
  
  private handleMessage(message: any) {
    const { type, payload } = message;
    
    switch (type) {
      case 'state_sync':
        this.applyStateSync(payload);
        break;
      case 'agent_batch_update':
        this.updateAgents(payload);
        break;
      case 'chart_update':
        this.addChartData(payload);
        break;
      // ... more handlers
    }
  }
  
  sendMessage(type: string, payload: any) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.warn('Socket not ready');
      return;
    }
    
    const message = { type, payload };
    const data = msgpack.encode(message);
    this.socket.send(data);
  }
  
  sendParameterChange(id: string, value: any) {
    this.sendMessage('parameter_change', { id, value });
  }
  
  sendButtonClick(id: string) {
    this.sendMessage('button_click', { id });
  }
  
  private sendStateSync() {
    // Send current client state
    const payload = {
      parameters: Array.from(this.parameters.keys()),
      environments: Array.from(this.environments.keys()),
      charts: Array.from(this.charts.keys()),
      parameter_cache: this.getParameterCache()
    };
    this.sendMessage('state_sync', payload);
  }
  
  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    setTimeout(() => {
      console.log(`Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect(this.url);
    }, delay);
  }
}
```

## Performance Considerations

### Bandwidth Optimization

1. **Differential Updates**: Only send changed agent properties
2. **Batch Updates**: Group multiple agent updates
3. **MessagePack**: Binary serialization vs JSON
4. **State Caching**: Avoid resending unchanged data

### Latency Optimization

1. **Direct WebSocket**: No HTTP overhead
2. **Async Processing**: Non-blocking I/O
3. **Efficient Serialization**: Fast encoding/decoding
4. **Message Prioritization**: Time-critical updates first

### Scalability

- **Multiple Clients**: Server handles multiple simultaneous connections
- **Large Agent Counts**: Batch updates support thousands of agents
- **High Update Rates**: 50-100 updates per second achievable

## Version Compatibility

Current protocol version: **0.1.0**

Future versions will maintain backwards compatibility or provide migration guides.

## References

- **WebSocket RFC**: [RFC 6455](https://tools.ietf.org/html/rfc6455)
- **MessagePack**: [msgpack.org](https://msgpack.org/)
- **Architecture Doc**: [architecture.md](./architecture.md)
