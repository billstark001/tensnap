import { z } from 'zod';
import { isEncodedBinaryString } from '../utils/binary';

const BinaryPayloadStringSchema = z.string().refine(
  (value) => isEncodedBinaryString(value),
  'Expected a base64 string or a base64 data URL for binary payload data.',
);

const BinaryPayloadDataSchema = z.union([BinaryPayloadStringSchema, z.instanceof(Uint8Array)]);

export const AgentIdSchema = z.union([z.string(), z.number()]);
export const BuiltinAgentIconSchema = z.enum([
  'arrow',
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'hexagon',
  'cross',
  'plus',
  'pentagon',
]);
export const AssetAgentIconSchema = z.string().regex(/^asset:.+$/);
export const AgentIconSchema = z.union([BuiltinAgentIconSchema, AssetAgentIconSchema]);

export const AgentSchema = z.object({
  id: AgentIdSchema,
  color: z.string().optional(),
  icon: AgentIconSchema.optional(),
  size: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).loose();

export const AgentDiffSchema = z.object({ id: AgentIdSchema }).loose();

export const EdgeDataSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
  directed: z.boolean().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export const EdgeDiffSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
}).loose();

export const ItemSchema = z.record(z.string(), z.unknown());
export const ItemDiffSchema = z.record(z.string(), z.unknown());
export const ItemKeySchema = z.record(z.string(), z.unknown());

export const TrajectoryConfigSchema = z.object({
  id: AgentIdSchema,
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export const TrajectoryConfigDiffSchema = z.object({
  id: AgentIdSchema,
}).loose();

export const NumberParameterSchema = z.object({
  id: z.string(),
  type: z.literal('number'),
  label: z.string(),
  value: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  allowRuntimeChange: z.boolean().optional(),
});

export const EnumParameterSchema = z.object({
  id: z.string(),
  type: z.literal('enum'),
  label: z.string(),
  value: z.string(),
  options: z.array(z.string()),
  labels: z.record(z.string(), z.string()).optional(),
  allowRuntimeChange: z.boolean().optional(),
});

export const BooleanParameterSchema = z.object({
  id: z.string(),
  type: z.literal('boolean'),
  label: z.string(),
  value: z.boolean(),
  allowRuntimeChange: z.boolean().optional(),
});

export const StringParameterSchema = z.object({
  id: z.string(),
  type: z.literal('string'),
  label: z.string(),
  value: z.string(),
  allowRuntimeChange: z.boolean().optional(),
});

export const ParameterSchema = z.union([
  NumberParameterSchema,
  EnumParameterSchema,
  BooleanParameterSchema,
  StringParameterSchema,
]);

export const ActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  continuous: z.boolean().optional(),
  allowRuntimeChange: z.boolean().optional(),
});

export const ChartMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
});

export const ChartGroupMetadataSchema = ChartMetadataSchema.extend({
  dataList: z.array(ChartMetadataSchema).optional(),
});

export const ChartUpdateDataSchema = z.object({
  id: z.string(),
  time: z.number().optional(),
  value: z.unknown(),
});

export const ChartUpdateOperationSchema = z.object({
  id: z.string(),
  operation: z.literal('clear'),
});

export const MetadataUpdatePayloadSchema = z.object({
  time: z.number().optional(),
}).loose();

export const StateSyncBoundaryPayloadSchema = z.object({
  request_id: z.string().optional(),
});

export const TickTimingBreakdownSchema = z.object({
  simulate_ms: z.number().nonnegative().optional(),
  communicate_ms: z.number().nonnegative().optional(),
  render_ms: z.number().nonnegative().optional(),
}).catchall(z.number().nonnegative());

export const ActionEndPayloadSchema = z.object({
  id: z.string(),
  tick_id: z.string().optional(),
  continue: z.boolean().optional(),
  timings: TickTimingBreakdownSchema.optional(),
});

export const ActionDeletePayloadSchema = z.object({ id: z.string() });

export const EnvCreatePayloadSchema = z.object({
  id: z.string(),
  type: z.enum(['uniform', '2d']),
});

export const EnvDeletePayloadSchema = z.object({ id: z.string() });

export const EnvLayerCreatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  layer_type: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const EnvLayerUpdatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  data: z.record(z.string(), z.unknown()),
});

export const EnvLayerDeletePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
});

export const ItemCreatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  items: z.array(ItemSchema),
});

export const ItemUpdatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  items: z.array(ItemDiffSchema),
});

export const ItemDeletePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  items: z.union([z.array(AgentIdSchema), z.array(ItemKeySchema)]),
});

export const AgentCreatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  agents: z.array(AgentSchema),
});

export const AgentUpdatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  agents: z.array(AgentDiffSchema),
});

export const AgentDeletePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  ids: z.array(AgentIdSchema),
});

export const EdgeCreatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  edges: z.array(EdgeDataSchema),
});

export const EdgeUpdatePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  edges: z.array(EdgeDiffSchema),
});

export const EdgeDeletePayloadSchema = z.object({
  env_id: z.string(),
  layer_id: z.string(),
  edges: z.array(z.object({ source: AgentIdSchema, target: AgentIdSchema })),
});

export const ParameterDeletePayloadSchema = z.object({ id: z.string() });

export const ParameterSyncPayloadSchema = z.object({
  id: z.string(),
  value: z.unknown(),
});

export const ChartDeletePayloadSchema = z.object({ id: z.string() });

export const ChartUpdatePayloadSchema = z.object({
  updates: z.array(ChartUpdateDataSchema).optional(),
  operations: z.array(ChartUpdateOperationSchema).optional(),
});

export const LogLevelSchema = z.enum(['debug', 'info', 'warning', 'error', 'critical']);

export const LogPayloadSchema = z.object({
  message: z.string(),
  level: LogLevelSchema.optional(),
  target: z.string().optional(),
  timestamp: z.number().optional(),
  data: z.unknown().optional(),
});

export const ErrorPayloadSchema = z.object({ error: z.string() });

export const AssetMetaSchema = z.object({
  id: z.string(),
  hash: z.string(),
  mime: z.string(),
  size: z.number(),
  label: z.string().optional(),
});

export const AssetMetaPayloadSchema = z.object({
  assets: z.array(AssetMetaSchema),
});

export const AssetDataPayloadSchema = z.object({
  id: z.string(),
  hash: z.string(),
  mime: z.string(),
  data: BinaryPayloadDataSchema,
});

export const AssetDeletePayloadSchema = z.object({
  ids: z.array(z.string()),
});

export const AssetSyncPayloadSchema = z.object({
  assets: z.record(z.string(), z.string()),
});

export const ScreenshotRequestPayloadSchema = z.object({
  request_id: z.string(),
  env_id: z.string().optional(),
  chart_id: z.string().optional(),
  format: z.enum(['png', 'jpeg']).optional(),
  quality: z.number().min(0).max(1).optional(),
});

export const ScreenshotResponsePayloadSchema = z.object({
  request_id: z.string(),
  data: BinaryPayloadDataSchema.optional(),
  mime: z.string().optional(),
  error: z.string().optional(),
});

export const StateSyncRequestSchema = z.object({
  request_id: z.string().optional(),
  parameters: z.array(ParameterSchema),
  actions: z.array(ActionSchema),
  envs: z.array(z.object({
    id: z.string(),
    type: z.string(),
    layers: z.array(z.object({ layer_id: z.string(), layer_type: z.string() })),
  })),
  charts: z.array(ChartMetadataSchema),
});

export const ParameterChangePayloadSchema = z.object({
  id: z.string(),
  value: z.unknown(),
});

export const ActionStartPayloadSchema = z.object({
  id: z.string(),
  tick_id: z.string().optional(),
  continuous: z.boolean().optional(),
});

export const SimulatorToRendererMessageSchema = z.object({
  type: z.enum([
    'metadata_update',
    'state_sync_begin',
    'state_sync_end',
    'action_end',
    'action_create',
    'action_update',
    'action_delete',
    'env_create',
    'env_delete',
    'env_layer_create',
    'env_layer_update',
    'env_layer_delete',
    'item_create',
    'item_update',
    'item_delete',
    'agent_create',
    'agent_update',
    'agent_delete',
    'edge_create',
    'edge_update',
    'edge_delete',
    'param_create',
    'param_update',
    'param_delete',
    'param_sync',
    'chart_create',
    'chart_update',
    'chart_delete',
    'asset_meta',
    'asset_data',
    'asset_delete',
    'screenshot_request',
    'log',
    'error',
  ]),
  payload: z.unknown(),
  timestamp: z.number().optional(),
});

export const RendererToSimulatorMessageSchema = z.object({
  type: z.enum([
    'state_sync',
    'param_change',
    'action_start',
    'asset_sync',
    'screenshot_response',
    'error',
  ]),
  payload: z.unknown(),
  timestamp: z.number().optional(),
});

export const AnyProtocolMessageSchema = z.union([
  SimulatorToRendererMessageSchema,
  RendererToSimulatorMessageSchema,
]);

export const getPayloadSchema = (type: string) => {
  switch (type) {
    case 'metadata_update': return MetadataUpdatePayloadSchema;
    case 'state_sync_begin': return StateSyncBoundaryPayloadSchema;
    case 'state_sync_end': return StateSyncBoundaryPayloadSchema;
    case 'action_end': return ActionEndPayloadSchema;
    case 'action_create': return ActionSchema;
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
    case 'agent_create': return AgentCreatePayloadSchema;
    case 'agent_update': return AgentUpdatePayloadSchema;
    case 'agent_delete': return AgentDeletePayloadSchema;
    case 'edge_create': return EdgeCreatePayloadSchema;
    case 'edge_update': return EdgeUpdatePayloadSchema;
    case 'edge_delete': return EdgeDeletePayloadSchema;
    case 'param_create': return ParameterSchema;
    case 'param_update': return ParameterSchema;
    case 'param_delete': return ParameterDeletePayloadSchema;
    case 'param_sync': return ParameterSyncPayloadSchema;
    case 'chart_create': return ChartGroupMetadataSchema;
    case 'chart_update': return ChartUpdatePayloadSchema;
    case 'chart_delete': return ChartDeletePayloadSchema;
    case 'asset_meta': return AssetMetaPayloadSchema;
    case 'asset_data': return AssetDataPayloadSchema;
    case 'asset_delete': return AssetDeletePayloadSchema;
    case 'screenshot_request': return ScreenshotRequestPayloadSchema;
    case 'screenshot_response': return ScreenshotResponsePayloadSchema;
    case 'log': return LogPayloadSchema;
    case 'error': return ErrorPayloadSchema;
    case 'state_sync': return StateSyncRequestSchema;
    case 'param_change': return ParameterChangePayloadSchema;
    case 'action_start': return ActionStartPayloadSchema;
    case 'asset_sync': return AssetSyncPayloadSchema;
    default: return z.unknown();
  }
};

/** @deprecated Use SimulatorToRendererMessageSchema. */
export const ServerToClientMessageSchema = SimulatorToRendererMessageSchema;
/** @deprecated Use RendererToSimulatorMessageSchema. */
export const ClientToServerMessageSchema = RendererToSimulatorMessageSchema;