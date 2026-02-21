# TenSnap WebSocket Protocol v0.2

Draft specification for the redesigned communication protocol.
Supersedes the v0.1 protocol once fully implemented.

## Overview

### Key Design Changes from v0.1

| Concern | v0.1 | v0.2 |
| --- | --- | --- |
| Actions | `action` parameter type + `button_click` | Standalone `Action` entity + `action_start`/`action_end` |
| Simulation loop control | Server manages event loop | Client drives loop via `continuous` flag on `action_start` |
| Environment updates | Monolithic `environment_update` | Fine-grained `env_*` / `env_layer_*` / `agent_*` / `edge_*` |
| Agent batch format | `{ id, data: {...} }` | `{ id, ...diff }` (flat diff) |
| Timestep signaling | `time_step_start` / `time_step_end` | Single `metadata_update` |
| Parameter wire names | `parameter_*` / `parameter_change` | `param_*` / `param_change` (TypeScript types unchanged) |
| Parameter values | client-only `parameter_change` | `param_change` (C→S) + `param_sync` (S→C) |
| State sync direction | Bidirectional | Client→Server only; server replies with CUD messages |
| Asset sharing | none | `asset_meta` / `asset_data` / `asset_delete` (S→C) + `asset_sync` (C→S) |

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

### `param_create`

Register a new parameter control.

```typescript
{ type: "param_create", payload: Parameter }
```

### `param_update`

Update parameter definition (metadata, not value).

```typescript
{ type: "param_update", payload: Parameter }
```

### `param_delete`

Remove a parameter control.

```typescript
{ type: "param_delete", payload: { id: string } }
```

### `param_sync`

Server-initiated value correction. Sent when the server modifies a parameter
value programmatically, or when it rejects the value the client just sent.

```typescript
{ type: "param_sync", payload: { id: string, value: any } }
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

### `asset_meta`

Announces one or more available assets. No binary data is included — the
client should respond with `asset_sync` to request any assets it is missing.

```typescript
{
  type: "asset_meta",
  payload: {
    assets: Array<{ id: string, hash: string, mime: string, size: number, label?: string }>
  }
}
```

### `asset_data`

Delivers the binary data for a single asset. In JSON mode `data` is base-64;
in msgpack mode it is a raw `Uint8Array`.

```typescript
{
  type: "asset_data",
  payload: { id: string, hash: string, mime: string, data: string | Uint8Array }
}
```

### `asset_delete`

Removes one or more assets from the client cache.

```typescript
{ type: "asset_delete", payload: { ids: string[] } }
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

### `param_change`

Sent immediately after the user drags a slider or changes a value. The client
optimistically assumes success; if the server rejects it, it replies with
`param_sync`.

```typescript
{ type: "param_change", payload: { id: string, value: any } }
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

### `asset_sync`

Sent after receiving `asset_meta`. The client reports which assets it already
holds (keyed by id, value is the client's current hash). The server sends
`asset_data` for any asset the client is missing or has stale.

```typescript
{
  type: "asset_sync",
  payload: {
    assets: Record<AssetId, string>   // id → hash the client currently holds
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

Layers are extensible via a registry. The **frontend does not distinguish
between "grid" and "graph" environments** — the distinction lives entirely
inside layer types. An environment is simply a container (`type: "uniform"|"2d"`).
Uniform environments do not require layers. Layers are currently only applicable to 2D environments.

Layer-based designs increase the degrees of freedom in declaring environments. For instance,

- A Schelling segregation model operating within a grid: one agent layer or one background layer rendering a bitmap representing each location
- A Deffuant model operating within a network: one agent layer + one edge layer, with the server not transmitting agent positions, allowing spring layout to control placement autonomously
- A model simulating real-life human interactions + multiple social media identities: one agent layer + multiple edge layers, with the server transmitting agent positions
- A US power grid model: A US map image background layer + an agent layer + an edge layer, with the server transmitting agent positions and edges disabling D3's spring layout via parameters
- A hypergraph: An agent layer + a handwritten hyperedge layer (plugin support currently unnecessary, merely illustrating the concept)

Translated with DeepL.com (free version)

Each layer type registration includes:

| Field | Required | Description |
| --- | --- | --- |
| `layer_type` | ✓ | Unique string identifier |
| Metadata schema | optional | Zod schema for the `data` field in `env_layer_create`/`env_layer_update` |
| Entity schema | optional | Zod schema for entities sent via `agent_create`/`agent_update` and/or `edge_create`/`edge_update`. Use only for layer types that carry large numbers of entities. Scalar/singleton data (e.g. a background image URL) lives in the layer metadata, not as entities. |

### Built-in Layer Types

The layer definitions align with `tensnap-web-core/environment/layers`.

| `layer_type` | Entity kind | Description |
| --- | --- | --- |
| `agent` | agents (optional) | Generic agents carrying `x`, `y`, and optional `heading`. |
| `edge` | edges (optional) | Generic directed or undirected edges (`source` -> `target`).  Agents related to the edge layer may have no fixed positions (layout is computed client-side via `d3-force`). |
| `grid` | — | Reference grid lines overlay; `data` contains spacing/color parameters. No entities. |
| `background` | — | Solid color or image fill; background is stored in layer `data.background` (CSS color, URL, or asset reference `{ asset_id, interpolation }`). No entities. |

### Entity Schema vs. Metadata

- **Metadata** (layer `data` field): use for a small number of scalar values
  or a single image/URL. Always sent whole on `env_layer_update`.
- **Entity schema** (optional registration): use when a layer holds a large,
  growing collection of items (agents, edges, hyperedges, …) that benefit from
  incremental CUD updates. Register the schema at layer type registration time.

### Asset Reference in Layer Data

When a background image comes from the project asset store, set it using:

```typescript
// env_layer_create / env_layer_update data field
{
  background: { asset_id: "my-bg-001", interpolation: "nearest" }
}
```

The client resolves `asset_id` to a blob-URL via the project `AssetStore`.

---

## Asset Protocol

Assets are reusable binary or text resources (PNG/JPEG images, SVGs,
numpy arrays, etc.) shared across layers. They are identified by server-computed
IDs. The client caches assets and avoids re-downloading unchanged ones using
content hashes.

### Lifecycle

```
Server                              Client
  │                                   │
  ├── asset_meta ──────────────────►  │  (announce: id, hash, mime, size)
  │                                   │  (client checks local cache)
  │◄─────────────────── asset_sync ──►│  (client reports held id→hash pairs)
  ├── asset_data ──────────────────►  │  (only missing / stale assets)
  │                                   │
  │  ... asset changes ...            │
  ├── asset_data ──────────────────►  │  (proactive push for updated asset)
  │                                   │
  ├── asset_delete ────────────────►  │  (remove asset from cache)
```

### `asset_meta` (S→C)

```typescript
{
  type: "asset_meta",
  payload: {
    assets: Array<{
      id: string         // server-computed stable id
      hash: string       // first-16-hex-chars of SHA-256
      mime: string       // e.g. "image/png", "image/svg+xml"
      size: number       // byte size
      label?: string
    }>
  }
}
```

### `asset_data` (S→C)

```typescript
{
  type: "asset_data",
  payload: {
    id: string
    hash: string
    mime: string
    data: string | Uint8Array   // base-64 string (JSON) or raw bytes (msgpack)
  }
}
```

### `asset_delete` (S→C)

```typescript
{ type: "asset_delete", payload: { ids: string[] } }
```

### `asset_sync` (C→S)

```typescript
{
  type: "asset_sync",
  payload: {
    assets: Record<string, string>   // id → hash the client currently holds
  }
}
```

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

`action` is no longer a parameter type. Wire-protocol names use `param_*`
(e.g. `param_create`); TypeScript interface names retain the `Parameter` prefix.

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

### AssetMeta

```typescript
interface AssetMeta {
  id: string;
  hash: string;     // first 16 hex chars of SHA-256
  mime: string;
  size: number;
  label?: string;
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
