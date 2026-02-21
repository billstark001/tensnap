# TenSnap WebSocket Protocol v0.2

Draft specification for the redesigned communication protocol.
Supersedes the v0.1 protocol once fully implemented.

## Overview

### Key Design Changes from v0.1

| Concern | v0.1 | v0.2 |
|---|---|---|
| Actions | `action` parameter type + `button_click` | Standalone `Action` entity + `action_start`/`action_end` |
| Simulation loop control | Server manages event loop | Client drives loop via `continuous` flag on `action_start` |
| Environment updates | Monolithic `environment_update` | Fine-grained `env_*` / `env_layer_*` / `agent_*` / `edge_*` |
| Agent batch format | `{ id, data: {...} }` | `{ id, ...diff }` (flat diff) |
| Timestep signaling | `time_step_start` / `time_step_end` | Single `metadata_update` |
| Parameter values | `parameter_change` (client only) | `parameter_change` (client→server) + `parameter_sync` (server→client) |
| State sync direction | Bidirectional | Client→Server only; server replies with CUD messages |

### Protocol Characteristics

- **Transport**: WebSocket (RFC 6455)
- **Serialization**: MessagePack (binary) or JSON (text)
- **Communication**: Bidirectional (client ↔ server)
- **Connection**: Persistent with automatic reconnection

---

## Message Format

```json
{ "type": "message_type", "payload": { /* type-specific data */ } }
```

---

## Server → Client Messages

### `metadata_update`

Replaces `time_step_start` and `time_step_end`. Carries the current simulation
time and any other extensible metadata.

```typescript
{
  type: "metadata_update",
  payload: {
    time?: number        // current simulation timestep
    // reserved for future metadata fields
  }
}
```

### `action_end`

Sent after the server finishes executing an action. For **continuous** actions
the client uses the `continue` flag to decide whether to keep firing
`action_start`. If `continue` is explicitly `false` the loop stops; any other
value (including absent) is treated as "keep going".

```typescript
{
  type: "action_end",
  payload: {
    id: string           // action id that finished
    continue?: boolean   // explicit false → stop continuous loop
  }
}
```

### `action_create`

Register a new action button on the client.

```typescript
{
  type: "action_create",
  payload: {
    id: string
    label: string
    continuous?: boolean          // hint: does this action make sense in continuous mode?
    allowRuntimeChange?: boolean  // default true
  }
}
```

### `action_update`

Update metadata of an existing action.

```typescript
{
  type: "action_update",
  payload: { id: string, label?: string, continuous?: boolean, allowRuntimeChange?: boolean }
}
```

### `action_delete`

Remove an action button from the client.

```typescript
{ type: "action_delete", payload: { id: string } }
```

### `env_create`

Create a new environment container.

```typescript
{
  type: "env_create",
  payload: {
    id: string
    type: "uniform" | "2d"    // "2d" covers both grid and graph layouts
  }
}
```

### `env_delete`

Remove an environment and all its layers.

```typescript
{ type: "env_delete", payload: { id: string } }
```

### `env_layer_create`

Create a layer within an environment. Layers carry spatial/structural metadata
but not agent data.

```typescript
{
  type: "env_layer_create",
  payload: {
    env_id: string
    layer_id: string              // empty string for the single layer of a uniform env
    layer_type: string            // registered layer type, e.g. "grid", "graph"
    data?: Record<string, any>    // layer metadata (no agents)
  }
}
```

### `env_layer_update`

Update layer metadata (not agent data).

```typescript
{
  type: "env_layer_update",
  payload: {
    env_id: string
    layer_id: string
    data: Record<string, any>
  }
}
```

### `env_layer_delete`

Delete a layer.

```typescript
{ type: "env_layer_delete", payload: { env_id: string, layer_id: string } }
```

### `agent_create`

Create agents in a layer (batch).

```typescript
{
  type: "agent_create",
  payload: {
    env_id: string
    layer_id: string
    agents: Agent[]
  }
}
```

### `agent_update`

Update agents in a layer (batch, flat diff). Each item is the agent id plus
only the fields that changed, merged flat into a single object.

```typescript
{
  type: "agent_update",
  payload: {
    env_id: string
    layer_id: string
    agents: Array<{ id: AgentId, [field: string]: any }>
  }
}
```

### `agent_delete`

Delete agents from a layer (batch).

```typescript
{
  type: "agent_delete",
  payload: {
    env_id: string
    layer_id: string
    ids: AgentId[]
  }
}
```

### `edge_create`

Create edges in a layer (batch).

```typescript
{
  type: "edge_create",
  payload: {
    env_id: string
    layer_id: string
    edges: Edge[]
  }
}
```

### `edge_update`

Update edges in a layer (batch, flat diff). Identity key is `(source, target)`.

```typescript
{
  type: "edge_update",
  payload: {
    env_id: string
    layer_id: string
    edges: Array<{ source: AgentId, target: AgentId, [field: string]: any }>
  }
}
```

### `edge_delete`

Delete edges from a layer (batch).

```typescript
{
  type: "edge_delete",
  payload: {
    env_id: string
    layer_id: string
    edges: Array<{ source: AgentId, target: AgentId }>
  }
}
```

### `parameter_create`

Register a new parameter control.

```typescript
{ type: "parameter_create", payload: Parameter }
```

### `parameter_update`

Update parameter definition (metadata, not value).

```typescript
{ type: "parameter_update", payload: Parameter }
```

### `parameter_delete`

Remove a parameter control.

```typescript
{ type: "parameter_delete", payload: { id: string } }
```

### `parameter_sync`

Server-initiated value correction. Sent when the server modifies a parameter
value programmatically, or when it rejects the value the client just sent.

```typescript
{ type: "parameter_sync", payload: { id: string, value: any } }
```

### `chart_create`

Register a new chart.

```typescript
{ type: "chart_create", payload: ChartGroupMetadata }
```

### `chart_delete`

Remove a chart.

```typescript
{ type: "chart_delete", payload: { id: string } }
```

### `chart_update`

Push new data points or chart operations (unchanged from v0.1).

```typescript
{
  type: "chart_update",
  payload: {
    updates?: Array<{ id: string, time?: number, value: any }>
    operations?: Array<{ id: string, operation: "clear" }>
  }
}
```

### `log`

```typescript
{
  type: "log",
  payload: { level: "debug"|"info"|"warning"|"error"|"critical", message: string, timestamp?: number }
}
```

### `error`

```typescript
{ type: "error", payload: { error: string } }
```

---

## Client → Server Messages

### `state_sync`

Sent on connect and on reconnect. The client reports its full in-memory state
so the server can issue the appropriate CUD messages to bring the client up to
date. The server must **not** reply with a `state_sync` message; it uses
individual `*_create` / `*_update` / `*_delete` / `parameter_sync` messages
instead.

> **Discussion**: Removing the server→client `state_sync` keeps the protocol
> asymmetric and easier to reason about (server is the source of truth). The
> tradeoff is that the server must orchestrate several messages in response to a
> single request. For most implementations a simple "delete all then re-create"
> strategy is sufficient and avoids diffing complexity.

```typescript
{
  type: "state_sync",
  payload: {
    parameters: Parameter[]               // current client parameters
    actions: Action[]                     // current client actions
    envs: Array<{ id: string, type: string, layers: Array<{ layer_id: string, layer_type: string }> }>
    charts: ChartMetadata[]
  }
}
```

### `parameter_change`

Sent immediately after the user drags a slider or changes a value. The client
optimistically assumes success; if the server rejects it, it replies with
`parameter_sync`.

```typescript
{ type: "parameter_change", payload: { id: string, value: any } }
```

### `action_start`

Replaces `button_click`. The `continuous` flag tells the server whether the
client wants to keep firing the action until it receives `action_end` with
`continue: false`.

```typescript
{
  type: "action_start",
  payload: {
    id: string
    continuous?: boolean   // default false
  }
}
```

### `error`

```typescript
{ type: "error", payload: { error: string } }
```

---

## Simulation Loop Contract

The simulation loop is now **client-driven**:

1. Client sends `action_start` with `continuous: true` (e.g. user presses "Run").
2. Server executes one step and sends `action_end` with `continue: true` (or absent).
3. Client sends the next `action_start` immediately.
4. When the simulation is "done" the server sends `action_end` with `continue: false`.
5. Client stops. The server never needs to maintain its own loop.

Only two action IDs are reserved:

- `init` — initializes the simulation (non-continuous)
- `step` — advances one timestep (used for both "step once" and continuous "run")

All other action IDs are user-defined.

---

## Layer Registry

Layers are extensible via a registry. Each backend registers:

- A unique `layer_type` string.
- Metadata schema (for `env_layer_create`/`env_layer_update` `data` field).
- Agent schema (for `agent_create`/`agent_update`).
- Edge schema (for `edge_create`/`edge_update`), if applicable.

Built-in layer types:

| `layer_type` | Description |
|---|---|
| `grid` | 2-D grid; `data` contains `width`, `height`, `coord_offset`, `background` |
| `graph` | Force-directed graph; `data` contains layout parameters |

---

## Data Types

### Action

```typescript
interface Action {
  id: string;
  label: string;
  continuous?: boolean;
  allowRuntimeChange?: boolean;
}
```

### Parameter

`action` is no longer a parameter type.

```typescript
type ParameterType = "number" | "enum" | "boolean" | "string";

interface Parameter {
  id: string;
  type: ParameterType;
  label: string;
  allowRuntimeChange?: boolean;
  value?: any;
  // type-specific fields unchanged
}
```

### Agent (flat diff form used in `agent_update`)

```typescript
// create / full form
interface Agent {
  id: AgentId;
  color?: string;
  icon?: "arrow" | "circle" | "square" | "triangle";
  size?: number;
  data?: Record<string, any>;
  // layer-specific fields (x, y, heading, …) included inline
}

// update diff — id plus only changed fields, flat
type AgentDiff = { id: AgentId } & Partial<Omit<Agent, "id">>;
```

### ChartGroupMetadata (unchanged from v0.1)

```typescript
interface ChartGroupMetadata {
  id: string; label: string; color?: string;
  dataList?: Array<{ id: string; label: string; color?: string }>;
}
```

---

## References

- [Architecture Documentation](./architecture.md)
- [Roadmap](./roadmap.md)
- [v0.1 Protocol (current)](./protocol.md)
