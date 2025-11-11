# TenSnap WebSocket Protocol

Specification for WebSocket communication between TenSnap simulation backends and visualization frontend.

## Overview

### Protocol Characteristics

- **Transport**: WebSocket (RFC 6455)
- **Serialization**: MessagePack (binary) or JSON (text)
- **Communication**: Bidirectional (client ↔ server)
- **Connection**: Persistent with automatic reconnection

### Design Goals

1. **Efficiency**: Minimize bandwidth for real-time updates
2. **Flexibility**: Support various simulation types
3. **Robustness**: Handle reconnections gracefully
4. **Simplicity**: Easy to implement in different languages

## Connection Lifecycle

1. **Initial Connection**: Client connects via WebSocket
2. **State Sync**: Client sends current state; server responds with differential updates
3. **Runtime**: Bidirectional message exchange during simulation
4. **Reconnection**: Automatic reconnect with state sync to recover session

## Message Format

All messages use this structure:

```json
{
  "type": "message_type",
  "payload": { /* type-specific data */ }
}
```

Messages are serialized with MessagePack (binary, default) or JSON (text, for debugging).

## Message Types

### Server → Client

#### `time_step_start`

Marks simulation step start.

```typescript
{ type: "time_step_start", payload: { time: number } }
```

#### `time_step_end`

Marks simulation step end.

```typescript
{ type: "time_step_end", payload: { time?: number } }
```

#### `environment_update`

Updates environment state with optional full agent list.

```typescript
{
  type: "environment_update",
  payload: {
    id: string,
    data: {
      type: "grid" | "graph" | "uniform",
      width?: number,              // Grid only
      height?: number,             // Grid only
      coord_offset?: "int" | "float",  // Grid only, default 'int'
      trajectory_length?: number,  // Grid only, <=0 for infinity
      trajectory_color?: string,   // Grid only
      edges?: Array<Edge>,         // Graph only
      background?: string          // Grid only (hex-encoded)
    },
    agents?: Array<Agent>          // Optional full replacement
  }
}
```

#### `agent_update`

Updates a single agent.

```typescript
{
  type: "agent_update",
  payload: {
    environment_id: string,
    agent_id: string | number,
    data?: {
      x?: number,
      y?: number,
      heading?: number,
      color?: string,
      size?: number,
      icon?: string,
      trajectory_length?: number,  // Grid only
      trajectory_color?: string,   // Grid only
      // ... custom properties
    },
    operation?: "create" | "delete" | "update"  // default 'update'
  }
}
```

#### `agent_batch_update`

Updates multiple agents efficiently.

```typescript
{
  type: "agent_batch_update",
  payload: {
    environment_id: string,
    updates: Array<{
      id: string | number,
      data?: { /* agent properties */ },
      operation?: "create" | "delete" | "update"  // default 'update'
    }>
  }
}
```

#### `chart_update`

Updates chart data or executes operations.

```typescript
{
  type: "chart_update",
  payload: {
    updates?: Array<{ id: string, value: any }>,
    operations?: Array<{ id: string, operation: "clear" }>
  }
}
```

#### `state_sync`

Differential state synchronization response.

```typescript
{
  type: "state_sync",
  payload: {
    mode?: "full" | "incremental",
    added_parameters: Array<Parameter>,
    removed_parameters: Array<string>,
    updated_parameters: Array<Parameter>,
    added_environments: Array<Environment>,
    removed_environments: Array<string>,
    updated_environments: Array<Environment>,
    added_charts: Array<ChartGroupMetadata>,
    removed_charts: Array<string>,
    updated_charts: Array<ChartGroupMetadata>,
    clear_charts?: boolean | Array<string>
  }
}
```

#### `log`

Server log message.

```typescript
{
  type: "log",
  payload: {
    level: "debug" | "info" | "warning" | "error",
    message: string,
    timestamp?: number
  }
}
```

### Client → Server

#### `state_sync`

Request state synchronization.

```typescript
{
  type: "state_sync",
  payload: {
    parameters: Array<Parameter>,       // Current parameters
    environments: Array<Environment>,   // Current environments (without agents)
    charts: Array<ChartMetadata>        // Current charts
  }
}
```

#### `parameter_change`

Change parameter value.

```typescript
{ type: "parameter_change", payload: { id: string, value: any } }
```

#### `button_click`

Trigger action button.

```typescript
{ type: "button_click", payload: { action: string } }
```

## State Synchronization

State sync enables reconnection without data loss, hot reload, and multi-client sync with minimal bandwidth.

**Process:**

1. Client connects and sends current state (parameters, environments, charts)
2. Server computes diff: added, removed, updated items
3. Server responds with only changes
4. Client applies incremental update

This allows seamless reconnection and ensures all clients stay synchronized efficiently.

## Data Types

### Parameter

```typescript
interface Parameter {
  id: string;
  type: "number" | "enum" | "action" | "boolean" | "string";
  label: string;
  allowRuntimeChange?: boolean;
  
  // Type-specific fields
  value?: any;               // Not for action
  min?: number;              // Number only
  max?: number;              // Number only
  step?: number;             // Number only
  options?: string[];        // Enum only
}
```

### Environment

```typescript
interface Environment {
  id: string;
  type: "grid" | "graph" | "uniform";
  label?: string;
  agents: Agent[];
  
  // Grid-specific
  width?: number;
  height?: number;
  coord_offset?: "int" | "float";   // Default 'int'
  background?: string;               // Hex-encoded numpy array
  trajectory_length?: number;        // <=0 for infinity
  trajectory_color?: string;
  
  // Graph-specific
  edges?: Array<{
    source: string | number,
    target: string | number,
    directed?: boolean,
    color?: string,
    width?: number
  }>;
}
```

### Agent

```typescript
interface Agent {
  id: string | number;
  x?: number;                     // Grid/Graph
  y?: number;                     // Grid/Graph
  heading?: number;               // Grid (radians)
  trajectory_length?: number;     // Grid only, overrides environment default
  trajectory_color?: string;      // Grid only, overrides environment default
  color?: string;
  icon?: "arrow" | "circle" | "square" | "triangle";
  size?: number;
  data?: Record<string, any>;
}
```

### ChartGroupMetadata

```typescript
interface ChartGroupMetadata {
  id: string;
  label: string;
  color?: string;
  dataList?: Array<{         // For multi-series charts
    id: string,
    label: string,
    color?: string
  }>;
}
```

## Performance

- **Batch updates**: Multiple agent changes grouped per message
- **MessagePack**: Binary serialization for efficiency
- **Differential sync**: Only send changes, not full state
- **Async I/O**: Non-blocking WebSocket operations
- **Tested**: 10,000+ agents at 30 FPS, 50-100 updates/sec

## References

- [Architecture Documentation](./architecture.md)
- [WebSocket RFC 6455](https://tools.ietf.org/html/rfc6455)
- [MessagePack](https://msgpack.org/)
