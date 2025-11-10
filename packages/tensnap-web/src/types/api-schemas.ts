import { z } from 'zod';

// Agent schemas
export const AgentIconSchema = z.enum(['arrow', 'circle', 'square', 'triangle']);

export const AgentSchema = z.object({
  id: z.union([z.string(), z.number()]),
  color: z.string().optional(),
  icon: AgentIconSchema.optional(),
  size: z.number().optional(),
  data: z.record(z.string(), z.any()).optional(),
});

// Grid environment schemas
export const GridAgentSchema = AgentSchema.extend({
  x: z.number(),
  y: z.number(),
  heading: z.number(),
});

export const PureGridEnvironmentSchema = z.object({
  width: z.number(),
  height: z.number(),
  background: z.union([z.instanceof(Uint8Array), z.string()]).optional(),
});

export const GridEnvironmentSchema = PureGridEnvironmentSchema.extend({
  id: z.string(),
  type: z.literal('grid'),
  label: z.string().optional(),
  agents: z.array(GridAgentSchema),
});

// Graph environment schemas
export const GraphAgentSchema = AgentSchema.extend({
  x: z.number().optional(),
  y: z.number().optional(),
});

export const GraphEdgeSchema = z.object({
  source: z.union([z.string(), z.number()]),
  target: z.union([z.string(), z.number()]),
  directed: z.boolean().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  width: z.number().optional(),
  color: z.string().optional(),
});

export const PureGraphEnvironmentSchema = z.object({
  edges: z.array(GraphEdgeSchema),
});

export const GraphEnvironmentSchema = PureGraphEnvironmentSchema.extend({
  id: z.string(),
  type: z.literal('graph'),
  label: z.string().optional(),
  agents: z.array(GraphAgentSchema),
});

// Uniform environment schemas
export const PureUniformEnvironmentSchema = z.object({});

export const UniformEnvironmentSchema = PureUniformEnvironmentSchema.extend({
  id: z.string(),
  type: z.literal('uniform'),
  label: z.string().optional(),
  agents: z.array(AgentSchema),
});

export const EnvironmentSchema = z.union([
  GridEnvironmentSchema,
  GraphEnvironmentSchema,
  UniformEnvironmentSchema,
]);

// Parameter schemas
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

export const ActionParameterSchema = z.object({
  id: z.string(),
  type: z.literal('action'),
  label: z.string(),
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
  ActionParameterSchema,
  BooleanParameterSchema,
  StringParameterSchema,
]);

// Chart schemas
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
  value: z.any(),
});

export const ChartUpdateOperationSchema = z.object({
  id: z.string(),
  operation: z.literal('clear'),
});

// Payload schemas
export const TimeStepStartPayloadSchema = z.object({
  time: z.number(),
});

export const TimeStepEndPayloadSchema = z.object({
  time: z.number().optional(),
});

export const EnvironmentUpdatePayloadSchema = z.object({
  id: z.string(),
  data: z.union([PureGridEnvironmentSchema, PureGraphEnvironmentSchema, PureUniformEnvironmentSchema]),
  agents: z.array(AgentSchema).optional(),
});

export const AgentUpdatePayloadSchema = z.object({
  environment_id: z.string(),
  agent_id: z.union([z.string(), z.number()]),
  data: AgentSchema,
});

export const AgentBatchUpdatePayloadSchema = z.object({
  environment_id: z.string(),
  updates: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    data: AgentSchema,
  })),
});

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
  data: z.any().optional(),
});

export const StateSyncResponseSchema = z.object({
  mode: z.enum(['full', 'incremental']).optional(),
  
  added_parameters: z.array(ParameterSchema),
  removed_parameters: z.array(z.string()),
  updated_parameters: z.array(ParameterSchema),

  added_environments: z.array(EnvironmentSchema),
  removed_environments: z.array(z.string()),
  updated_environments: z.array(EnvironmentSchema),

  added_charts: z.array(ChartGroupMetadataSchema),
  removed_charts: z.array(z.string()),
  updated_charts: z.array(ChartGroupMetadataSchema),

  clear_charts: z.union([z.boolean(), z.array(z.string())]).optional(),
});

export const StateSyncRequestSchema = z.object({
  parameters: z.array(ParameterSchema),
  environments: z.array(z.any()), // Environment without agents - simplified for now
  charts: z.array(ChartMetadataSchema),
});

export const ParameterChangePayloadSchema = z.object({
  id: z.string(),
  value: z.any(),
});

export const ButtonClickPayloadSchema = z.object({
  action: z.string(),
});

export const ErrorPayloadSchema = z.object({
  error: z.string(),
});

// Message schemas
export const ServerToClientMessageSchema = z.object({
  type: z.enum([
    'time_step_start',
    'time_step_end',
    'environment_update',
    'agent_update',
    'agent_batch_update',
    'chart_update',
    'state_sync',
    'log',
    'error',
  ]),
  payload: z.any(),
  timestamp: z.number().optional(),
});

export const ClientToServerMessageSchema = z.object({
  type: z.enum([
    'state_sync',
    'parameter_change',
    'button_click',
    'error',
  ]),
  payload: z.any(),
  timestamp: z.number().optional(),
});

// Helper type to validate payloads based on message type
export const getPayloadSchema = (type: string) => {
  switch (type) {
    case 'time_step_start':
      return TimeStepStartPayloadSchema;
    case 'time_step_end':
      return TimeStepEndPayloadSchema;
    case 'environment_update':
      return EnvironmentUpdatePayloadSchema;
    case 'agent_update':
      return AgentUpdatePayloadSchema;
    case 'agent_batch_update':
      return AgentBatchUpdatePayloadSchema;
    case 'chart_update':
      return ChartUpdatePayloadSchema;
    case 'state_sync':
      return type === 'state_sync' ? StateSyncResponseSchema : StateSyncRequestSchema;
    case 'log':
      return LogPayloadSchema;
    case 'parameter_change':
      return ParameterChangePayloadSchema;
    case 'button_click':
      return ButtonClickPayloadSchema;
    case 'error':
      return ErrorPayloadSchema;
    default:
      return z.any();
  }
};
