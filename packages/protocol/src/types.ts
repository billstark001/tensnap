import type { z } from 'zod';
import type {
  Action,
  Parameter,
} from './controls';
import type { ChartGroupMetadata } from './chart';
import type {
  ActionDeletePayloadSchema,
  ActionEndPayloadSchema,
  ActionStartPayloadSchema,
  AnyProtocolMessageSchema,
  AssetDataPayloadSchema,
  AssetDeletePayloadSchema,
  AssetMetaPayloadSchema,
  AssetSyncPayloadSchema,
  ChartDeletePayloadSchema,
  ChartUpdatePayloadSchema,
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
  ParameterChangePayloadSchema,
  ParameterDeletePayloadSchema,
  ParameterSyncPayloadSchema,
  PrimitiveItemKeySchema,
  RendererToSimulatorMessageSchema,
  ScreenshotRequestPayloadSchema,
  ScreenshotResponsePayloadSchema,
  SimulatorToRendererMessageSchema,
  StateSyncBoundaryPayloadSchema,
  StateSyncRequestSchema,
  TickTimingBreakdownSchema,
} from './schemas';

/**
 * Protocol v0.2 uses renderer/simulator terms instead of client/server terms.
 * The renderer owns synchronized session state; the simulator emits updates and
 * responds to renderer-owned action, parameter, sync, asset, and screenshot
 * events.
 */
export type EnvironmentId = string;
export type ScenarioEnvironmentType = z.infer<typeof EnvCreatePayloadSchema>['type'];
export type ItemRecord = z.infer<typeof ItemSchema>;
export type ItemDiff = z.infer<typeof ItemDiffSchema>;
export type ItemKey = z.infer<typeof ItemKeySchema>;
export type PrimitiveItemKey = z.infer<typeof PrimitiveItemKeySchema>;
export type ItemDeleteItems = ItemDeletePayload['items'];

export type SimulatorToRendererMessageType = z.infer<typeof SimulatorToRendererMessageSchema>['type'];
export type RendererToSimulatorMessageType = z.infer<typeof RendererToSimulatorMessageSchema>['type'];
export type ProtocolMessageType = SimulatorToRendererMessageType | RendererToSimulatorMessageType;

/** Transport-neutral envelope shared by every protocol message. */
export interface ProtocolMessage<TType extends ProtocolMessageType = ProtocolMessageType, TPayload = unknown> {
  type: TType;
  payload: TPayload;
  timestamp?: number;
}

export interface SimulatorToRendererMessage<TPayload = SimulatorToRendererPayload>
  extends ProtocolMessage<SimulatorToRendererMessageType, TPayload> {}

export interface RendererToSimulatorMessage<TPayload = RendererToSimulatorPayload>
  extends ProtocolMessage<RendererToSimulatorMessageType, TPayload> {}

export type MetadataUpdatePayload = z.infer<typeof MetadataUpdatePayloadSchema>;
export type StateSyncBoundaryPayload = z.infer<typeof StateSyncBoundaryPayloadSchema>;
export type TickTimingBreakdown = z.infer<typeof TickTimingBreakdownSchema>;
export type ActionEndPayload = z.infer<typeof ActionEndPayloadSchema>;
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
export type ChartDeletePayload = z.infer<typeof ChartDeletePayloadSchema>;
export type ChartUpdatePayload = z.infer<typeof ChartUpdatePayloadSchema>;
export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogPayload = z.infer<typeof LogPayloadSchema>;

export interface NormalizedLogPayload extends LogPayload {
  level: LogLevel;
  timestamp: number;
}

export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;
export type AssetMetaPayload = z.infer<typeof AssetMetaPayloadSchema>;
export type AssetDataPayload = z.infer<typeof AssetDataPayloadSchema>;
export type AssetDeletePayload = z.infer<typeof AssetDeletePayloadSchema>;
export type AssetSyncPayload = z.infer<typeof AssetSyncPayloadSchema>;
export type ScreenshotRequestPayload = z.infer<typeof ScreenshotRequestPayloadSchema>;
export type ScreenshotResponsePayload = z.infer<typeof ScreenshotResponsePayloadSchema>;
export type StateSyncRequest = z.infer<typeof StateSyncRequestSchema>;
export type ParameterChangePayload = z.infer<typeof ParameterChangePayloadSchema>;
export type ActionStartPayload = z.infer<typeof ActionStartPayloadSchema>;

export type SimulatorToRendererPayload =
  | MetadataUpdatePayload
  | StateSyncBoundaryPayload
  | ActionEndPayload
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
  | ChartGroupMetadata
  | ChartUpdatePayload
  | ChartDeletePayload
  | AssetMetaPayload
  | AssetDataPayload
  | AssetDeletePayload
  | ScreenshotRequestPayload
  | LogPayload
  | ErrorPayload;

export type RendererToSimulatorPayload =
  | StateSyncRequest
  | ParameterChangePayload
  | ActionStartPayload
  | AssetSyncPayload
  | ScreenshotResponsePayload
  | ErrorPayload;

export type SimulatorToRendererWSMessage = SimulatorToRendererMessage<SimulatorToRendererPayload>;
export type RendererToSimulatorWSMessage = RendererToSimulatorMessage<RendererToSimulatorPayload>;
export type AnyProtocolMessage = z.infer<typeof AnyProtocolMessageSchema>;
