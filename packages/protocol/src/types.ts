import type { z } from 'zod';
import type { Action, Parameter } from './controls';
import type {
  ActionDeletePayloadSchema,
  ActionInvokePayloadSchema,
  ActionResultPayloadSchema,
  ActionTargetSchema,
  AnyProtocolMessageSchema,
  AssetDataPayloadSchema,
  AssetDeletePayloadSchema,
  AssetMetadataPayloadSchema,
  AssetSyncPayloadSchema,
  ChartDeletePayloadSchema,
  ChartUpdatePayloadSchema,
  CheckpointSchema,
  EnvCreatePayloadSchema,
  EnvDeletePayloadSchema,
  EnvLayerCreatePayloadSchema,
  EnvLayerDeletePayloadSchema,
  EnvLayerUpdatePayloadSchema,
  ErrorPayloadSchema,
  ItemCreatePayloadSchema,
  ItemDeletePayloadSchema,
  ItemDiffSchema,
  ItemKeySchema,
  ItemSchema,
  ItemUpdatePayloadSchema,
  LogLevelSchema,
  LogPayloadSchema,
  MetadataUpdatePayloadSchema,
  MonitorDeletePayloadSchema,
  MonitorMetadataSchema,
  MonitorUpdatePayloadSchema,
  ParameterChangePayloadSchema,
  ParameterDeletePayloadSchema,
  ParameterSyncPayloadSchema,
  PrimitiveItemKeySchema,
  ProtocolValue,
  RendererToSimulatorMessageSchema,
  RestorableEnvironmentSchema,
  SceneCapturePayloadSchema,
  SceneCaptureResultPayloadSchema,
  SceneRestoreBeginPayloadSchema,
  SceneRestoreEndPayloadSchema,
  SceneRestorePayloadSchema,
  ScreenshotRequestPayloadSchema,
  ScreenshotResponsePayloadSchema,
  SimulatorInfoPayloadSchema,
  SimulatorToRendererMessageSchema,
  StateSyncBeginPayloadSchema,
  StateSyncEndPayloadSchema,
  StateSyncRequestSchema,
  TickTimingBreakdownSchema,
} from './schemas';

export type EnvironmentId = string;
export type ScenarioEnvironmentType = z.infer<typeof EnvCreatePayloadSchema>['type'];
export type ItemRecord = z.infer<typeof ItemSchema>;
export type ItemDiff = z.infer<typeof ItemDiffSchema>;
export type ItemKey = z.infer<typeof ItemKeySchema>;
export type PrimitiveItemKey = z.infer<typeof PrimitiveItemKeySchema>;
export type ItemDeleteItems = z.infer<typeof ItemDeletePayloadSchema>['items'];

export type SimulatorToRendererMessageType = z.infer<typeof SimulatorToRendererMessageSchema>['type'];
export type RendererToSimulatorMessageType = z.infer<typeof RendererToSimulatorMessageSchema>['type'];
export type ProtocolMessageType = SimulatorToRendererMessageType | RendererToSimulatorMessageType;

export interface ProtocolMessage<TType extends string = string, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  timestamp?: number;
}

export interface SimulatorToRendererMessage<TPayload = SimulatorToRendererPayload>
  extends ProtocolMessage<SimulatorToRendererMessageType, TPayload> {}
export interface RendererToSimulatorMessage<TPayload = RendererToSimulatorPayload>
  extends ProtocolMessage<RendererToSimulatorMessageType, TPayload> {}

export type ProtocolData = ProtocolValue;
export type SimulatorInfoPayload = z.infer<typeof SimulatorInfoPayloadSchema>;
export type MetadataUpdatePayload = z.infer<typeof MetadataUpdatePayloadSchema>;
export type StateSyncBeginPayload = z.infer<typeof StateSyncBeginPayloadSchema>;
export type StateSyncEndPayload = z.infer<typeof StateSyncEndPayloadSchema>;
export type TickTimingBreakdown = z.infer<typeof TickTimingBreakdownSchema>;
export type ActionTarget = z.infer<typeof ActionTargetSchema>;
export type ActionInvokePayload = z.infer<typeof ActionInvokePayloadSchema>;
export type ActionResultPayload = z.infer<typeof ActionResultPayloadSchema>;
export type ActionDeletePayload = z.infer<typeof ActionDeletePayloadSchema>;
export type EnvCreatePayload = z.infer<typeof EnvCreatePayloadSchema>;
export type EnvDeletePayload = z.infer<typeof EnvDeletePayloadSchema>;
export type EnvLayerCreatePayload = z.infer<typeof EnvLayerCreatePayloadSchema>;
export type EnvLayerUpdatePayload = z.infer<typeof EnvLayerUpdatePayloadSchema>;
export type EnvLayerDeletePayload = z.infer<typeof EnvLayerDeletePayloadSchema>;
export type ItemCreatePayload = z.infer<typeof ItemCreatePayloadSchema>;
export type ItemUpdatePayload = z.infer<typeof ItemUpdatePayloadSchema>;
export type ItemDeletePayload = z.infer<typeof ItemDeletePayloadSchema>;
export type ParameterDeletePayload = z.infer<typeof ParameterDeletePayloadSchema>;
export type ParameterSyncPayload = z.infer<typeof ParameterSyncPayloadSchema>;
export type ParameterChangePayload = z.infer<typeof ParameterChangePayloadSchema>;
export type ChartDeletePayload = z.infer<typeof ChartDeletePayloadSchema>;
export type ChartUpdatePayload = z.infer<typeof ChartUpdatePayloadSchema>;
export type MonitorMetadata = z.infer<typeof MonitorMetadataSchema>;
export type MonitorUpdatePayload = z.infer<typeof MonitorUpdatePayloadSchema>;
export type MonitorDeletePayload = z.infer<typeof MonitorDeletePayloadSchema>;
export type RestorableEnvironment = z.infer<typeof RestorableEnvironmentSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;
export type SceneRestorePayload = z.infer<typeof SceneRestorePayloadSchema>;
export type SceneRestoreBeginPayload = z.infer<typeof SceneRestoreBeginPayloadSchema>;
export type SceneRestoreEndPayload = z.infer<typeof SceneRestoreEndPayloadSchema>;
export type SceneCapturePayload = z.infer<typeof SceneCapturePayloadSchema>;
export type SceneCaptureResultPayload = z.infer<typeof SceneCaptureResultPayloadSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogPayload = z.infer<typeof LogPayloadSchema>;
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type AssetMetadataPayload = z.infer<typeof AssetMetadataPayloadSchema>;
export type AssetDataPayload = z.infer<typeof AssetDataPayloadSchema>;
export type AssetDeletePayload = z.infer<typeof AssetDeletePayloadSchema>;
export type AssetSyncPayload = z.infer<typeof AssetSyncPayloadSchema>;
export type ScreenshotRequestPayload = z.infer<typeof ScreenshotRequestPayloadSchema>;
export type ScreenshotResponsePayload = z.infer<typeof ScreenshotResponsePayloadSchema>;
export type StateSyncRequest = z.infer<typeof StateSyncRequestSchema>;

export type NormalizedLogPayload = Required<Pick<LogPayload, 'message'>> & LogPayload & {
  level: LogLevel;
  timestamp: number;
};

export type SimulatorToRendererPayload =
  | SimulatorInfoPayload
  | MetadataUpdatePayload
  | StateSyncBeginPayload
  | StateSyncEndPayload
  | ActionResultPayload
  | Action
  | ActionDeletePayload
  | EnvCreatePayload
  | EnvDeletePayload
  | EnvLayerCreatePayload
  | EnvLayerUpdatePayload
  | EnvLayerDeletePayload
  | ItemCreatePayload
  | ItemUpdatePayload
  | ItemDeletePayload
  | Parameter
  | ParameterDeletePayload
  | ParameterSyncPayload
  | ChartUpdatePayload
  | ChartDeletePayload
  | MonitorMetadata
  | MonitorUpdatePayload
  | MonitorDeletePayload
  | AssetMetadataPayload
  | AssetDataPayload
  | AssetDeletePayload
  | ScreenshotRequestPayload
  | SceneRestoreBeginPayload
  | SceneRestoreEndPayload
  | SceneCaptureResultPayload
  | LogPayload
  | ErrorPayload;

export type RendererToSimulatorPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ActionInvokePayload
  | AssetSyncPayload
  | ScreenshotResponsePayload
  | SceneRestorePayload
  | SceneCapturePayload
  | ErrorPayload;

export type SimulatorToRendererWSMessage = SimulatorToRendererMessage<SimulatorToRendererPayload>;
export type RendererToSimulatorWSMessage = RendererToSimulatorMessage<RendererToSimulatorPayload>;
export type AnyProtocolMessage = z.infer<typeof AnyProtocolMessageSchema>;
