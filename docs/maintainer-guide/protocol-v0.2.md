# TenSnap Protocol v0.2

Current draft specification for the renderer/simulator protocol and the core-owned Scenario model.  This document is the source of truth for the ongoing refactor, and it supersedes the older client/server framing and any package layout that still refers to `@tensnap/core` package.

## Scope

Protocol v0.2 restructures v0.1 around one core principle: the **renderer owns session state** and the **simulator is a stateless step executor**.

### Changes from v0.1

All references to `client` / `server` are replaced by `renderer` / `simulator` so the protocol is no longer described in browser/server deployment terms.

In v0.1, a single `environment_update` message embedded agent lists, grid config, edges, and background data in one flat payload.  In v0.2, this becomes an explicit `environment -> layer` hierarchy with dedicated `env_create`, `env_layer_create`, `env_layer_update`, and `env_layer_delete` messages, and each layer uses a registered `layer_type` that defines its metadata schema and entity storage.

In v0.1, agent and edge lifecycle were mixed into `agent_update` and `agent_batch_update` with an `operation` discriminator.  In v0.2, all layer-entity lifecycle is normalized through `item_create`, `item_update`, and `item_delete`, and legacy `agent_*` / `edge_*` message families are removed.

In v0.1, time progression used `time_step_start` and `time_step_end`.  In v0.2, both are collapsed into `metadata_update`, which carries `time` plus arbitrary scenario-wide metadata.

In v0.1, actions were triggered through `button_click`.  In v0.2, actions have a full lifecycle: `action_create`, `action_update`, and `action_delete` define actions; `action_start` flows from renderer to simulator; and `action_end` flows from simulator to renderer.  Continuous loops are now renderer-driven, meaning the renderer decides whether to send the next `action_start` after receiving `action_end`.

In v0.1, parameter edits used `parameter_change`, and parameter definitions were handled only through `state_sync`.  In v0.2, this becomes `param_change`, with incremental lifecycle messages `param_create`, `param_update`, `param_delete`, and `param_sync`.  The old `action` parameter type is removed because actions are now a separate concept.

In v0.1, `state_sync` replied with a differential payload such as `added_*`, `removed_*`, and `updated_*`.  In v0.2, the renderer sends a current state summary, and the simulator replays the required `*_create`, `*_update`, and `*_delete` messages.  That replay is explicitly bracketed by `state_sync_begin` and `state_sync_end`, so initial sync and reconnect can be treated as a transaction instead of inferred from timing gaps.

In v0.1, charts only used `chart_update`.  In v0.2, charts gain explicit lifecycle management through `chart_create` and `chart_delete`.

v0.2 also introduces an asset system with `asset_meta`, `asset_data`, and `asset_delete` from simulator to renderer, plus `asset_sync` from renderer to simulator, so binary assets can be transferred efficiently with content-addressed caching.

v0.2 further adds screenshot capture through `screenshot_request` from simulator to renderer and `screenshot_response` from renderer to simulator.

### What v0.2 defines

Protocol v0.2 defines the wire format between a simulator and a renderer, the canonical message families and payload shapes, the ownership boundary for state synchronization, and the relationship between transport, protocol, and Scenario.

Protocol v0.2 does not define a specific WebSocket implementation, browser-specific state stores, or React, Zustand, or project/view UI details.  Those concerns sit above the protocol layer.

### Package ownership

The refactor moves protocol and scenario ownership into `@tensnap/core`.

`@tensnap/core` owns the canonical protocol types, schemas, and codecs; transport abstraction interfaces; the Scenario state model; the layer registry for scenario-layer semantics; and rendering primitives shared by renderer implementations.

`@tensnap/web` owns the browser renderer application, project/view management, the browser-mode WebSocket transport implementation, and UI state management with component integration.

Future simulator-side or agent-side packages will own concrete transport implementations outside the browser, simulator runtime bindings, and non-renderer-side protocol usage.

### Naming

Protocol v0.2 uses renderer/simulator terminology.  The TypeScript surface now follows those canonical names directly; older client/server and `*CUPayload` compatibility aliases are not part of the v0.2 contract.

| Old term   | New term   |
| --- | --- |
| client   | renderer   |
| server   | simulator   |
| server -> client   | simulator -> renderer   |
| client -> server   | renderer -> simulator   |

### Architectural model

Scenario is owned by the renderer.  The simulator is the authoritative producer of simulation updates, but the renderer maintains an in-memory Scenario instance representing the synchronized view of simulator state.

Scenario in `@tensnap/core` is intentionally transport-agnostic, UI-framework-agnostic, `EventTarget`-based, and state-oriented rather than rendering-object-oriented.  Scenario does not own Leafer instances, DOM nodes, React state, or Zustand stores.

Rendering objects live outside Scenario.  Renderer code subscribes to Scenario events and maps Scenario state into rendering layers, charts, asset usage, and project UI.

`@tensnap/core` exposes transport interfaces only.  Concrete transport implementations, such as browser WebSocket transports, belong in consumer packages like `@tensnap/web` or a future node-side package.

### Implementation notes

The current refactor state is that protocol types and schemas live in `@tensnap/core`, protocol codecs support both JSON and MessagePack, Scenario lives in `@tensnap/core` and extends `EventTarget`, and transport is abstracted in `@tensnap/core`.

Browser WebSocket integration remains in `@tensnap/web` during the next migration phase.  The screenshot capture registry currently lives in `@tensnap/web`'s `ScenarioStore`, and rendering components register their capture functions through `registerScreenshotCapture`.

Protocol payloads reference parameter, action, chart, and asset owner types from their owning modules.  The protocol layer no longer re-exports compatibility names or alternate access paths for those owner types.

## Data Types

This section organizes the protocol’s core data types by where they sit in the system: environments contain layers, layers hold items and metadata, parameters and actions expose runtime controls, charts expose time-series or grouped outputs, and Scenario is the renderer-owned state container that ties them together.

### Environment

An environment is the top-level simulation container inside Scenario.  It is created and deleted through protocol messessages, and its `type` is currently `'uniform' | '2d'`, where `2d` covers both grid-like and graph-like spatial scenes and actual rendering semantics come from layers rather than from the environment type itself.  

The environment shape on the wire is defined by `env_create` and by the Scenario environment state types.

```typescript
{
  type: 'env_create',
  payload: {
    id: string;
    type: 'uniform' | '2d';
  }
}
```

Renderer-owned Scenario environment state and snapshot types are defined as follows.

```typescript
interface ScenarioEnvironmentState {
  id: string;
  type: 'uniform' | '2d';
  layers: Map<string, ScenarioLayerState>;
  dependencyGraph: Map<string, Set<string>>;
}

interface ScenarioEnvironmentSnapshot {
  id: string;
  type: 'uniform' | '2d';
  layers: ScenarioLayerSnapshot[];
}
```

`ScenarioEnvironmentState` is the live in-memory representation, while `ScenarioEnvironmentSnapshot` is the serializable form used when a snapshot is needed.

### Layer

A layer is an environment-local unit of metadata plus storage.  Layer semantics are defined by a registry in `@tensnap/core/scenario`, and the registry determines metadata schema, item schema, primary keys, and dependency requirements independently of transport implementation.

Layers are created with a fixed topology and optional metadata.

```typescript
{
  type: 'env_layer_create',
  payload: {
    env_id: string;
    layer_id: string;
    layer_type: string;
    dependency_layer_ids?: Record<string, string>;
    data?: Record<string, unknown>;
  }
}
```

Layers are updated by replacing layer metadata as a whole object rather than by sending incremental entity diffs.

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

Layers are deleted by environment id and layer id.

```typescript
{
  type: 'env_layer_delete',
  payload: {
    env_id: string;
    layer_id: string;
  }
}
```

`dependency_layer_ids` is create-time layer topology, not mutable metadata.  If a layer needs different dependencies, the simulator must recreate that layer, or replace the whole environment, instead of using `env_layer_update`.

The live and snapshot layer representations inside Scenario are as follows.

```typescript
interface ScenarioStorage {
  dump(): unknown;
  load(snapshot: unknown): void;
}

interface ScenarioLayerState {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  storage: ScenarioStorage;
  dependencyLayerIds: Record<string, string>;
}

interface ScenarioLayerSnapshot {
  id: string;
  layerType: string;
  metadata: Record<string, unknown>;
  dependencyLayerIds: Record<string, string>;
  storageSnapshot: unknown;
}
```

`ScenarioLayerState` is the live layer object with storage, and `ScenarioLayerSnapshot` is the serializable form that stores a `storageSnapshot` instead of live storage.

#### Layer-owned items

Items belong to layers, and their schema plus primary key are determined by the registry entry for the layer’s `layer_type`.  Item lifecycle is unified across built-in and custom layers through `item_create`, `item_update`, and `item_delete`.

```typescript
{
  type: 'item_create',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown>>;
  }
}
```

```typescript
{
  type: 'item_update',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown>>;
  }
}
```

```typescript
{
  type: 'item_delete',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown> | string | number>;
  }
}
```

For built-in layers, `agent` items are keyed by `id`, `edge` items are keyed by `(source, target)`, and `trajectory` items are keyed by `id`.  Single-key layers such as `agent` and `trajectory` may delete by primitive id, while multi-key layers such as `edge` delete by object keys matching the registry primary key fields.  In v0.2, agent and edge entities are synchronized only through item operations.

#### Built-in layer registry

The built-in registry definitions are as follows.

```typescript
interface AgentLayerMetadata {
  width?: number;
  height?: number;
  coord_offset?: 'int' | 'float';
  z_index?: number;
  [key: string]: unknown;
}

interface AgentDiff {
  id: AgentId;
  [key: string]: unknown;
}

interface EdgeLayerMetadata {
  link_distance?: number;
  charge_strength?: number;
  centering_strength?: number;
  collision_radius?: number;
  max_component_distance?: number;
  component_spacing?: number;
  z_index?: number;
  [key: string]: unknown;
}

interface EdgeDiff {
  source: AgentId;
  target: AgentId;
  [key: string]: unknown;
}

interface TrajectoryLayerMetadata {
  length?: number;
  width?: number;
  color?: string;
  z_index?: number;
  [key: string]: unknown;
}

interface TrajectoryConfig {
  id: AgentId;
  length?: number;
  width?: number;
  color?: string;
  [key: string]: unknown;
}

interface TrajectoryConfigDiff {
  id: AgentId;
  [key: string]: unknown;
}

interface GridLayerMetadata {
  width?: number;
  height?: number;
  x_origin?: number;
  x_unit?: number;
  x_interval?: number;
  x_ratio?: number;
  y_origin?: number;
  y_unit?: number;
  y_interval?: number;
  y_ratio?: number;
  stroke_color?: string;
  z_index?: number;
  [key: string]: unknown;
}

type BackgroundAssetReference = {
  asset_id: string;
  interpolation?: 'nearest' | 'linear';
};

type BackgroundSource = string | Uint8Array | BackgroundAssetReference;

interface BackgroundLayerMetadata {
  background?: BackgroundSource;
  interpolation?: 'nearest' | 'linear';
  z_index?: number;
  [key: string]: unknown;
}

type BuiltinLayerRegistry = {
  agent: {
    metadata: AgentLayerMetadata;
    item: Agent;
    itemDiff: AgentDiff;
    primaryKeyFields: ['id'];
  };
  edge: {
    metadata: EdgeLayerMetadata;
    item: EdgeData;
    itemDiff: EdgeDiff;
    primaryKeyFields: ['source', 'target'];
    requiredDependencyLayerTypes: ['agent'];
  };
  trajectory: {
    metadata: TrajectoryLayerMetadata;
    item: TrajectoryConfig;
    itemDiff: TrajectoryConfigDiff;
    primaryKeyFields: ['id'];
    requiredDependencyLayerTypes: ['agent'];
  };
  grid: {
    metadata: GridLayerMetadata;
  };
  background: {
    metadata: BackgroundLayerMetadata;
  };
};
```

The registry validates scenario-layer payloads independently of transport.  It also captures dependency rules such as `edge` and `trajectory` requiring an `agent` layer.

#### Canonical `z_index` behavior

`z_index` is interpreted as a layer-level render order override.  Lower values render first (behind), higher values render later (in front).

- `background`: default `0`
- `grid`: default `10`
- `edge`: default `20`
- `trajectory`: default `30` (then `31`, `32`, ... for additional trajectory layers without explicit `z_index`)
- `agent`: default `40` (then `41`, `42`, ... for additional agent layers without explicit `z_index`)

Implementation notes:

- `z_index` is resolved before a layer is added to the view so Leafer child order is deterministic.
- Explicit `z_index` on any built-in layer type (`background`, `grid`, `edge`, `trajectory`, `agent`) must be honored.
- If `z_index` is omitted, fallback ordering above is applied consistently.

#### Built-in item types

The layer registry depends on these shared item types.

```typescript
type AgentId = string | number;

type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

interface Agent {
  id: AgentId;
  color?: string;
  icon?: AgentIcon;
  size?: number;
  data?: Record<string, unknown>;
  [layerSpecificField: string]: unknown;
}

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

Agent create payloads use full records, while agent update payloads are flat diffs keyed by `id`.

#### Asset references inside layer metadata

Layer metadata may reference assets indirectly instead of embedding raw bytes.  A background layer can, for example, point to an asset by `asset_id`, and the renderer resolves that id through its asset cache.

```typescript
{
  background: {
    asset_id: 'background-001',
    interpolation: 'nearest'
  }
}
```

Bare base64 strings are reserved for semantic binary transport fields such as `asset_data.data` and `screenshot_response.data`.  Layer metadata should therefore use explicit URLs, data URLs, typed bytes, or asset references instead of heuristic base64 strings.

### Parameter

Parameters are renderer-visible controls managed incrementally by the simulator.  They are no longer bundled only through sync, and the old `action` parameter type is removed because actions are now separate from parameters.

The parameter type system is defined as follows.

```typescript
type ParameterType = 'number' | 'enum' | 'boolean' | 'string';

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

Parameters sit at the control boundary between renderer and simulator.  The simulator defines and updates them through `param_create`, `param_update`, and `param_delete`; the renderer edits them through `param_change`; and the simulator can correct renderer-side optimistic values through `param_sync`.

### Action

Actions are renderer-visible commands that trigger simulator execution.  Unlike parameters, they define executable behavior rather than persistent editable values.

The action type is defined as follows.

```typescript
interface Action {
  id: string;
  label: string;
  continuous?: boolean;
  allowRuntimeChange?: boolean;
}
```

Actions are defined and maintained through `action_create`, `action_update`, and `action_delete`.  They are executed through `action_start` from renderer to simulator and completed through `action_end` from simulator to renderer.  Continuous execution is renderer-driven, so the renderer decides whether to dispatch the next step after each `action_end`.

### Chart

Charts are renderer-visible outputs managed with explicit lifecycle messages.  v0.2 treats chart existence and chart data separately, so metadata and data flow are not conflated.

The chart-related types are defined as follows.

```typescript
interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}

interface ChartGroupMetadata extends ChartMetadata {
  dataList?: ChartMetadata[];
}

interface ChartUpdateData {
  id: string;
  time?: number;
  value: unknown;
}
```

`chart_create` carries `ChartGroupMetadata`, while `chart_update` carries incremental data points and operations such as `clear`.  `chart_delete` removes a chart by id.

### Supporting payload types

Assets and screenshots are not part of Scenario’s structural hierarchy, but they are first-class protocol data types used by renderer and simulator.

```typescript
interface AssetMeta {
  id: string;
  hash: string;
  mime: string;
  size: number;
  label?: string;
}

interface ScreenshotRequestPayload {
  request_id: string;
  env_id?: string;
  chart_id?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
}

interface ScreenshotResponsePayload {
  request_id: string;
  data?: string | Uint8Array;
  mime?: string;
  error?: string;
}
```

Assets support cacheable binary resources, while screenshot payloads support renderer-generated capture results returned to the simulator.

### Scenario

Scenario is the renderer-owned in-memory state model in `@tensnap/core`.  It is transport-agnostic, UI-framework-agnostic, `EventTarget`-based, and state-oriented rather than rendering-object-oriented.

Scenario does not own DOM nodes, Leafer instances, React state, or Zustand stores.  Instead, renderer code subscribes to Scenario events and maps Scenario state into rendering layers, charts, asset usage, and project UI.

The Scenario-related live and snapshot types are the environment and layer state types shown above, together with `ScenarioStorage`.  That division means Scenario can store live mutable state while still supporting snapshot-oriented dump/load behavior where needed.

#### Scenario update loop

A complete Scenario update cycle works like this: the renderer connects or reconnects and sends `state_sync` with its current in-memory summary; the simulator replies by replaying the needed `*_create`, `*_update`, and `*_delete` messages between `state_sync_begin` and `state_sync_end`; the renderer applies those messages to its Scenario instance; and renderer-side subscribers then update rendering and UI from Scenario events.

During ordinary runtime, scenario-wide metadata arrives through `metadata_update`; environment and layer structure changes arrive through `env_*` and `env_layer_*`; item mutations arrive through `item_*`; control definitions arrive through `param_*` and `action_*`; chart changes arrive through `chart_*`; and asset cache changes arrive through `asset_*`.

When execution is action-driven, the renderer sends `action_start`, the simulator advances one step and emits state mutations, then the simulator emits `action_end`, and the renderer decides whether to dispatch the next action step when the action is continuous.  This keeps playback ownership in the renderer while keeping the simulator as a step executor rather than a session-state owner.

## Communication Protocol

Protocol v0.2 uses a persistent bidirectional stream, typically WebSocket, and supports JSON or MessagePack serialization with the same envelope shape in either encoding.  JSON is intended for text transports and debugging, while MessagePack is intended for more efficient binary transport, especially when payloads include typed binary content such as asset data.

For semantic binary fields, encoding is field-specific rather than wrapper-based.  In MessagePack mode, `asset_data.payload.data` and `screenshot_response.payload.data` carry raw binary bytes, while in JSON mode they carry base64 data URLs so decoders can normalize them back into `Uint8Array` values without heuristic guessing.

### Envelope

Every protocol message uses the same envelope shape.

```typescript
{
  type: string;
  payload: unknown;
  timestamp?: number;
}
```

`type` identifies the message family, `payload` is validated against the schema for that family, and `timestamp` is optional and transport-neutral.

### Message type definitions

The simulator-to-renderer message family is defined as follows.

```typescript
type SimulatorToRendererMessageType =
  | 'metadata_update'
  | 'state_sync_begin'
  | 'state_sync_end'
  | 'action_end'
  | 'action_create'
  | 'action_update'
  | 'action_delete'
  | 'env_create'
  | 'env_delete'
  | 'env_layer_create'
  | 'env_layer_update'
  | 'env_layer_delete'
  | 'item_create'
  | 'item_update'
  | 'item_delete'
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

These messages mutate renderer-side Scenario state or interact with renderer-side facilities such as screenshots, diagnostics, and asset caching.

The renderer-to-simulator message family is defined as follows.

```typescript
type RendererToSimulatorMessageType =
  | 'state_sync'
  | 'param_change'
  | 'action_start'
  | 'asset_sync'
  | 'screenshot_response'
  | 'error';
```

These messages express renderer intent, renderer state summary, or renderer-generated output.

### Simulator -> renderer messages

#### `metadata_update`

`metadata_update` carries scenario-wide metadata, including time.

```typescript
{
  type: 'metadata_update',
  payload: {
    time?: number;
    [key: string]: unknown;
  }
}
```

This replaces the older split between `time_step_start` and `time_step_end`.

#### `state_sync_begin` / `state_sync_end`

These messages bracket a simulator replay triggered by `state_sync`.

```typescript
{
  type: 'state_sync_begin' | 'state_sync_end',
  payload: {
    request_id?: string;
  }
}
```

When present, `request_id` is generated by the renderer, and simulators should echo it verbatim so reconnect and initial-sync transactions can be correlated without making Scenario aware of transport session state.

#### `action_create` / `action_update` / `action_delete`

These messages register and maintain renderer-visible actions.  `action_create` and `action_update` carry full `Action` objects, while `action_delete` removes an action by id.

```typescript
{ type: 'action_delete', payload: { id: string } }
```

#### `action_end`

`action_end` signals completion of one simulator action execution.

```typescript
{
  type: 'action_end',
  payload: {
    id: string;
    tick_id?: string;
    continue?: boolean;
    timings?: {
      simulate_ms?: number;
      communicate_ms?: number;
      render_ms?: number;
      [key: string]: number | undefined;
    };
  }
}
```

When a renderer started a continuous action loop, explicit `continue: false` stops the loop, and any other value means the renderer may continue.  `tick_id` is renderer-generated when the action was dispatched by a runtime that tracks in-flight ticks, and simulators should echo it back untouched.  `timings` is additive and optional, intended for per-tick instrumentation, and may be partially populated by either side.

#### `env_create` / `env_delete`

These messages create or delete a scenario environment container.

```typescript
{
  type: 'env_create',
  payload: {
    id: string;
    type: 'uniform' | '2d';
  }
}
```

`2d` covers both grid-like and graph-like spatial scenes, while rendering semantics are expressed through layers.

#### `env_layer_create` / `env_layer_update` / `env_layer_delete`

These messages create, update, and delete environment-local layers.

```typescript
{
  type: 'env_layer_create',
  payload: {
    env_id: string;
    layer_id: string;
    layer_type: string;
    dependency_layer_ids?: Record<string, string>;
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

`dependency_layer_ids` is fixed topology and not mutable metadata.  If dependencies must change, the simulator should recreate the layer, or replace the enclosing environment, instead of sending `env_layer_update`.  Layer metadata is treated as whole-object metadata rather than incremental entity diffs.

#### `item_create` / `item_update` / `item_delete`

These messages create and update layer-owned items within a layer.  The exact item schema and primary key come from the layer registry entry for that `layer_type`.

```typescript
{
  type: 'item_create',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown>>;
  }
}
```

```typescript
{
  type: 'item_update',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown>>;
  }
}
```

```typescript
{
  type: 'item_delete',
  payload: {
    env_id: string;
    layer_id: string;
    items: Array<Record<string, unknown> | string | number>;
  }
}
```

For built-in layers, `agent` uses `id`, `edge` uses `(source, target)`, and `trajectory` uses `id` as the primary key.  Single-key layers may delete by primitive id, and multi-key layers delete by object keys matching the registry primary key fields.

#### `param_create` / `param_update` / `param_delete`

These messages register and maintain renderer-visible parameters.  `param_create` and `param_update` both carry a full `Parameter` object, and `param_delete` removes a parameter by id.

```typescript
{ type: 'param_delete', payload: { id: string } }
```

#### `param_sync`

`param_sync` pushes a simulator-side value correction to the renderer.

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

#### `chart_create` / `chart_update` / `chart_delete`

These messages register and mutate charts.  `chart_create` carries `ChartGroupMetadata`, `chart_update` carries incremental data and operations, and `chart_delete` removes a chart by id.

```typescript
{
  type: 'chart_update',
  payload: {
    updates?: Array<{ id: string; time?: number; value: unknown }>;
    operations?: Array<{ id: string; operation: 'clear' }>;
  }
}
```

```typescript
{ type: 'chart_delete', payload: { id: string } }
```

#### `asset_meta` / `asset_data` / `asset_delete`

These messages maintain the renderer-side asset cache.  `asset_meta` announces descriptors without sending bytes, `asset_data` sends bytes for one asset, and `asset_delete` removes cached assets.

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

JSON mode uses base64 strings for `asset_data`, while MessagePack mode uses raw bytes.

```typescript
{ type: 'asset_delete', payload: { ids: string[] } }
```

#### `log`

`log` is a diagnostic log event.

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

#### `error`

`error` reports a protocol-level or runtime error.

```typescript
{ type: 'error', payload: { error: string } }
```

#### `screenshot_request`

`screenshot_request` asks the renderer to capture a rendered image.  The `request_id` is maintained by the simulator, and the renderer does not validate uniqueness.

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

Exactly one of `env_id` or `chart_id` should be specified to identify the target.  `format` defaults to `'png'`, and `quality` is a `0`-`1` hint used only for `'jpeg'`.

### Renderer -> simulator messages

#### `state_sync`

`state_sync` is sent by the renderer when connecting or reconnecting.  It describes the renderer’s current in-memory state summary so the simulator can decide what to recreate, update, or delete.

```typescript
{
  type: 'state_sync',
  payload: {
    request_id?: string;
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

The simulator does not answer with a reverse `state_sync`.  Instead, it replies by emitting the corresponding create, update, and delete messages.  When the renderer needs to correlate a replay transaction, it should include `request_id`, and the simulator should mirror that value in `state_sync_begin` and `state_sync_end`.

#### `param_change`

`param_change` signals a renderer-side parameter edit.

```typescript
{ type: 'param_change', payload: { id: string; value: unknown } }
```

#### `action_start`

`action_start` starts one action execution.

```typescript
{
  type: 'action_start',
  payload: {
    id: string;
    tick_id?: string;
    continuous?: boolean;
  }
}
```

`continuous` requests a renderer-driven loop rather than a simulator-owned loop.  `tick_id` is optional and allows the renderer runtime to correlate `action_end` with one in-flight dispatch.

#### `asset_sync`

`asset_sync` reports the renderer’s currently held asset hashes.

```typescript
{
  type: 'asset_sync',
  payload: {
    assets: Record<string, string>;
  }
}
```

#### `error`

Renderer-side `error` reports an error to the simulator.

```typescript
{ type: 'error', payload: { error: string } }
```

#### `screenshot_response`

`screenshot_response` returns a captured image to the simulator.

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

If the renderer supports the request, `data` contains the image bytes and `mime` indicates the content type.  JSON mode uses base64-encoded strings, and MessagePack mode uses raw `Uint8Array`.  If the renderer does not support the request, `data` is omitted and `error` describes the reason.

### Continuous execution contract

Protocol v0.2 makes continuous execution renderer-driven.  The intended sequence is: the renderer sends `action_start` with `continuous: true`, the simulator executes one step, the simulator sends the resulting state mutations, the simulator sends `action_end`, and the renderer decides whether to send the next `action_start`.

The stop condition is `action_end` with `continue: false`.  This keeps the simulator simpler because there is no long-running implicit event loop in the transport layer, step boundaries remain explicit on the wire, and reconnection plus playback semantics stay renderer-owned.

The protocol reserves three timing buckets for per-tick diagnostics: `simulate_ms` for simulator-side model advancement and action-handler execution, `communicate_ms` for simulator snapshot or encode work plus transport delivery plus renderer decode or apply work up to the point render can begin, and `render_ms` for renderer-side scene or DOM commit after state application.

The wire format does not require one side to populate all three timing buckets at once.  Producers may report only the portion they can measure, and a shared runtime may assemble the full per-tick view later.

Reserved action ids are `init` and `step`.  All other action ids are application-defined.

## References

The original reference links are:

- [`architecture.md`](./architecture.md)
- [`roadmap.md`](./roadmap.md)
- [`protocol-v0.1.md`](./protocol-v0.1.md)
