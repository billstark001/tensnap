# TenSnap Protocol v0.2

Current draft specification for the renderer/simulator protocol and the core-owned Scenario model.

This document is the source of truth for the ongoing refactor. It supersedes the older client/server framing and any package layout that still refers to tensnap-web-core.

---

## Changes from v0.1

Protocol v0.2 restructures v0.1 around the principle that the **renderer owns session state** and the **simulator is a stateless step executor**. The key design changes are:

### Terminology

All references to "client" / "server" are replaced by "renderer" / "simulator" to clarify that the protocol is not tied to a browser/server deployment topology.

### Environment model

v0.1 used a single `environment_update` message embedding agent lists, grid config, edges, and background data within one flat payload. v0.2 separates this into an explicit **environment → layer** hierarchy with dedicated `env_create`, `env_layer_create`, `env_layer_update`, and `env_layer_delete` messages. Each layer has a registered `layer_type` that determines its metadata schema and entity storage.

### Agent and edge lifecycle

v0.1 combined create / update / delete into `agent_update` and `agent_batch_update` with an `operation` discriminator field. v0.2 uses separate `agent_create`, `agent_update`, and `agent_delete` message types. Edges, which were implicit in the environment payload in v0.1, now have their own `edge_create`, `edge_update`, `edge_delete` message family.

### Time and metadata

v0.1 framed time progression with `time_step_start` and `time_step_end` messages. v0.2 collapses both into `metadata_update`, which carries `time` alongside arbitrary scenario-wide metadata.

### Action system

v0.1 used `button_click` to trigger actions. v0.2 introduces a full action lifecycle: `action_create` / `action_update` / `action_delete` for definition, `action_start` (renderer → simulator) and `action_end` (simulator → renderer) for execution. Continuous loops are now **renderer-driven**: the renderer decides whether to send the next `action_start` after receiving `action_end`.

### Parameter management

v0.1 used `parameter_change` and handled parameter definition exclusively through `state_sync`. v0.2 renames this to `param_change` and adds `param_create` / `param_update` / `param_delete` / `param_sync` so the simulator can manage parameter lifecycle incrementally. The `action` parameter type from v0.1 is removed; actions are now a separate concept.

### State synchronization

v0.1 `state_sync` responded with a differential payload (`added_*` / `removed_*` / `updated_*`). v0.2 simplifies this: the renderer sends its current state summary and the simulator replays the necessary `*_create` / `*_update` / `*_delete` messages. No dedicated response message type is needed.

### Chart lifecycle

v0.1 only had `chart_update`. v0.2 adds `chart_create` and `chart_delete` for explicit chart lifecycle management.

### Asset system

v0.2 introduces `asset_meta`, `asset_data`, `asset_delete` (simulator → renderer) and `asset_sync` (renderer → simulator) to support efficient binary asset transfer with content-addressed caching.

### Screenshot capture

v0.2 adds `screenshot_request` (simulator → renderer) and `screenshot_response` (renderer → simulator) to allow the simulator to request rendered image capture from the renderer.

---

## Scope

Protocol v0.2 defines:

- the wire format between a simulator and a renderer
- the canonical message families and payload shapes
- the ownership boundary for state synchronization
- the relationship between transport, protocol, and Scenario

Protocol v0.2 does not define:

- a specific WebSocket implementation
- browser-specific state stores
- React, Zustand, or view/project UI details

Those concerns sit above the protocol layer.

---

## Package Ownership

The refactor moves protocol and scenario ownership into @tensnap/core.

### `@tensnap/core`

- canonical protocol types, schemas, and codecs
- transport abstraction interfaces
- Scenario state model
- layer registry for scenario-layer semantics
- rendering primitives shared by renderer implementations

### `@tensnap/web`

- browser renderer application
- project/view management
- WebSocket transport implementation for browser mode
- UI state management and component integration

### Future simulator-side or agent-side packages

- concrete transport implementations outside the browser
- simulator runtime bindings
- protocol usage on the non-renderer side

---

## Naming

Protocol v0.2 uses renderer/simulator terminology.

| Old term | New term |
| --- | --- |
| client | renderer |
| server | simulator |
| server → client | simulator → renderer |
| client → server | renderer → simulator |

Deprecated compatibility aliases may still exist temporarily in TypeScript exports while the web package finishes migrating, but they are not normative for new code or documentation.

---

## Architectural Model

### Scenario ownership

Scenario is owned by the renderer.

The simulator is the authoritative producer of simulation updates, but the renderer maintains an in-memory Scenario instance representing the synchronized view of simulator state.

Scenario in @tensnap/core is intentionally:

- transport-agnostic
- UI-framework-agnostic
- EventTarget-based
- state-oriented rather than rendering-object-oriented

Scenario does not own Leafer instances, DOM nodes, React state, or Zustand stores.

### Rendering ownership

Rendering objects live outside Scenario.

Renderer code subscribes to Scenario events and maps Scenario state into rendering layers, charts, asset usage, and project UI.

### Transport ownership

@tensnap/core exposes transport interfaces only.

Concrete implementations such as browser WebSocket transports belong in consumer packages like @tensnap/web or a future node-side package.

---

## Encoding

- transport: persistent bidirectional stream, typically WebSocket
- serialization: JSON or MessagePack
- envelope shape: identical across encodings

JSON is used for text transports and debugging.

MessagePack is used for more efficient binary transport, especially when payloads include typed binary content such as asset data.

---

## Envelope

Every protocol message uses the same envelope shape:

```typescript
{
  type: string;
  payload: unknown;
  timestamp?: number;
}
```

- `type` identifies the message family
- `payload` is validated against the schema for that family
- `timestamp` is optional and transport-neutral

---

## Message Directions

### Simulator → Renderer

These messages mutate renderer-side Scenario state.

```typescript
type SimulatorToRendererMessageType =
  | 'metadata_update'
  | 'action_end'
  | 'action_create'
  | 'action_update'
  | 'action_delete'
  | 'env_create'
  | 'env_delete'
  | 'env_layer_create'
  | 'env_layer_update'
  | 'env_layer_delete'
  | 'agent_create'
  | 'agent_update'
  | 'agent_delete'
  | 'edge_create'
  | 'edge_update'
  | 'edge_delete'
  | 'param_create'
  | 'param_update'
  | 'param_delete'
  | 'param_sync'
  | 'chart_create'
  | 'chart_update'
  | 'chart_delete'
  | 'asset_meta'
  | 'asset_data'
  | 'asset_delete'
  | 'screenshot_request'
  | 'log'
  | 'error';
```

### Renderer → Simulator

These messages express renderer intent or state summary.

```typescript
type RendererToSimulatorMessageType =
  | 'state_sync'
  | 'param_change'
  | 'action_start'
  | 'asset_sync'
  | 'screenshot_response'
  | 'error';
```

---

## Simulator → Renderer Messages

### `metadata_update`

Carries scenario-wide metadata, including time.

```typescript
{
  type: 'metadata_update',
  payload: {
    time?: number;
    [key: string]: unknown;
  }
}
```

This replaces the older split between time_step_start and time_step_end.

### `action_create` / `action_update` / `action_delete`

Registers and maintains renderer-visible actions.

```typescript
interface Action {
  id: string;
  label: string;
  continuous?: boolean;
  allowRuntimeChange?: boolean;
}
```

`action_delete` uses:

```typescript
{ type: 'action_delete', payload: { id: string } }
```

### `action_end`

Signals completion of a simulator action execution.

```typescript
{
  type: 'action_end',
  payload: {
    id: string;
    continue?: boolean;
  }
}
```

When a renderer started a continuous action loop, explicit `continue: false` stops the loop. Any other value means the renderer may continue.

### `env_create` / `env_delete`

Creates or deletes a scenario environment container.

```typescript
{
  type: 'env_create',
  payload: {
    id: string;
    type: 'uniform' | '2d';
  }
}
```

`2d` covers both grid-like and graph-like spatial scenes. The actual rendering semantics are expressed through layers.

### `env_layer_create` / `env_layer_update` / `env_layer_delete`

Creates and updates environment-local layers.

```typescript
{
  type: 'env_layer_create',
  payload: {
    env_id: string;
    layer_id: string;
    layer_type: string;
    data?: Record<string, unknown>;
  }
}
```

```typescript
{
  type: 'env_layer_update',
  payload: {
    env_id: string;
    layer_id: string;
    data: Record<string, unknown>;
  }
}
```

```typescript
{
  type: 'env_layer_delete',
  payload: {
    env_id: string;
    layer_id: string;
  }
}
```

Layer metadata is whole-object metadata, not incremental entity diffs.

### `agent_create` / `agent_update` / `agent_delete`

Creates and updates agent entities within a layer.

```typescript
{
  type: 'agent_create',
  payload: {
    env_id: string;
    layer_id: string;
    agents: Agent[];
  }
}
```

```typescript
{
  type: 'agent_update',
  payload: {
    env_id: string;
    layer_id: string;
    agents: Array<{ id: AgentId; [field: string]: unknown }>;
  }
}
```

```typescript
{
  type: 'agent_delete',
  payload: {
    env_id: string;
    layer_id: string;
    ids: AgentId[];
  }
}
```

The update form is a flat diff keyed by `id`.

### `edge_create` / `edge_update` / `edge_delete`

Creates and updates edge entities within a layer.

```typescript
{
  type: 'edge_create',
  payload: {
    env_id: string;
    layer_id: string;
    edges: EdgeData[];
  }
}
```

```typescript
{
  type: 'edge_update',
  payload: {
    env_id: string;
    layer_id: string;
    edges: Array<{ source: AgentId; target: AgentId; [field: string]: unknown }>;
  }
}
```

```typescript
{
  type: 'edge_delete',
  payload: {
    env_id: string;
    layer_id: string;
    edges: Array<{ source: AgentId; target: AgentId }>;
  }
}
```

The identity key is currently `(source, target)`.

### `param_create` / `param_update` / `param_delete`

Registers and maintains renderer-visible parameters.

`param_create` and `param_update` both carry a full `Parameter` object.

```typescript
{ type: 'param_delete', payload: { id: string } }
```

### `param_sync`

Pushes a simulator-side value correction to the renderer.

```typescript
{
  type: 'param_sync',
  payload: {
    id: string;
    value: unknown;
  }
}
```

This is the simulator-to-renderer correction path after optimistic renderer-side edits.

### `chart_create` / `chart_update` / `chart_delete`

Registers and mutates charts.

`chart_create` carries `ChartGroupMetadata`.

`chart_update` carries incremental data and operations:

```typescript
{
  type: 'chart_update',
  payload: {
    updates?: Array<{ id: string; time?: number; value: unknown }>;
    operations?: Array<{ id: string; operation: 'clear' }>;
  }
}
```

`chart_delete` uses:

```typescript
{ type: 'chart_delete', payload: { id: string } }
```

### `asset_meta` / `asset_data` / `asset_delete`

Maintains the renderer-side asset cache.

`asset_meta` announces asset descriptors without sending bytes.

```typescript
{
  type: 'asset_meta',
  payload: {
    assets: Array<{
      id: string;
      hash: string;
      mime: string;
      size: number;
      label?: string;
    }>;
  }
}
```

`asset_data` sends bytes for one asset.

```typescript
{
  type: 'asset_data',
  payload: {
    id: string;
    hash: string;
    mime: string;
    data: string | Uint8Array;
  }
}
```

JSON mode uses base64 strings. MessagePack mode uses raw bytes.

`asset_delete` removes cached assets.

```typescript
{ type: 'asset_delete', payload: { ids: string[] } }
```

### `log`

Diagnostic log event.

```typescript
{
  type: 'log',
  payload: {
    message: string;
    level?: 'debug' | 'info' | 'warning' | 'error' | 'critical';
    target?: string;
    timestamp?: number;
    data?: unknown;
  }
}
```

### `error`

Protocol-level or runtime error.

```typescript
{ type: 'error', payload: { error: string } }
```

### `screenshot_request`

Requests a rendered image capture from the renderer.

The `request_id` is maintained by the simulator. The renderer does not validate uniqueness.

```typescript
{
  type: 'screenshot_request',
  payload: {
    request_id: string;
    env_id?: string;
    chart_id?: string;
    format?: 'png' | 'jpeg';
    quality?: number;
  }
}
```

Exactly one of `env_id` or `chart_id` should be specified to identify the capture target.

`format` defaults to `'png'`. `quality` is a `0`–`1` hint used only for `'jpeg'`.

---

## Renderer → Simulator Messages

### `state_sync`

Sent by the renderer when connecting or reconnecting.

It describes the renderer's current in-memory state summary so the simulator can decide what to recreate, update, or delete.

```typescript
{
  type: 'state_sync',
  payload: {
    parameters: Parameter[];
    actions: Action[];
    envs: Array<{
      id: string;
      type: string;
      layers: Array<{ layer_id: string; layer_type: string }>;
    }>;
    charts: ChartMetadata[];
  }
}
```

The simulator does not answer with a reverse `state_sync`. It replies by emitting the corresponding create, update, and delete messages.

### `param_change`

Signals a renderer-side parameter edit.

```typescript
{ type: 'param_change', payload: { id: string; value: unknown } }
```

### `action_start`

Starts one action execution.

```typescript
{
  type: 'action_start',
  payload: {
    id: string;
    continuous?: boolean;
  }
}
```

`continuous` requests a renderer-driven loop rather than a simulator-owned loop.

### `asset_sync`

Reports the renderer's currently held asset hashes.

```typescript
{
  type: 'asset_sync',
  payload: {
    assets: Record<string, string>;
  }
}
```

### `error`

Renderer-to-simulator error report.

```typescript
{ type: 'error', payload: { error: string } }
```

### `screenshot_response`

Returns a captured image to the simulator.

```typescript
{
  type: 'screenshot_response',
  payload: {
    request_id: string;
    data?: string | Uint8Array;
    mime?: string;
    error?: string;
  }
}
```

If the renderer supports the requested screenshot, `data` contains the image bytes and `mime` indicates the content type. JSON mode uses base64-encoded strings; MessagePack mode uses raw `Uint8Array`.

If the renderer does not support the request, `data` is omitted and `error` describes the reason.

---

## Simulation Loop Contract

Protocol v0.2 makes continuous execution renderer-driven.

Sequence:

1. Renderer sends `action_start` with `continuous: true`.
2. Simulator executes one step.
3. Simulator sends all resulting state mutations.
4. Simulator sends `action_end`.
5. Renderer decides whether to send the next `action_start`.

The stop condition is `action_end` with `continue: false`.

This keeps the simulator simpler:

- no long-running implicit event loop in the transport layer
- explicit step boundaries on the wire
- easier reconnection and renderer ownership of playback semantics

Reserved action ids:

- `init`
- `step`

All other action ids are application-defined.

---

## Layer Registry

Layer semantics are defined by a registry in @tensnap/core/scenario.

Each layer type may declare:

- `layer_type`
- optional metadata schema
- optional entity schema
- optional entity diff schema
- whether it owns agents
- whether it owns edges

Built-in registrations currently include:

- `agent` — owns agents; metadata includes `width`, `height`, `coord_offset`, `trajectory_length`, `trajectory_color`
- `edge` — owns edges; metadata includes force-layout parameters (`linkDistance`, `chargeStrength`, etc.) and an optional `agent_layer_id` referencing the associated agent layer
- `grid` — grid coordinate frame; metadata includes `xOrigin`, `xUnit`, `xInterval`, `xRatio`, `yOrigin`, `yUnit`, `yInterval`, `yRatio`, `strokeColor`
- `background` — background image layer; metadata includes `background` (hex string, `Uint8Array`, or `{ asset_id, interpolation? }`) and `interpolation` (`'nearest'` | `'linear'`)

The registry is used to validate scenario-layer payloads independently of the transport implementation.

---

## Asset References in Layer Metadata

Layer metadata may reference assets indirectly rather than embedding raw bytes.

Example:

```typescript
{
  background: {
    asset_id: 'background-001',
    interpolation: 'nearest'
  }
}
```

The renderer resolves `asset_id` through its asset cache.

---

## Core Data Types

### AgentId

```typescript
type AgentId = string | number;
```

### AgentIcon

```typescript
type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';
```

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

```typescript
type ParameterType = 'number' | 'enum' | 'boolean' | 'string';
```

`action` is no longer a parameter type.

```typescript
interface NumberParameter {
  id: string;
  type: 'number';
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  allowRuntimeChange?: boolean;
}

interface EnumParameter {
  id: string;
  type: 'enum';
  label: string;
  value: string;
  options: string[];
  labels?: Record<string, string>;
  allowRuntimeChange?: boolean;
}

interface BooleanParameter {
  id: string;
  type: 'boolean';
  label: string;
  value: boolean;
  allowRuntimeChange?: boolean;
}

interface StringParameter {
  id: string;
  type: 'string';
  label: string;
  value: string;
  allowRuntimeChange?: boolean;
}

type Parameter = NumberParameter | EnumParameter | BooleanParameter | StringParameter;
```

### Agent

Agent create payloads use full records. Agent update payloads are flat diffs keyed by `id`.

```typescript
interface Agent {
  id: AgentId;
  color?: string;
  icon?: AgentIcon;
  size?: number;
  data?: Record<string, unknown>;
  [layerSpecificField: string]: unknown;
}
```

### EdgeData

```typescript
interface EdgeData {
  source: AgentId;
  target: AgentId;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
  [key: string]: unknown;
}
```

### ChartMetadata

```typescript
interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}
```

### ChartGroupMetadata

```typescript
interface ChartGroupMetadata extends ChartMetadata {
  dataList?: ChartMetadata[];
}
```

### ChartUpdateData

```typescript
interface ChartUpdateData {
  id: string;
  time?: number;
  value: unknown;
}
```

### AssetMeta

```typescript
interface AssetMeta {
  id: string;
  hash: string;
  mime: string;
  size: number;
  label?: string;
}
```

### ScreenshotRequestPayload

```typescript
interface ScreenshotRequestPayload {
  request_id: string;
  env_id?: string;
  chart_id?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
}
```

### ScreenshotResponsePayload

```typescript
interface ScreenshotResponsePayload {
  request_id: string;
  data?: string | Uint8Array;
  mime?: string;
  error?: string;
}
```

---

## Implementation Notes

The current refactor state is:

- protocol types and schemas live in @tensnap/core
- protocol codecs support both JSON and MessagePack
- Scenario lives in @tensnap/core and extends EventTarget
- transport is abstracted in @tensnap/core
- browser WebSocket integration remains in @tensnap/web during the next migration phase
- screenshot capture registry lives in @tensnap/web's ScenarioStore; rendering components register their capture functions via `registerScreenshotCapture`

Temporary compatibility exports may remain in TypeScript for older server/client naming, but new code should use renderer/simulator names exclusively.

---

## References

- [architecture.md](./architecture.md)
- [roadmap.md](./roadmap.md)
- [protocol.md](./protocol-v0.1.md)
