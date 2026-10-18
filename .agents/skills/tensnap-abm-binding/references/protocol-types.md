# TenSnap Protocol Type Definitions

This file is generated from the runtime Zod schemas. Edit `src/*.ts`, not this file.

## Package Metadata

| Field | Value |
| --- | --- |
| Package | `@tensnap/protocol` |
| Version | `0.3.3` |
| Description | Canonical TenSnap renderer/simulator protocol payload types, schemas, and codecs. |
| License | `MIT` |
| Source Files | `packages/protocol/src/asset.ts`, `packages/protocol/src/chart.ts`, `packages/protocol/src/controls.ts`, `packages/protocol/src/layers.ts`, `packages/protocol/src/schemas.ts`, `packages/protocol/src/types.ts` |

## Payload Schemas

### SimulatorInfoPayload

Schema: `SimulatorInfoPayloadSchema` (schemas.ts)

Immutable information emitted by a simulator before any other session message.

```ts
export type SimulatorInfoPayload = {
  /**
   * Exact wire-contract version selected for this session.
   */
  protocol_version: '0.3';
  /**
   * Binding implementation identity.
   */
  binding: {
    name: string;
    version: string;
    language?: string | undefined;
    [x: string]: never;
  };
  /**
   * Stable model kind identity; model mismatch isolates an existing project.
   */
  model: {
    id: string;
    name?: string | undefined;
    description?: string | undefined;
    version?: string | undefined;
    state_schema_version?: string | undefined;
    [x: string]: never;
  };
  /**
   * Running-instance identity: stable across reconnect/reset, different after instance replacement.
   */
  instance_id: string;
  /**
   * Unique namespaced capabilities explicitly supported by this simulator.
   */
  capabilities: string[];
  /**
   * Binding-defined limits/details whose keys correspond to declared capabilities.
   */
  capability_details?: ProtocolRecord | undefined;
  [x: string]: never;
};
```

### MetadataUpdatePayload

Schema: `MetadataUpdatePayloadSchema` (schemas.ts)

Mutable scenario metadata applied as a shallow patch. Omitted keys are preserved and null is a value, not a deletion marker. Identity and capability fields are not accepted here.

```ts
export type MetadataUpdatePayload = {
  /**
   * Current scenario time; omitted metadata keys retain their prior values.
   */
  time?: number | undefined;
  [x: string]: ProtocolValue;
};
```

### StateSyncBeginPayload

Schema: `StateSyncBeginPayloadSchema` (schemas.ts)

Opens a non-nestable state-sync replay transaction; no replay state commits before its matching end.

```ts
export type StateSyncBeginPayload = {
  /**
   * Correlates this transaction with the renderer's state_sync request.
   */
  request_id: string;
  /**
   * Must match the accepted simulator model identity.
   */
  model_id: string;
  /**
   * Must match the accepted simulator instance identity.
   */
  instance_id: string;
  /**
   * `replace` starts empty; same-instance `reconcile` starts from committed state.
   */
  mode: 'replace' | 'reconcile';
  [x: string]: never;
};
```

### StateSyncEndPayload

Schema: `StateSyncEndPayloadSchema` (schemas.ts)

Closes the active state-sync transaction and commits its staged renderer state.

```ts
export type StateSyncEndPayload = {
  /**
   * Must equal the active state-sync request.
   */
  request_id: string;
  /**
   * Opaque simulator revision of the committed state.
   */
  state_revision: string;
  [x: string]: never;
};
```

### TickTimingBreakdown

Schema: `TickTimingBreakdownSchema` (schemas.ts)

Optional non-negative timing buckets for action diagnostics; extra numeric buckets are binding-defined.

```ts
export type TickTimingBreakdown = {
  /**
   * Time spent simulating the model.
   */
  simulate_ms?: number | undefined;
  /**
   * Time spent encoding, transport, or binding communication.
   */
  communicate_ms?: number | undefined;
  /**
   * Time spent rendering or presenting state.
   */
  render_ms?: number | undefined;
  [x: string]: number;
};
```

### ActionInvokePayload

Schema: `ActionInvokePayloadSchema` (schemas.ts)

Renderer request to execute one simulator-owned action. Every parsed request receives one result.

```ts
export type ActionInvokePayload = {
  /**
   * Action identity from the simulator-owned action definition.
   */
  id: string;
  /**
   * Correlation ID echoed by exactly one action_result.
   */
  request_id: string;
  /**
   * Renderer loop intent for this call; omission means a single invocation.
   */
  continuous?: boolean | undefined;
  /**
   * Optional concrete environment, layer, or agent target.
   */
  target?: ActionTarget | undefined;
  /**
   * User-supplied arguments keyed by declared action kwarg name.
   */
  kwargs?: ProtocolRecord | undefined;
  [x: string]: never;
};
```

### ActionResultPayload

Schema: `ActionResultPayloadSchema` (schemas.ts)

Correlated completion for an action invocation, sent only after its visible state updates.

```ts
export type ActionResultPayload = {
  /**
   * Action identity from the correlated invocation.
   */
  id: string;
  /**
   * Required correlation ID from action_invoke.
   */
  request_id: string;
  /**
   * False vetoes the next call in this renderer-driven run; omission does not veto.
   */
  should_continue?: boolean | undefined;
  /**
   * Structured execution failure; an error ends the active continuous loop.
   */
  error?: ActionExecutionError | undefined;
  timings?: TickTimingBreakdown | undefined;
  [x: string]: never;
};
```

### ActionDeletePayload

Schema: `ActionDeletePayloadSchema` (schemas.ts)

Removes a simulator-owned action definition by ID; missing IDs are idempotent no-ops.

```ts
export type ActionDeletePayload = {
  id: string;
  [x: string]: never;
};
```

### EnvCreatePayload

Schema: `EnvCreatePayloadSchema` (schemas.ts)

Creates one scenario environment container. `2d` covers both grid and graph layouts.

```ts
export type EnvCreatePayload = {
  /**
   * Stable environment identity.
   */
  id: string;
  /**
   * Environment geometry family; layers provide rendering semantics.
   */
  type: 'uniform' | '2d';
  [x: string]: never;
};
```

### EnvDeletePayload

Schema: `EnvDeletePayloadSchema` (schemas.ts)

Removes an environment and its layers; missing IDs are idempotent no-ops.

```ts
export type EnvDeletePayload = {
  id: string;
  [x: string]: never;
};
```

### EnvLayerCreatePayload

Schema: `EnvLayerCreatePayloadSchema` (schemas.ts)

Creates an environment-local layer with fixed dependency topology.

```ts
export type EnvLayerCreatePayload = {
  /**
   * Parent environment identity.
   */
  env_id: string;
  /**
   * Stable layer identity within the environment.
   */
  layer_id: string;
  /**
   * Registry key that determines item schema and primary key.
   */
  layer_type: string;
  /**
   * Create-time dependency topology; changing it requires recreating the layer or environment.
   */
  dependency_layer_ids?:
    | {
        [key: string]: string;
      }
    | undefined;
  /**
   * Layer configuration, never layer item data.
   */
  metadata?: ProtocolRecord | undefined;
  [x: string]: never;
};
```

### EnvLayerUpdatePayload

Schema: `EnvLayerUpdatePayloadSchema` (schemas.ts)

Replaces a layer's metadata as a whole; it cannot mutate items or dependency topology.

```ts
export type EnvLayerUpdatePayload = {
  env_id: string;
  layer_id: string;
  /**
   * Complete replacement configuration for the layer.
   */
  metadata: ProtocolRecord;
  [x: string]: never;
};
```

### EnvLayerDeletePayload

Schema: `EnvLayerDeletePayloadSchema` (schemas.ts)

Removes one layer from an environment; missing IDs are idempotent no-ops.

```ts
export type EnvLayerDeletePayload = {
  env_id: string;
  layer_id: string;
  [x: string]: never;
};
```

### ItemCreatePayload

Schema: `ItemCreatePayloadSchema` (schemas.ts)

Creates layer-owned items conforming to the target layer registry.

```ts
export type ItemCreatePayload = {
  env_id: string;
  layer_id: string;
  /**
   * New items; duplicate keys reject the surrounding transaction.
   */
  items: ProtocolRecord[];
  [x: string]: never;
};
```

### ItemUpdatePayload

Schema: `ItemUpdatePayloadSchema` (schemas.ts)

Applies field-level changes to existing layer items.

```ts
export type ItemUpdatePayload = {
  env_id: string;
  layer_id: string;
  /**
   * Diffs including every primary-key field required by the layer registry.
   */
  items: ProtocolRecord[];
  [x: string]: never;
};
```

### ItemDeletePayload

Schema: `ItemDeletePayloadSchema` (schemas.ts)

Deletes layer-owned items by their primitive or composite registry keys.

```ts
export type ItemDeletePayload = {
  env_id: string;
  layer_id: string;
  /**
   * Single-key layers use primitives; multi-key layers use key objects.
   */
  items: PrimitiveItemKey[] | ProtocolRecord[];
  [x: string]: never;
};
```

### ParameterDeletePayload

Schema: `ParameterDeletePayloadSchema` (schemas.ts)

Removes a parameter definition by ID; missing IDs are idempotent no-ops.

```ts
export type ParameterDeletePayload = {
  id: string;
  [x: string]: never;
};
```

### ParameterSyncPayload

Schema: `ParameterSyncPayloadSchema` (schemas.ts)

Simulator correction for an optimistic parameter edit; definition changes use `param_update` instead.

```ts
export type ParameterSyncPayload = {
  /**
   * Existing parameter identity.
   */
  id: string;
  /**
   * Rejected or canonicalized simulator value.
   */
  value: ProtocolValue;
  [x: string]: never;
};
```

### ChartDeletePayload

Schema: `ChartDeletePayloadSchema` (schemas.ts)

Deletes an explicitly typed chart group or series; deleting a group also deletes its series.

```ts
export type ChartDeletePayload = {
  /**
   * Target kind; a bare ID never implies a group or series.
   */
  kind: 'group' | 'series';
  /**
   * Target identity.
   */
  id: string;
  [x: string]: never;
};
```

### ChartUpdatePayload

Schema: `ChartUpdatePayloadSchema` (schemas.ts)

Incremental chart data and/or explicit clear/truncate operations; at least one collection is required.

```ts
export type ChartUpdatePayload = {
  /**
   * Points to append or merge.
   */
  updates?: ChartUpdateData[] | undefined;
  /**
   * Operations applied without guessing chart target kind.
   */
  operations?: ChartUpdateOperation[] | undefined;
  [x: string]: never;
};
```

### MonitorUpdatePayload

Schema: `MonitorUpdatePayloadSchema` (schemas.ts)

Replaces the current value of an existing monitor.

```ts
export type MonitorUpdatePayload = {
  /**
   * Existing monitor identity.
   */
  id: string;
  /**
   * Replaces the current monitor value; it is not an append stream.
   */
  value: ProtocolValue;
  revision?: (string | number) | undefined;
  [x: string]: never;
};
```

### MonitorDeletePayload

Schema: `MonitorDeletePayloadSchema` (schemas.ts)

Removes a monitor by ID; missing IDs are idempotent no-ops.

```ts
export type MonitorDeletePayload = {
  id: string;
  [x: string]: never;
};
```

### SceneRestorePayload

Schema: `SceneRestorePayloadSchema` (schemas.ts)

Renderer request to restore checkpoint and/or projected state in a separate atomic transaction.

```ts
export type SceneRestorePayload = {
  /**
   * Correlates the restore transaction.
   */
  request_id: string;
  /**
   * Target model kind; mismatch is rejected without mutation.
   */
  model_id: string;
  /**
   * Optional compatibility guard for the checkpoint/projected state shape.
   */
  state_schema_version?: string | undefined;
  /**
   * Optional stale-instance guard.
   */
  expected_instance_id?: string | undefined;
  /**
   * Opaque full-state representation, applied before projected fields.
   */
  checkpoint?: Checkpoint | undefined;
  /**
   * Explicit replacement scenario time, applied after checkpoint, parameters, and environments.
   */
  time?: number | undefined;
  /**
   * Parameter values to overlay after an optional checkpoint; omission preserves all.
   */
  parameters?:
    | {
        id: string;
        value: ProtocolValue;
        [x: string]: never;
      }[]
    | undefined;
  /**
   * Complete projected environments applied after parameters; omission preserves all.
   */
  envs?: RestorableEnvironment[] | undefined;
  [x: string]: never;
};
```

### SceneRestoreBeginPayload

Schema: `SceneRestoreBeginPayloadSchema` (schemas.ts)

Opens the staged scene-restore replay corresponding to a restore request.

```ts
export type SceneRestoreBeginPayload = {
  request_id: string;
  [x: string]: never;
};
```

### SceneRestoreEndPayload

Schema: `SceneRestoreEndPayloadSchema` (schemas.ts)

Completes a scene restore; only `ok` commits the staged renderer state.

```ts
export type SceneRestoreEndPayload = {
  /**
   * Must equal the active restore request.
   */
  request_id: string;
  /**
   * Only `ok` commits the staged restored scenario.
   */
  status: 'ok' | 'rejected' | 'failed';
  error?: ActionExecutionError | undefined;
  [x: string]: never;
};
```

### SceneCapturePayload

Schema: `SceneCapturePayloadSchema` (schemas.ts)

Requests an optional exact checkpoint capture at an action boundary.

```ts
export type SceneCapturePayload = {
  request_id: string;
  [x: string]: never;
};
```

### SceneCaptureResultPayload

Schema: `SceneCaptureResultPayloadSchema` (schemas.ts)

Correlated result for scene capture; checkpoints never travel in action results.

```ts
export type SceneCaptureResultPayload = {
  request_id: string;
  model_id: string;
  state_schema_version?: string | undefined;
  checkpoint: Checkpoint;
  [x: string]: never;
};
```

### LogPayload

Schema: `LogPayloadSchema` (schemas.ts)

Structured simulator diagnostic log entry.

```ts
export type LogPayload = {
  /**
   * Human-readable log text.
   */
  message: string;
  /**
   * Severity; omitted entries use the renderer's default log presentation.
   */
  level?: LogLevel | undefined;
  /**
   * Optional simulator-defined target/category.
   */
  target?: string | undefined;
  /**
   * Optional source timestamp.
   */
  timestamp?: number | undefined;
  /**
   * Optional structured diagnostic context.
   */
  data?: ProtocolValue | undefined;
  [x: string]: never;
};
```

### ErrorPayload

Schema: `ErrorPayloadSchema` (schemas.ts)

Independent protocol or runtime error that cannot be expressed as a correlated action result.

```ts
export type ErrorPayload = {
  code: string;
  message: string;
  request_id?: string | undefined;
  path?: string | undefined;
  retryable?: boolean | undefined;
  data?: ProtocolValue | undefined;
  [x: string]: never;
};
```

### AssetMetadataPayload

Schema: `AssetMetadataPayloadSchema` (schemas.ts)

Announces cacheable content-addressed assets without transferring their bytes.

```ts
export type AssetMetadataPayload = {
  assets: AssetMeta[];
  [x: string]: never;
};
```

### AssetDataPayload

Schema: `AssetDataPayloadSchema` (schemas.ts)

Transfers bytes for one previously announced asset.

```ts
export type AssetDataPayload = {
  id: string;
  hash: string;
  mime: string;
  data: string | Uint8Array;
  [x: string]: never;
};
```

### AssetDeletePayload

Schema: `AssetDeletePayloadSchema` (schemas.ts)

Removes renderer-side cached assets by ID.

```ts
export type AssetDeletePayload = {
  ids: string[];
  [x: string]: never;
};
```

### AssetSyncPayload

Schema: `AssetSyncPayloadSchema` (schemas.ts)

Renderer inventory of currently held asset hashes; it does not mutate simulator state.

```ts
export type AssetSyncPayload = {
  assets: {
    [key: string]: string;
  };
  [x: string]: never;
};
```

### ScreenshotRequestPayload

Schema: `ScreenshotRequestPayloadSchema` (schemas.ts)

Asks the renderer to capture exactly one environment or chart.

```ts
export type ScreenshotRequestPayload = {
  request_id: string;
  env_id?: string | undefined;
  chart_id?: string | undefined;
  format?: ('png' | 'jpeg') | undefined;
  quality?: number | undefined;
  [x: string]: never;
};
```

### ScreenshotResponsePayload

Schema: `ScreenshotResponsePayloadSchema` (schemas.ts)

Correlated renderer capture result containing image bytes or a structured error.

```ts
export type ScreenshotResponsePayload = {
  request_id: string;
  data?: (string | Uint8Array) | undefined;
  mime?: string | undefined;
  error?: ActionExecutionError | undefined;
  [x: string]: never;
};
```

### StateSyncRequest

Schema: `StateSyncRequestSchema` (schemas.ts)

Renderer read-only inventory request that begins simulator-to-renderer state replay.

```ts
export type StateSyncRequest = {
  /**
   * Renderer-generated transaction identity.
   */
  request_id: string;
  /**
   * Simulator model identity expected by the renderer.
   */
  model_id: string;
  /**
   * Last committed instance identity, when the renderer has one.
   */
  instance_id?: string | undefined;
  /**
   * Read-only renderer inventory; simulators must not mutate it.
   */
  state_revision?: string | undefined;
  /**
   * Last committed renderer metadata revision, when available.
   */
  metadata_revision?: string | undefined;
  /**
   * Renderer-held parameter definitions and values; read-only inventory only.
   */
  parameters: Parameter[];
  /**
   * Renderer-held action definitions; inventory only.
   */
  actions: Action[];
  /**
   * Renderer-held environment and layer topology; inventory only.
   */
  envs: {
    id: string;
    type: string;
    layers: {
      layer_id: string;
      layer_type: string;
      [x: string]: never;
    }[];
    [x: string]: never;
  }[];
  /**
   * Renderer-held chart definitions; chart history is intentionally excluded.
   */
  charts: ChartMetadata[];
  /**
   * Renderer-held monitor definitions; current values return in replay updates.
   */
  monitors: MonitorMetadata[];
  [x: string]: never;
};
```

### ParameterChangePayload

Schema: `ParameterChangePayloadSchema` (schemas.ts)

Renderer optimistic parameter edit; simulators reply only when rejecting or canonicalizing via `param_sync`.

```ts
export type ParameterChangePayload = {
  id: string;
  value: ProtocolValue;
  [x: string]: never;
};
```

## Message Envelopes

### SimulatorToRendererMessage

Schema: `SimulatorToRendererMessageSchema` (schemas.ts)

Canonical strict envelope union for simulator-originated protocol messages.

```ts
export type SimulatorToRendererMessage =
  | {
      type: 'simulator_info';
      payload: SimulatorInfoPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'metadata_update';
      payload: MetadataUpdatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'state_sync_begin';
      payload: StateSyncBeginPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'state_sync_end';
      payload: StateSyncEndPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'action_result';
      payload: ActionResultPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'action_create';
      payload: Action;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'action_update';
      payload: Action;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'action_delete';
      payload: ActionDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'env_create';
      payload: EnvCreatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'env_delete';
      payload: EnvDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'env_layer_create';
      payload: EnvLayerCreatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'env_layer_update';
      payload: EnvLayerUpdatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'env_layer_delete';
      payload: EnvLayerDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'item_create';
      payload: ItemCreatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'item_update';
      payload: ItemUpdatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'item_delete';
      payload: ItemDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'param_create';
      payload: Parameter;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'param_update';
      payload: Parameter;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'param_delete';
      payload: ParameterDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'param_sync';
      payload: ParameterSyncPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'chart_create';
      payload: ChartGroupMetadata;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'chart_update';
      payload: ChartUpdatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'chart_delete';
      payload: ChartDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'monitor_create';
      payload: MonitorMetadata;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'monitor_update';
      payload: MonitorUpdatePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'monitor_delete';
      payload: MonitorDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'asset_metadata';
      payload: AssetMetadataPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'asset_data';
      payload: AssetDataPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'asset_delete';
      payload: AssetDeletePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'screenshot_request';
      payload: ScreenshotRequestPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'scene_restore_begin';
      payload: SceneRestoreBeginPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'scene_restore_end';
      payload: SceneRestoreEndPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'scene_capture_result';
      payload: SceneCaptureResultPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'log';
      payload: LogPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'error';
      payload: ErrorPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    };
```

### RendererToSimulatorMessage

Schema: `RendererToSimulatorMessageSchema` (schemas.ts)

Canonical strict envelope union for renderer-originated protocol messages.

```ts
export type RendererToSimulatorMessage =
  | {
      type: 'state_sync';
      payload: StateSyncRequest;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'param_change';
      payload: ParameterChangePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'action_invoke';
      payload: ActionInvokePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'asset_sync';
      payload: AssetSyncPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'screenshot_response';
      payload: ScreenshotResponsePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'scene_restore';
      payload: SceneRestorePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'scene_capture';
      payload: SceneCapturePayload;
      timestamp?: number | undefined;
      [x: string]: never;
    }
  | {
      type: 'error';
      payload: ErrorPayload;
      timestamp?: number | undefined;
      [x: string]: never;
    };
```

### AnyProtocolMessage

Schema: `AnyProtocolMessageSchema` (schemas.ts)

Any canonical strict protocol message in the current contract.

```ts
export type AnyProtocolMessage = SimulatorToRendererMessage | RendererToSimulatorMessage;
```

## Built-in Layer Schemas

### BuiltinLayerType

Schema: `BuiltinLayerTypeSchema` (layers.ts)

The five layer types built into the default TenSnap renderer registry. Third-party layer types may still use open `layer_type` strings in the generic protocol payloads.

```ts
export type BuiltinLayerType = 'background' | 'grid' | 'edge' | 'trajectory' | 'agent';
```

### AgentId

Schema: `AgentIdSchema` (layers.ts)

Agent ids are stable layer item keys and may be strings or numbers.

```ts
export type AgentId = string | number;
```

### BuiltinAgentIcon

Schema: `BuiltinAgentIconSchema` (layers.ts)

Built-in symbolic agent icons rendered by the default agent layer.

```ts
export type BuiltinAgentIcon =
  | 'arrow'
  | 'circle'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'hexagon'
  | 'cross'
  | 'plus'
  | 'pentagon';
```

### AssetAgentIcon

Schema: `AssetAgentIconSchema` (layers.ts)

Asset-backed icons use the `asset:<asset_id>` reference form.

```ts
export type AssetAgentIcon = `asset:${string}`;
```

### AgentIcon

Schema: `AgentIconSchema` (layers.ts)

Built-in symbolic or asset-backed icon accepted by an agent item.

```ts
export type AgentIcon = BuiltinAgentIcon | AssetAgentIcon;
```

### BaseLayerMetadata

Schema: `BaseLayerMetadataSchema` (layers.ts)

Common metadata accepted by all built-in layers. Dependencies are create-time topology and live on `env_layer_create.dependency_layer_ids`, not in metadata.

```ts
export type BaseLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  [x: string]: unknown;
};
```

### AgentLayerMetadata

Schema: `AgentLayerMetadataSchema` (layers.ts)

Agent layer metadata. `coord_offset` selects integer grid-cell coordinates or floating scene coordinates for x/y agent positions.

```ts
export type AgentLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  coord_offset?: ('int' | 'float') | undefined;
  [x: string]: unknown;
};
```

### AgentItem

Schema: `AgentItemSchema` (layers.ts)

Agent items are keyed by `id`. They can represent grid agents or graph nodes; graph-force fields (`vx`, `vy`, `fx`, `fy`) are renderer-maintained hints.

```ts
export type AgentItem = {
  id: AgentId;
  color?: string | undefined;
  icon?: AgentIcon | undefined;
  size?: number | undefined;
  x?: number | undefined;
  y?: number | undefined;
  vx?: number | undefined;
  vy?: number | undefined;
  fx?: (number | null) | undefined;
  fy?: (number | null) | undefined;
  heading?: number | undefined;
  data?:
    | {
        [key: string]: unknown;
      }
    | undefined;
  [x: string]: unknown;
};
```

### AgentItemDiff

Schema: `AgentItemDiffSchema` (layers.ts)

Agent item updates are keyed by `id` and may carry any changed fields.

```ts
export type AgentItemDiff = {
  id: AgentId;
  [x: string]: unknown;
};
```

### EdgeLayerMetadata

Schema: `EdgeLayerMetadataSchema` (layers.ts)

Edge layer metadata configures graph layout forces and edge rendering defaults. Edge layers depend on an agent layer through dependency key `agent`.

```ts
export type EdgeLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  link_distance?: number | undefined;
  charge_strength?: number | undefined;
  centering_strength?: number | undefined;
  collision_radius?: number | undefined;
  max_component_distance?: number | undefined;
  component_spacing?: number | undefined;
  [x: string]: unknown;
};
```

### EdgeItem

Schema: `EdgeItemSchema` (layers.ts)

Edge items are keyed by the ordered pair (`source`, `target`).

```ts
export type EdgeItem = {
  source: AgentId;
  target: AgentId;
  directed?: boolean | undefined;
  style?: ('solid' | 'dashed' | 'dotted') | undefined;
  width?: number | undefined;
  color?: string | undefined;
  [x: string]: unknown;
};
```

### EdgeItemDiff

Schema: `EdgeItemDiffSchema` (layers.ts)

Edge item updates are keyed by `source` and `target`.

```ts
export type EdgeItemDiff = {
  source: AgentId;
  target: AgentId;
  [x: string]: unknown;
};
```

### EdgeItemKey

Schema: `EdgeItemKeySchema` (layers.ts)

Delete key for one edge item.

```ts
export type EdgeItemKey = {
  source: AgentId;
  target: AgentId;
};
```

### TrajectoryLayerMetadata

Schema: `TrajectoryLayerMetadataSchema` (layers.ts)

Trajectory layer metadata sets defaults for per-agent trajectory traces. Trajectory layers depend on an agent layer through dependency key `agent`.

Lifecycle defaults are `on_agent_delete: 'delete'`, `on_state_sync: 'preserve'`, and `on_reset: 'clear'`. A retained deletion closes the old trace segment so a later reuse of the same agent id starts a separate line instead of connecting two lifetimes.

```ts
export type TrajectoryLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  length?: number | undefined;
  width?: number | undefined;
  color?: string | undefined;
  /**
   * What to do with a trace when its source agent is deleted.
   */
  on_agent_delete?: ('delete' | 'retain') | undefined;
  /**
   * What to do with accumulated traces during a state-sync replay.
   */
  on_state_sync?: ('preserve' | 'clear') | undefined;
  /**
   * What to do with accumulated traces when the renderer resets its scene.
   */
  on_reset?: ('clear' | 'preserve') | undefined;
  [x: string]: unknown;
};
```

### TrajectoryItem

Schema: `TrajectoryItemSchema` (layers.ts)

Per-agent trajectory config items are keyed by agent `id`.

```ts
export type TrajectoryItem = {
  id: AgentId;
  length?: number | undefined;
  width?: number | undefined;
  color?: string | undefined;
  [x: string]: unknown;
};
```

### TrajectoryItemDiff

Schema: `TrajectoryItemDiffSchema` (layers.ts)

Trajectory item updates are keyed by `id`.

```ts
export type TrajectoryItemDiff = {
  id: AgentId;
  [x: string]: unknown;
};
```

### TrajectoryPoint

Schema: `TrajectoryPointSchema` (layers.ts)

One historical trajectory sample stored by the renderer.

```ts
export type TrajectoryPoint = {
  x: number;
  y: number;
  time: number;
  color?: string | undefined;
};
```

### GridLayerMetadata

Schema: `GridLayerMetadataSchema` (layers.ts)

Grid layer metadata controls parametric grid lines and optional scene size.

```ts
export type GridLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  x_origin?: number | undefined;
  x_unit?: number | undefined;
  x_interval?: number | undefined;
  x_ratio?: number | undefined;
  y_origin?: number | undefined;
  y_unit?: number | undefined;
  y_interval?: number | undefined;
  y_ratio?: number | undefined;
  stroke_color?: string | undefined;
  [x: string]: unknown;
};
```

### BackgroundInterpolation

Schema: `BackgroundInterpolationSchema` (layers.ts)

Sampling mode for a background image.

```ts
export type BackgroundInterpolation = 'nearest' | 'linear';
```

### BackgroundAssetReference

Schema: `BackgroundAssetReferenceSchema` (layers.ts)

Background image references point to a previously announced protocol asset.

```ts
export type BackgroundAssetReference = {
  asset_id: string;
  interpolation?: BackgroundInterpolation | undefined;
};
```

### BackgroundSource

Schema: `BackgroundSourceSchema` (layers.ts)

Raw background source accepted by the built-in background layer metadata.

```ts
export type BackgroundSource = string | Uint8Array | BackgroundAssetReference;
```

### BackgroundLayerMetadata

Schema: `BackgroundLayerMetadataSchema` (layers.ts)

Background layer metadata stores color/image/asset source and interpolation.

```ts
export type BackgroundLayerMetadata = {
  dependency_layer_ids?: never | undefined;
  z_index?: number | undefined;
  background?: BackgroundSource | undefined;
  interpolation?: BackgroundInterpolation | undefined;
  [x: string]: unknown;
};
```

### AgentDependencyLayerIds

Schema: `AgentDependencyLayerIdsSchema` (layers.ts)

Dependency map shape used by edge and trajectory layers.

```ts
export type AgentDependencyLayerIds = {
  agent: string;
  [x: string]: unknown;
};
```

### AgentLayerCreatePayload

Schema: `AgentLayerCreatePayloadSchema` (layers.ts)

Built-in `agent` layer create payload. Agent layers do not require dependency layers.

```ts
export type AgentLayerCreatePayload = {
  env_id: string;
  layer_id: string;
  layer_type: 'agent';
  data?: AgentLayerMetadata | undefined;
};
```

### EdgeLayerCreatePayload

Schema: `EdgeLayerCreatePayloadSchema` (layers.ts)

Built-in `edge` layer create payload. `dependency_layer_ids.agent` names the source agent layer.

```ts
export type EdgeLayerCreatePayload = {
  env_id: string;
  layer_id: string;
  layer_type: 'edge';
  dependency_layer_ids: AgentDependencyLayerIds;
  data?: EdgeLayerMetadata | undefined;
};
```

### TrajectoryLayerCreatePayload

Schema: `TrajectoryLayerCreatePayloadSchema` (layers.ts)

Built-in `trajectory` layer create payload. `dependency_layer_ids.agent` names the traced agent layer.

```ts
export type TrajectoryLayerCreatePayload = {
  env_id: string;
  layer_id: string;
  layer_type: 'trajectory';
  dependency_layer_ids: AgentDependencyLayerIds;
  data?: TrajectoryLayerMetadata | undefined;
};
```

### GridLayerCreatePayload

Schema: `GridLayerCreatePayloadSchema` (layers.ts)

Built-in `grid` layer create payload. Grid layers use metadata only and do not accept item messages.

```ts
export type GridLayerCreatePayload = {
  env_id: string;
  layer_id: string;
  layer_type: 'grid';
  data?: GridLayerMetadata | undefined;
};
```

### BackgroundLayerCreatePayload

Schema: `BackgroundLayerCreatePayloadSchema` (layers.ts)

Built-in `background` layer create payload. Background layers use metadata only and do not accept item messages.

```ts
export type BackgroundLayerCreatePayload = {
  env_id: string;
  layer_id: string;
  layer_type: 'background';
  data?: BackgroundLayerMetadata | undefined;
};
```

### BuiltinLayerCreatePayload

Schema: `BuiltinLayerCreatePayloadSchema` (layers.ts)

Union of the five built-in layer create payload specializations.

```ts
export type BuiltinLayerCreatePayload =
  | BackgroundLayerCreatePayload
  | GridLayerCreatePayload
  | EdgeLayerCreatePayload
  | TrajectoryLayerCreatePayload
  | AgentLayerCreatePayload;
```

### AgentItemCreatePayload

Schema: `AgentItemCreatePayloadSchema` (layers.ts)

`item_create` payload specialization for built-in agent layers.

```ts
export type AgentItemCreatePayload = {
  env_id: string;
  layer_id: string;
  items: AgentItem[];
};
```

### AgentItemUpdatePayload

Schema: `AgentItemUpdatePayloadSchema` (layers.ts)

`item_update` payload specialization for built-in agent layers.

```ts
export type AgentItemUpdatePayload = {
  env_id: string;
  layer_id: string;
  items: AgentItemDiff[];
};
```

### AgentItemDeletePayload

Schema: `AgentItemDeletePayloadSchema` (layers.ts)

`item_delete` payload specialization for built-in agent layers, keyed by agent id.

```ts
export type AgentItemDeletePayload = {
  env_id: string;
  layer_id: string;
  items: AgentId[];
};
```

### EdgeItemCreatePayload

Schema: `EdgeItemCreatePayloadSchema` (layers.ts)

`item_create` payload specialization for built-in edge layers.

```ts
export type EdgeItemCreatePayload = {
  env_id: string;
  layer_id: string;
  items: EdgeItem[];
};
```

### EdgeItemUpdatePayload

Schema: `EdgeItemUpdatePayloadSchema` (layers.ts)

`item_update` payload specialization for built-in edge layers.

```ts
export type EdgeItemUpdatePayload = {
  env_id: string;
  layer_id: string;
  items: EdgeItemDiff[];
};
```

### EdgeItemDeletePayload

Schema: `EdgeItemDeletePayloadSchema` (layers.ts)

`item_delete` payload specialization for built-in edge layers, keyed by source/target pairs.

```ts
export type EdgeItemDeletePayload = {
  env_id: string;
  layer_id: string;
  items: EdgeItemKey[];
};
```

### TrajectoryItemCreatePayload

Schema: `TrajectoryItemCreatePayloadSchema` (layers.ts)

`item_create` payload specialization for built-in trajectory layers.

```ts
export type TrajectoryItemCreatePayload = {
  env_id: string;
  layer_id: string;
  items: TrajectoryItem[];
};
```

### TrajectoryItemUpdatePayload

Schema: `TrajectoryItemUpdatePayloadSchema` (layers.ts)

`item_update` payload specialization for built-in trajectory layers.

```ts
export type TrajectoryItemUpdatePayload = {
  env_id: string;
  layer_id: string;
  items: TrajectoryItemDiff[];
};
```

### TrajectoryItemDeletePayload

Schema: `TrajectoryItemDeletePayloadSchema` (layers.ts)

`item_delete` payload specialization for built-in trajectory layers, keyed by agent id.

```ts
export type TrajectoryItemDeletePayload = {
  env_id: string;
  layer_id: string;
  items: AgentId[];
};
```

### BuiltinLayerItemCreatePayload

Schema: `BuiltinLayerItemCreatePayloadSchema` (layers.ts)

Union of built-in layer `item_create` payload specializations. Grid and background layers have no items.

```ts
export type BuiltinLayerItemCreatePayload =
  AgentItemCreatePayload | EdgeItemCreatePayload | TrajectoryItemCreatePayload;
```

### BuiltinLayerItemUpdatePayload

Schema: `BuiltinLayerItemUpdatePayloadSchema` (layers.ts)

Union of built-in layer `item_update` payload specializations. Grid and background layers have no items.

```ts
export type BuiltinLayerItemUpdatePayload =
  AgentItemUpdatePayload | EdgeItemUpdatePayload | TrajectoryItemUpdatePayload;
```

### BuiltinLayerItemDeletePayload

Schema: `BuiltinLayerItemDeletePayloadSchema` (layers.ts)

Union of built-in layer `item_delete` payload specializations. Grid and background layers have no items.

```ts
export type BuiltinLayerItemDeletePayload =
  AgentItemDeletePayload | EdgeItemDeletePayload | TrajectoryItemDeletePayload;
```

## Controls, Charts, And Assets

### AssetId

Schema: `AssetIdSchema` (asset.ts)

Asset identifiers and metadata are protocol payloads, not renderer cache objects. Renderers may resolve them into blob URLs or local buffers, but the wire contract stays content-addressed by id plus hash.

```ts
export type AssetId = string;
```

### AssetMeta

Schema: `AssetMetaSchema` (asset.ts)

Cacheable content-addressed asset descriptor; bytes arrive separately in `asset_data`.

```ts
export type AssetMeta = {
  id: AssetId;
  hash: string;
  mime: string;
  size: number;
  label?: string | undefined;
};
```

### ChartMetadata

Schema: `ChartMetadataSchema` (chart.ts)

Protocol-level chart metadata. Layout and painting remain renderer-local.

```ts
export type ChartMetadata = {
  /**
   * Stable group or series identity.
   */
  id: string;
  /**
   * Display label; renderer layout remains local state.
   */
  label: string;
  color?: string | undefined;
  [x: string]: never;
};
```

### ChartGroupMetadata

Schema: `ChartGroupMetadataSchema` (chart.ts)

A chart group and its optional named series.

```ts
export type ChartGroupMetadata = {
  /**
   * Stable group or series identity.
   */
  id: string;
  /**
   * Display label; renderer layout remains local state.
   */
  label: string;
  color?: string | undefined;
  /**
   * Series defined by this group. Omission denotes a single-series group.
   */
  data_list?: ChartMetadata[] | undefined;
  [x: string]: never;
};
```

### ChartUpdateData

Schema: `ChartUpdateDataSchema` (chart.ts)

One incremental point for a chart group or series.

```ts
export type ChartUpdateData = {
  /**
   * Group or series identity.
   */
  id: string;
  /**
   * Series time; omitted values use the renderer's current scenario time.
   */
  time?: number | undefined;
  /**
   * Chart-domain value appended or merged at `time`; same-time writes are last-write-wins.
   */
  value: unknown;
  [x: string]: never;
};
```

### ChartUpdateOperation

Schema: `ChartUpdateOperationSchema` (chart.ts)

An explicit clear or truncate operation; bare IDs never imply a target kind. Inclusive truncation removes points whose time is at least the boundary; exclusive truncation removes only points after it.

```ts
export type ChartUpdateOperation =
  | {
      operation: 'clear';
      kind: 'all';
      [x: string]: never;
    }
  | {
      operation: 'clear';
      kind: 'group' | 'series';
      id: string;
      [x: string]: never;
    }
  | {
      operation: 'truncate';
      kind: 'all';
      time: number;
      inclusive: boolean;
      [x: string]: never;
    }
  | {
      operation: 'truncate';
      kind: 'group' | 'series';
      id: string;
      time: number;
      inclusive: boolean;
      [x: string]: never;
    };
```

### ParameterType

Schema: `ParameterTypeSchema` (controls.ts)

Canonical parameter kinds used by parameter definitions.

```ts
export type ParameterType = 'number' | 'enum' | 'boolean' | 'string';
```

### ParameterBase

Schema: `ParameterBaseSchema` (controls.ts)

Simulator-owned parameter definition shared by every parameter kind.

```ts
export type ParameterBase = {
  /**
   * Stable parameter identity; create duplicates and missing updates are errors.
   */
  id: string;
  /**
   * Discriminator for the value and constraint fields.
   */
  type: ParameterType;
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Whether the renderer may issue `param_change` while the model is running.
   */
  allow_runtime_change?: boolean | undefined;
  [x: string]: never;
};
```

### NumberParameter

Schema: `NumberParameterSchema` (controls.ts)

Numeric parameter with optional inclusive bounds and a positive UI step.

```ts
export type NumberParameter = {
  /**
   * Stable parameter identity; create duplicates and missing updates are errors.
   */
  id: string;
  /**
   * Discriminator for the value and constraint fields.
   */
  type: 'number';
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Whether the renderer may issue `param_change` while the model is running.
   */
  allow_runtime_change?: boolean | undefined;
  value: number;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  [x: string]: never;
};
```

### EnumParameter

Schema: `EnumParameterSchema` (controls.ts)

String-valued parameter restricted to its declared option set.

```ts
export type EnumParameter = {
  /**
   * Stable parameter identity; create duplicates and missing updates are errors.
   */
  id: string;
  /**
   * Discriminator for the value and constraint fields.
   */
  type: 'enum';
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Whether the renderer may issue `param_change` while the model is running.
   */
  allow_runtime_change?: boolean | undefined;
  value: string;
  options: string[];
  labels?:
    | {
        [key: string]: string;
      }
    | undefined;
  [x: string]: never;
};
```

### BooleanParameter

Schema: `BooleanParameterSchema` (controls.ts)

Boolean parameter definition.

```ts
export type BooleanParameter = {
  /**
   * Stable parameter identity; create duplicates and missing updates are errors.
   */
  id: string;
  /**
   * Discriminator for the value and constraint fields.
   */
  type: 'boolean';
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Whether the renderer may issue `param_change` while the model is running.
   */
  allow_runtime_change?: boolean | undefined;
  value: boolean;
  [x: string]: never;
};
```

### StringParameter

Schema: `StringParameterSchema` (controls.ts)

Free-form string parameter definition.

```ts
export type StringParameter = {
  /**
   * Stable parameter identity; create duplicates and missing updates are errors.
   */
  id: string;
  /**
   * Discriminator for the value and constraint fields.
   */
  type: 'string';
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Whether the renderer may issue `param_change` while the model is running.
   */
  allow_runtime_change?: boolean | undefined;
  value: string;
  [x: string]: never;
};
```

### Parameter

Schema: `ParameterSchema` (controls.ts)

Canonical discriminated union used by `param_create` and `param_update`.

```ts
export type Parameter = NumberParameter | EnumParameter | BooleanParameter | StringParameter;
```

### ActionScope

Schema: `ActionScopeSchema` (controls.ts)

The most-specific object level an action accepts; omitted action scope is `model`.

```ts
export type ActionScope = 'model' | 'env' | 'layer' | 'agent';
```

### ActionKwargDefinition

Schema: `ActionKwargDefinitionSchema` (controls.ts)

One ordered action argument definition used for renderer UX and binding validation.

```ts
export type ActionKwargDefinition = {
  /**
   * Key used in `action_invoke.kwargs`.
   */
  name: string;
  /**
   * Optional renderer-facing label.
   */
  label?: string | undefined;
  /**
   * Declared argument kind; `json` is the complex-value escape hatch.
   */
  type: 'number' | 'integer' | 'string' | 'boolean' | 'enum' | 'json';
  /**
   * Required arguments cannot declare a default.
   */
  required?: boolean | undefined;
  /**
   * Simulator-applied value when an optional argument is absent; renderers do not inject it.
   */
  default?: unknown | undefined;
  /**
   * Optional numeric lower bound.
   */
  min?: number | undefined;
  /**
   * Optional numeric upper bound.
   */
  max?: number | undefined;
  /**
   * Optional positive numeric UI increment.
   */
  step?: number | undefined;
  /**
   * Required non-empty choice list when `type` is `enum`.
   */
  options?: string[] | undefined;
  [x: string]: never;
};
```

### Action

Schema: `ActionSchema` (controls.ts)

A simulator-owned action definition. Renderer view choices never mutate it.

```ts
export type Action = {
  /**
   * Stable action identity used by `action_invoke`.
   */
  id: string;
  /**
   * Simulator-provided display label.
   */
  label: string;
  /**
   * Most specific target scope this action accepts; omission means model scope.
   */
  scope?: ActionScope | undefined;
  /**
   * Typed simulator-owned arguments accepted by the action.
   */
  kwargs?: ActionKwargDefinition[] | undefined;
  /**
   * Permits renderer-driven repetition; it never starts a simulator-owned loop.
   */
  continuous?: boolean | undefined;
  [x: string]: never;
};
```

## Supporting Schemas

### ProtocolValue

Schema: `ProtocolValueSchema` (schemas.ts)

Recursive portable value accepted in ordinary protocol records. It excludes undefined, non-finite numbers, functions, symbols, Map/Set, and binary data.

```ts
export type ProtocolValue = Auxiliary_0;

export type Auxiliary_0 =
  | null
  | boolean
  | number
  | string
  | Auxiliary_0[]
  | {
      [key: string]: Auxiliary_0;
    };
```

### ProtocolRecord

Schema: `ProtocolRecordSchema` (schemas.ts)

String-keyed map of portable protocol values.

```ts
export type ProtocolRecord = {
  [key: string]: ProtocolValue;
};
```

### ItemRecord

Schema: `ItemSchema` (schemas.ts)

Generic layer item; concrete layer registries define its fields and key.

```ts
export type ItemRecord = {
  [key: string]: ProtocolValue;
};
```

### ItemDiff

Schema: `ItemDiffSchema` (schemas.ts)

Generic field-level layer-item update; it must include the registry key fields.

```ts
export type ItemDiff = {
  [key: string]: ProtocolValue;
};
```

### ItemKey

Schema: `ItemKeySchema` (schemas.ts)

Generic composite item key used by multi-key layers.

```ts
export type ItemKey = {
  [key: string]: ProtocolValue;
};
```

### PrimitiveItemKey

Schema: `PrimitiveItemKeySchema` (schemas.ts)

Single-field item key accepted by layers with a primitive registry key.

```ts
export type PrimitiveItemKey = string | number;
```

### ProtocolVersion

Schema: `ProtocolVersionSchema` (schemas.ts)

Parsed semantic version used for protocol negotiation.

```ts
export type ProtocolVersion = string;
```

### ActionTarget

Schema: `ActionTargetSchema` (schemas.ts)

Concrete target required by non-model actions. The binding validates current existence, containment, and exact agreement with the action's declared scope.

```ts
export type ActionTarget =
  | {
      type: 'env';
      env_id: string;
      [x: string]: never;
    }
  | {
      type: 'layer';
      env_id: string;
      layer_id: string;
      [x: string]: never;
    }
  | {
      type: 'agent';
      env_id: string;
      layer_id: string;
      agent_id: string | number;
      [x: string]: never;
    };
```

### ActionExecutionError

Schema: `ActionExecutionErrorSchema` (schemas.ts)

Structured action or protocol operation failure; its presence ends the active continuous action loop.

```ts
export type ActionExecutionError = {
  /**
   * Stable machine-readable failure category.
   */
  code: string;
  /**
   * Human-readable failure detail.
   */
  message: string;
  /**
   * Optional binding-defined structured context.
   */
  data?: ProtocolValue | undefined;
  [x: string]: never;
};
```

### MonitorRenderHint

Schema: `MonitorRenderHintSchema` (schemas.ts)

Renderer presentation suggestion for a monitor's current value. `auto` or omission selects tree for records, table for arrays, and text otherwise; incompatible hints fall back to a bounded text/raw representation.

```ts
export type MonitorRenderHint = 'auto' | 'tree' | 'table' | 'text';
```

### MonitorMetadata

Schema: `MonitorMetadataSchema` (schemas.ts)

Definition for a current-value monitor; monitor history belongs in charts.

```ts
export type MonitorMetadata = {
  /**
   * Stable current-value monitor identity.
   */
  id: string;
  label: string;
  render_hint?: MonitorRenderHint | undefined;
  [x: string]: never;
};
```

### RestorableEnvironment

Schema: `RestorableEnvironmentSchema` (schemas.ts)

Complete projected state for one environment in a scene restore, never a diff. Omitted item arrays on item-bearing layers mean empty collections.

```ts
export type RestorableEnvironment = {
  /**
   * Environment identity to restore.
   */
  id: string;
  /**
   * Environment geometry family.
   */
  type: 'uniform' | '2d';
  /**
   * Complete layer state, not layer item diffs.
   */
  layers: {
    layer_id: string;
    layer_type: string;
    dependency_layer_ids?:
      | {
          [key: string]: string;
        }
      | undefined;
    metadata?: ProtocolRecord | undefined;
    items?: ProtocolRecord[] | undefined;
    [x: string]: never;
  }[];
  [x: string]: never;
};
```

### Checkpoint

Schema: `CheckpointSchema` (schemas.ts)

Opaque full-state checkpoint carried as base64/data URL JSON or MessagePack bytes.

```ts
export type Checkpoint = {
  /**
   * Canonical checkpoint wire encoding selected by the emitting binding.
   */
  encoding: string;
  /**
   * JSON-compatible encoded bytes or native MessagePack `Uint8Array`.
   */
  data: string | Uint8Array;
  [x: string]: never;
};
```

### LogLevel

Schema: `LogLevelSchema` (schemas.ts)

Severity level for a simulator log entry.

```ts
export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'critical';
```
