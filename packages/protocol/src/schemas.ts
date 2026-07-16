import { z } from 'zod';
import { AssetMetaSchema } from './asset';
import {
  ChartGroupMetadataSchema,
  ChartMetadataSchema,
  ChartUpdateDataSchema,
  ChartUpdateOperationSchema,
} from './chart';
import { ActionSchema, ParameterSchema } from './controls';
import { isEncodedBinaryString } from './binary';

/** A JSON/MessagePack value after the outer codec has decoded bytes. */
export type ProtocolValue =
  | null
  | boolean
  | number
  | string
  | ProtocolValue[]
  | { [key: string]: ProtocolValue };

/** Recursive portable value accepted in ordinary protocol records; binary data uses dedicated fields. */
export const ProtocolValueSchema: z.ZodType<ProtocolValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(ProtocolValueSchema),
  z.record(z.string(), ProtocolValueSchema),
]));
/** String-keyed map of portable protocol values. */
export const ProtocolRecordSchema = z.record(z.string(), ProtocolValueSchema);

const NonEmptyStringSchema = z.string().min(1);
const FiniteNumberSchema = z.number();
const BinaryPayloadStringSchema = z.string().refine(
  (value) => isEncodedBinaryString(value),
  'Expected a base64 string or a base64 data URL for binary payload data.',
);
const BinaryPayloadDataSchema = z.union([BinaryPayloadStringSchema, z.instanceof(Uint8Array)]);

/** Generic layer item; concrete layer registries define its fields and key. */
export const ItemSchema = ProtocolRecordSchema;
/** Generic field-level layer-item update; it must include the registry key fields. */
export const ItemDiffSchema = ProtocolRecordSchema;
/** Generic composite item key used by multi-key layers. */
export const ItemKeySchema = ProtocolRecordSchema;
/** Single-field item key accepted by layers with a primitive registry key. */
export const PrimitiveItemKeySchema = z.union([z.string(), FiniteNumberSchema]);

/** Parsed semantic version used for protocol negotiation. */
export const ProtocolVersionSchema = z.string().regex(/^\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?$/);

/** Immutable information emitted by a simulator before any other session message. */
export const SimulatorInfoPayloadSchema = z.object({
  /** Exact wire-contract version selected for this session. */
  protocol_version: z.literal('0.3'),
  /** Binding implementation identity. */
  binding: z.object({
    name: NonEmptyStringSchema,
    version: NonEmptyStringSchema,
    language: z.string().optional(),
  }).strict(),
  /** Stable model kind identity; model mismatch isolates an existing project. */
  model: z.object({
    id: NonEmptyStringSchema,
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    state_schema_version: z.string().optional(),
  }).strict(),
  /** Identity of this running simulator instance; changes require replace sync. */
  instance_id: NonEmptyStringSchema,
  /** Explicitly supported optional protocol capabilities. */
  capabilities: z.array(NonEmptyStringSchema),
  /** Binding-defined details for declared capabilities only. */
  capability_details: ProtocolRecordSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.capabilities).size !== value.capabilities.length) {
    ctx.addIssue({ code: 'custom', message: 'Capabilities must not contain duplicates.', path: ['capabilities'] });
  }
});

/** Mutable scenario metadata. Identity and capability fields are not accepted here. */
export const MetadataUpdatePayloadSchema = z.object({
  /** Current scenario time; omitted metadata keys retain their prior values. */
  time: FiniteNumberSchema.optional(),
}).catchall(ProtocolValueSchema).superRefine((value, ctx) => {
  for (const key of ['protocol_version', 'binding', 'model', 'instance_id', 'capabilities', 'capability_details']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      ctx.addIssue({ code: 'custom', message: `${key} belongs in simulator_info, not metadata_update.`, path: [key] });
    }
  }
});

/** Opens a non-nestable state-sync replay transaction; no replay state commits before its matching end. */
export const StateSyncBeginPayloadSchema = z.object({
  /** Correlates this transaction with the renderer's state_sync request. */
  request_id: NonEmptyStringSchema,
  /** Must match the accepted simulator model identity. */
  model_id: NonEmptyStringSchema,
  /** Must match the accepted simulator instance identity. */
  instance_id: NonEmptyStringSchema,
  /** `replace` starts from empty state; `reconcile` starts from committed state. */
  mode: z.enum(['replace', 'reconcile']),
}).strict();

/** Closes the active state-sync transaction and commits its staged renderer state. */
export const StateSyncEndPayloadSchema = z.object({
  /** Must equal the active state-sync request. */
  request_id: NonEmptyStringSchema,
  /** Opaque simulator revision of the committed state. */
  state_revision: z.string(),
}).strict();

/** Optional non-negative timing buckets for action diagnostics; extra numeric buckets are binding-defined. */
export const TickTimingBreakdownSchema = z.object({
  /** Time spent simulating the model. */
  simulate_ms: z.number().nonnegative().finite().optional(),
  /** Time spent encoding, transport, or binding communication. */
  communicate_ms: z.number().nonnegative().finite().optional(),
  /** Time spent rendering or presenting state. */
  render_ms: z.number().nonnegative().finite().optional(),
}).catchall(z.number().nonnegative().finite());

/** Concrete target required by non-model actions; the binding validates that it exists and matches scope. */
export const ActionTargetSchema = z.union([
  z.object({ type: z.literal('env'), env_id: NonEmptyStringSchema }).strict(),
  z.object({ type: z.literal('layer'), env_id: NonEmptyStringSchema, layer_id: NonEmptyStringSchema }).strict(),
  z.object({
    type: z.literal('agent'),
    env_id: NonEmptyStringSchema,
    layer_id: NonEmptyStringSchema,
    agent_id: z.union([z.string(), FiniteNumberSchema]),
  }).strict(),
]);

/** Renderer request to execute one simulator-owned action. Every parsed request receives one result. */
export const ActionInvokePayloadSchema = z.object({
  /** Action identity from the simulator-owned action definition. */
  id: NonEmptyStringSchema,
  /** Correlation ID echoed by exactly one action_result. */
  request_id: NonEmptyStringSchema,
  /** Renderer loop intent; it never changes action definition metadata. */
  continuous: z.boolean().optional(),
  /** Optional concrete environment, layer, or agent target. */
  target: ActionTargetSchema.optional(),
  /** User-supplied arguments keyed by declared action kwarg name. */
  kwargs: ProtocolRecordSchema.optional(),
}).strict();

/** Structured action or protocol operation failure; its presence ends the active continuous action loop. */
export const ActionExecutionErrorSchema = z.object({
  /** Stable machine-readable failure category. */
  code: NonEmptyStringSchema,
  /** Human-readable failure detail. */
  message: z.string(),
  /** Optional binding-defined structured context. */
  data: ProtocolValueSchema.optional(),
}).strict();

/** Correlated completion for an action invocation, sent only after its visible state updates. */
export const ActionResultPayloadSchema = z.object({
  /** Action identity from the correlated invocation. */
  id: NonEmptyStringSchema,
  /** Required correlation ID from action_invoke. */
  request_id: NonEmptyStringSchema,
  /** Only true permits another renderer-driven continuous invocation. */
  should_continue: z.boolean().optional(),
  /** Structured execution failure; an error ends the active continuous loop. */
  error: ActionExecutionErrorSchema.optional(),
  timings: TickTimingBreakdownSchema.optional(),
}).strict();

/** Removes a simulator-owned action definition by ID; missing IDs are idempotent no-ops. */
export const ActionDeletePayloadSchema = z.object({ id: NonEmptyStringSchema }).strict();
/** Creates one scenario environment container. `2d` covers both grid and graph layouts. */
export const EnvCreatePayloadSchema = z.object({
  /** Stable environment identity. */
  id: NonEmptyStringSchema,
  /** Environment geometry family; layers provide rendering semantics. */
  type: z.enum(['uniform', '2d']),
}).strict();
/** Removes an environment and its layers; missing IDs are idempotent no-ops. */
export const EnvDeletePayloadSchema = z.object({ id: NonEmptyStringSchema }).strict();
/** Creates an environment-local layer with fixed dependency topology. */
export const EnvLayerCreatePayloadSchema = z.object({
  /** Parent environment identity. */
  env_id: NonEmptyStringSchema,
  /** Stable layer identity within the environment. */
  layer_id: NonEmptyStringSchema,
  /** Registry key that determines item schema and primary key. */
  layer_type: NonEmptyStringSchema,
  /** Create-time dependency topology; changing it requires recreating the layer or environment. */
  dependency_layer_ids: z.record(z.string(), NonEmptyStringSchema).optional(),
  /** Layer configuration, never layer item data. */
  metadata: ProtocolRecordSchema.optional(),
}).strict();
/** Replaces a layer's metadata as a whole; it cannot mutate items or dependency topology. */
export const EnvLayerUpdatePayloadSchema = z.object({
  env_id: NonEmptyStringSchema,
  layer_id: NonEmptyStringSchema,
  /** Complete replacement configuration for the layer. */
  metadata: ProtocolRecordSchema,
}).strict();
/** Removes one layer from an environment; missing IDs are idempotent no-ops. */
export const EnvLayerDeletePayloadSchema = z.object({
  env_id: NonEmptyStringSchema,
  layer_id: NonEmptyStringSchema,
}).strict();
/** Creates layer-owned items conforming to the target layer registry. */
export const ItemCreatePayloadSchema = z.object({
  env_id: NonEmptyStringSchema,
  layer_id: NonEmptyStringSchema,
  /** New items; duplicate keys reject the surrounding transaction. */
  items: z.array(ItemSchema),
}).strict();
/** Applies field-level changes to existing layer items. */
export const ItemUpdatePayloadSchema = z.object({
  env_id: NonEmptyStringSchema,
  layer_id: NonEmptyStringSchema,
  /** Diffs including every primary-key field required by the layer registry. */
  items: z.array(ItemDiffSchema),
}).strict();
/** Deletes layer-owned items by their primitive or composite registry keys. */
export const ItemDeletePayloadSchema = z.object({
  env_id: NonEmptyStringSchema,
  layer_id: NonEmptyStringSchema,
  /** Single-key layers use primitives; multi-key layers use key objects. */
  items: z.union([z.array(PrimitiveItemKeySchema), z.array(ItemKeySchema)]),
}).strict();

/** Removes a parameter definition by ID; missing IDs are idempotent no-ops. */
export const ParameterDeletePayloadSchema = z.object({ id: NonEmptyStringSchema }).strict();
/** Simulator correction for an optimistic parameter edit; definition changes use `param_update` instead. */
export const ParameterSyncPayloadSchema = z.object({
  /** Existing parameter identity. */
  id: NonEmptyStringSchema,
  /** Rejected or canonicalized simulator value. */
  value: ProtocolValueSchema,
}).strict();

/** Deletes an explicitly typed chart group or series; deleting a group also deletes its series. */
export const ChartDeletePayloadSchema = z.object({
  /** Target kind; a bare ID never implies a group or series. */
  kind: z.enum(['group', 'series']),
  /** Target identity. */
  id: NonEmptyStringSchema,
}).strict();
/** Incremental chart data and/or explicit clear/truncate operations; at least one collection is required. */
export const ChartUpdatePayloadSchema = z.object({
  /** Points to append or merge. */
  updates: z.array(ChartUpdateDataSchema).optional(),
  /** Operations applied without guessing chart target kind. */
  operations: z.array(ChartUpdateOperationSchema).optional(),
}).strict().refine((value) => value.updates !== undefined || value.operations !== undefined, {
  message: 'chart_update requires updates or operations.',
});

/** Renderer presentation suggestion for a monitor's current value. */
export const MonitorRenderHintSchema = z.enum(['auto', 'tree', 'table', 'text']);
/** Definition for a current-value monitor; monitor history belongs in charts. */
export const MonitorMetadataSchema = z.object({
  /** Stable current-value monitor identity. */
  id: NonEmptyStringSchema,
  label: z.string(),
  render_hint: MonitorRenderHintSchema.optional(),
}).strict();
/** Replaces the current value of an existing monitor. */
export const MonitorUpdatePayloadSchema = z.object({
  /** Existing monitor identity. */
  id: NonEmptyStringSchema,
  /** Replaces the current monitor value; it is not an append stream. */
  value: ProtocolValueSchema,
  revision: z.union([z.string(), FiniteNumberSchema]).optional(),
}).strict();
/** Removes a monitor by ID; missing IDs are idempotent no-ops. */
export const MonitorDeletePayloadSchema = z.object({ id: NonEmptyStringSchema }).strict();

/** Complete projected state for one environment in a scene restore; omitted item arrays mean empty. */
export const RestorableEnvironmentSchema = z.object({
  /** Environment identity to restore. */
  id: NonEmptyStringSchema,
  /** Environment geometry family. */
  type: z.enum(['uniform', '2d']),
  /** Complete layer state, not layer item diffs. */
  layers: z.array(z.object({
    layer_id: NonEmptyStringSchema,
    layer_type: NonEmptyStringSchema,
    dependency_layer_ids: z.record(z.string(), NonEmptyStringSchema).optional(),
    metadata: ProtocolRecordSchema.optional(),
    items: z.array(ItemSchema).optional(),
  }).strict()),
}).strict();

/** Opaque full-state checkpoint carried as base64/data URL JSON or MessagePack bytes. */
export const CheckpointSchema = z.object({
  /** Canonical checkpoint wire encoding selected by the emitting binding. */
  encoding: NonEmptyStringSchema,
  /** JSON-compatible encoded bytes or native MessagePack `Uint8Array`. */
  data: BinaryPayloadDataSchema,
}).strict();
/** Renderer request to restore checkpoint and/or projected state in a separate atomic transaction. */
export const SceneRestorePayloadSchema = z.object({
  /** Correlates the restore transaction. */
  request_id: NonEmptyStringSchema,
  /** Target model kind; mismatch is rejected without mutation. */
  model_id: NonEmptyStringSchema,
  /** Optional compatibility guard for the checkpoint/projected state shape. */
  state_schema_version: z.string().optional(),
  /** Optional stale-instance guard. */
  expected_instance_id: z.string().optional(),
  /** Opaque full-state representation, applied before projected fields. */
  checkpoint: CheckpointSchema.optional(),
  /** Explicit replacement scenario time, applied after checkpoint, parameters, and environments. */
  time: FiniteNumberSchema.optional(),
  /** Parameter values to overlay after an optional checkpoint. */
  parameters: z.array(z.object({ id: NonEmptyStringSchema, value: ProtocolValueSchema }).strict()).optional(),
  /** Projected environment state, applied after parameters. */
  envs: z.array(RestorableEnvironmentSchema).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.checkpoint === undefined && value.time === undefined && value.parameters === undefined && value.envs === undefined) {
    ctx.addIssue({ code: 'custom', message: 'scene_restore requires checkpoint, time, parameters, or environments.' });
  }
});
/** Opens the staged scene-restore replay corresponding to a restore request. */
export const SceneRestoreBeginPayloadSchema = z.object({ request_id: NonEmptyStringSchema }).strict();
/** Completes a scene restore; only `ok` commits the staged renderer state. */
export const SceneRestoreEndPayloadSchema = z.object({
  /** Must equal the active restore request. */
  request_id: NonEmptyStringSchema,
  /** Only `ok` commits the staged restored scenario. */
  status: z.enum(['ok', 'rejected', 'failed']),
  error: ActionExecutionErrorSchema.optional(),
}).strict();
/** Requests an optional exact checkpoint capture at an action boundary. */
export const SceneCapturePayloadSchema = z.object({ request_id: NonEmptyStringSchema }).strict();
/** Correlated result for scene capture; checkpoints never travel in action results. */
export const SceneCaptureResultPayloadSchema = z.object({
  request_id: NonEmptyStringSchema,
  model_id: NonEmptyStringSchema,
  state_schema_version: z.string().optional(),
  checkpoint: CheckpointSchema,
}).strict();

/** Severity level for a simulator log entry. */
export const LogLevelSchema = z.enum(['debug', 'info', 'warning', 'error', 'critical']);
/** Structured simulator diagnostic log entry. */
export const LogPayloadSchema = z.object({
  /** Human-readable log text. */
  message: z.string(),
  /** Severity; omitted entries use the renderer's default log presentation. */
  level: LogLevelSchema.optional(),
  /** Optional simulator-defined target/category. */
  target: z.string().optional(),
  /** Optional source timestamp. */
  timestamp: FiniteNumberSchema.optional(),
  /** Optional structured diagnostic context. */
  data: ProtocolValueSchema.optional(),
}).strict();
/** Independent protocol or runtime error that cannot be expressed as a correlated action result. */
export const ErrorPayloadSchema = z.object({
  code: NonEmptyStringSchema,
  message: z.string(),
  request_id: z.string().optional(),
  path: z.string().optional(),
  retryable: z.boolean().optional(),
  data: ProtocolValueSchema.optional(),
}).strict();

/** Announces cacheable content-addressed assets without transferring their bytes. */
export const AssetMetadataPayloadSchema = z.object({ assets: z.array(AssetMetaSchema) }).strict();
/** Transfers bytes for one previously announced asset. */
export const AssetDataPayloadSchema = z.object({
  id: NonEmptyStringSchema,
  hash: NonEmptyStringSchema,
  mime: NonEmptyStringSchema,
  data: BinaryPayloadDataSchema,
}).strict();
/** Removes renderer-side cached assets by ID. */
export const AssetDeletePayloadSchema = z.object({ ids: z.array(NonEmptyStringSchema) }).strict();
/** Renderer inventory of currently held asset hashes; it does not mutate simulator state. */
export const AssetSyncPayloadSchema = z.object({ assets: z.record(z.string(), z.string()) }).strict();
/** Asks the renderer to capture exactly one environment or chart. */
export const ScreenshotRequestPayloadSchema = z.object({
  request_id: NonEmptyStringSchema,
  env_id: NonEmptyStringSchema.optional(),
  chart_id: NonEmptyStringSchema.optional(),
  format: z.enum(['png', 'jpeg']).optional(),
  quality: z.number().min(0).max(1).finite().optional(),
}).strict().refine((value) => Number(value.env_id !== undefined) + Number(value.chart_id !== undefined) === 1, {
  message: 'screenshot_request requires exactly one target.',
});
/** Correlated renderer capture result containing image bytes or a structured error. */
export const ScreenshotResponsePayloadSchema = z.object({
  request_id: NonEmptyStringSchema,
  data: BinaryPayloadDataSchema.optional(),
  mime: z.string().optional(),
  error: ActionExecutionErrorSchema.optional(),
}).strict();

const StateSyncEnvironmentSchema = z.object({
  id: NonEmptyStringSchema,
  type: NonEmptyStringSchema,
  layers: z.array(z.object({ layer_id: NonEmptyStringSchema, layer_type: NonEmptyStringSchema }).strict()),
}).strict();
/** Renderer read-only inventory request that begins simulator-to-renderer state replay. */
export const StateSyncRequestSchema = z.object({
  /** Renderer-generated transaction identity. */
  request_id: NonEmptyStringSchema,
  /** Simulator model identity expected by the renderer. */
  model_id: NonEmptyStringSchema,
  /** Last committed instance identity, when the renderer has one. */
  instance_id: z.string().optional(),
  /** Read-only renderer inventory; simulators must not mutate it. */
  state_revision: z.string().optional(),
  /** Last committed renderer metadata revision, when available. */
  metadata_revision: z.string().optional(),
  /** Renderer-held parameter definitions; inventory only. */
  parameters: z.array(ParameterSchema),
  /** Renderer-held action definitions; inventory only. */
  actions: z.array(ActionSchema),
  /** Renderer-held environment and layer topology; inventory only. */
  envs: z.array(StateSyncEnvironmentSchema),
  /** Renderer-held chart definitions; history is intentionally excluded. */
  charts: z.array(ChartMetadataSchema),
  /** Renderer-held monitor definitions; current values are intentionally excluded. */
  monitors: z.array(MonitorMetadataSchema),
}).strict();
/** Renderer optimistic parameter edit; simulators reply only when rejecting or canonicalizing via `param_sync`. */
export const ParameterChangePayloadSchema = z.object({ id: NonEmptyStringSchema, value: ProtocolValueSchema }).strict();

const SimulatorMessageSchemas = [
  z.object({ type: z.literal('simulator_info'), payload: SimulatorInfoPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('metadata_update'), payload: MetadataUpdatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('state_sync_begin'), payload: StateSyncBeginPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('state_sync_end'), payload: StateSyncEndPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('action_result'), payload: ActionResultPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('action_create'), payload: ActionSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('action_update'), payload: ActionSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('action_delete'), payload: ActionDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('env_create'), payload: EnvCreatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('env_delete'), payload: EnvDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('env_layer_create'), payload: EnvLayerCreatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('env_layer_update'), payload: EnvLayerUpdatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('env_layer_delete'), payload: EnvLayerDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('item_create'), payload: ItemCreatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('item_update'), payload: ItemUpdatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('item_delete'), payload: ItemDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('param_create'), payload: ParameterSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('param_update'), payload: ParameterSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('param_delete'), payload: ParameterDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('param_sync'), payload: ParameterSyncPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('chart_create'), payload: ChartGroupMetadataSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('chart_update'), payload: ChartUpdatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('chart_delete'), payload: ChartDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('monitor_create'), payload: MonitorMetadataSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('monitor_update'), payload: MonitorUpdatePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('monitor_delete'), payload: MonitorDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('asset_metadata'), payload: AssetMetadataPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('asset_data'), payload: AssetDataPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('asset_delete'), payload: AssetDeletePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('screenshot_request'), payload: ScreenshotRequestPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('scene_restore_begin'), payload: SceneRestoreBeginPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('scene_restore_end'), payload: SceneRestoreEndPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('scene_capture_result'), payload: SceneCaptureResultPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('log'), payload: LogPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('error'), payload: ErrorPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
] as const;
/** Canonical strict envelope union for simulator-originated protocol messages. */
export const SimulatorToRendererMessageSchema = z.union(SimulatorMessageSchemas);

const RendererMessageSchemas = [
  z.object({ type: z.literal('state_sync'), payload: StateSyncRequestSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('param_change'), payload: ParameterChangePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('action_invoke'), payload: ActionInvokePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('asset_sync'), payload: AssetSyncPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('screenshot_response'), payload: ScreenshotResponsePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('scene_restore'), payload: SceneRestorePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('scene_capture'), payload: SceneCapturePayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
  z.object({ type: z.literal('error'), payload: ErrorPayloadSchema, timestamp: FiniteNumberSchema.optional() }).strict(),
] as const;
/** Canonical strict envelope union for renderer-originated protocol messages. */
export const RendererToSimulatorMessageSchema = z.union(RendererMessageSchemas);
/** Any canonical strict v0.3 protocol message. */
export const AnyProtocolMessageSchema = z.union([SimulatorToRendererMessageSchema, RendererToSimulatorMessageSchema]);

/** Retrieve the canonical payload validator for a core protocol type. */
export function getPayloadSchema(type: string): z.ZodType | undefined {
  switch (type) {
    case 'simulator_info': return SimulatorInfoPayloadSchema;
    case 'metadata_update': return MetadataUpdatePayloadSchema;
    case 'state_sync_begin': return StateSyncBeginPayloadSchema;
    case 'state_sync_end': return StateSyncEndPayloadSchema;
    case 'action_invoke': return ActionInvokePayloadSchema;
    case 'action_result': return ActionResultPayloadSchema;
    case 'action_create':
    case 'action_update': return ActionSchema;
    case 'action_delete': return ActionDeletePayloadSchema;
    case 'env_create': return EnvCreatePayloadSchema;
    case 'env_delete': return EnvDeletePayloadSchema;
    case 'env_layer_create': return EnvLayerCreatePayloadSchema;
    case 'env_layer_update': return EnvLayerUpdatePayloadSchema;
    case 'env_layer_delete': return EnvLayerDeletePayloadSchema;
    case 'item_create': return ItemCreatePayloadSchema;
    case 'item_update': return ItemUpdatePayloadSchema;
    case 'item_delete': return ItemDeletePayloadSchema;
    case 'param_create':
    case 'param_update': return ParameterSchema;
    case 'param_delete': return ParameterDeletePayloadSchema;
    case 'param_sync': return ParameterSyncPayloadSchema;
    case 'param_change': return ParameterChangePayloadSchema;
    case 'chart_create': return ChartGroupMetadataSchema;
    case 'chart_update': return ChartUpdatePayloadSchema;
    case 'chart_delete': return ChartDeletePayloadSchema;
    case 'monitor_create': return MonitorMetadataSchema;
    case 'monitor_update': return MonitorUpdatePayloadSchema;
    case 'monitor_delete': return MonitorDeletePayloadSchema;
    case 'asset_metadata': return AssetMetadataPayloadSchema;
    case 'asset_data': return AssetDataPayloadSchema;
    case 'asset_delete': return AssetDeletePayloadSchema;
    case 'asset_sync': return AssetSyncPayloadSchema;
    case 'screenshot_request': return ScreenshotRequestPayloadSchema;
    case 'screenshot_response': return ScreenshotResponsePayloadSchema;
    case 'scene_restore': return SceneRestorePayloadSchema;
    case 'scene_restore_begin': return SceneRestoreBeginPayloadSchema;
    case 'scene_restore_end': return SceneRestoreEndPayloadSchema;
    case 'scene_capture': return SceneCapturePayloadSchema;
    case 'scene_capture_result': return SceneCaptureResultPayloadSchema;
    case 'log': return LogPayloadSchema;
    case 'error': return ErrorPayloadSchema;
    default: return undefined;
  }
}
