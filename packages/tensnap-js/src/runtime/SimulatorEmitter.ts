import type {
  Action,
  ActionDeletePayload,
  ActionResultPayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMetadataPayload,
  ChartDeletePayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  ErrorPayload,
  ItemCreatePayload,
  ItemDeletePayload,
  ItemUpdatePayload,
  LogPayload,
  MetadataUpdatePayload,
  MonitorDeletePayload,
  MonitorMetadata,
  MonitorUpdatePayload,
  Parameter,
  ParameterDeletePayload,
  ParameterSyncPayload,
  ScreenshotRequestPayload,
  SimulatorToRendererMessage,
  SimulatorInfoPayload,
  SceneCaptureResultPayload,
  SceneRestoreBeginPayload,
  SceneRestoreEndPayload,
  StateSyncBeginPayload,
  StateSyncEndPayload,
} from '@tensnap/protocol';

export type SimulatorMessageSender = (
  message: SimulatorToRendererMessage,
) => void | Promise<void>;

export class SimulatorEmitter {
  constructor(private readonly sendMessage: SimulatorMessageSender) {}

  async send(message: SimulatorToRendererMessage): Promise<void> {
    await this.sendMessage(message);
  }

  async metadataUpdate(payload: MetadataUpdatePayload): Promise<void> {
    await this.send({ type: 'metadata_update', payload });
  }

  async simulatorInfo(payload: SimulatorInfoPayload): Promise<void> {
    await this.send({ type: 'simulator_info', payload });
  }

  async stateSyncBegin(payload: StateSyncBeginPayload): Promise<void> {
    await this.send({ type: 'state_sync_begin', payload });
  }

  async stateSyncEnd(payload: StateSyncEndPayload): Promise<void> {
    await this.send({ type: 'state_sync_end', payload });
  }

  async actionResult(payload: ActionResultPayload): Promise<void> {
    await this.send({ type: 'action_result', payload });
  }

  async actionCreate(payload: Action): Promise<void> {
    await this.send({ type: 'action_create', payload });
  }

  async actionUpdate(payload: Action): Promise<void> {
    await this.send({ type: 'action_update', payload });
  }

  async actionDelete(payload: ActionDeletePayload): Promise<void> {
    await this.send({ type: 'action_delete', payload });
  }

  async paramCreate(payload: Parameter): Promise<void> {
    await this.send({ type: 'param_create', payload });
  }

  async paramUpdate(payload: Parameter): Promise<void> {
    await this.send({ type: 'param_update', payload });
  }

  async paramDelete(payload: ParameterDeletePayload): Promise<void> {
    await this.send({ type: 'param_delete', payload });
  }

  async paramSync(payload: ParameterSyncPayload): Promise<void> {
    await this.send({ type: 'param_sync', payload });
  }

  async envCreate(payload: EnvCreatePayload): Promise<void> {
    await this.send({ type: 'env_create', payload });
  }

  async envDelete(payload: EnvDeletePayload): Promise<void> {
    await this.send({ type: 'env_delete', payload });
  }

  async envLayerCreate(payload: EnvLayerCreatePayload): Promise<void> {
    await this.send({ type: 'env_layer_create', payload });
  }

  async envLayerUpdate(payload: EnvLayerUpdatePayload): Promise<void> {
    await this.send({ type: 'env_layer_update', payload });
  }

  async envLayerDelete(payload: EnvLayerDeletePayload): Promise<void> {
    await this.send({ type: 'env_layer_delete', payload });
  }

  async itemCreate(payload: ItemCreatePayload): Promise<void> {
    await this.send({ type: 'item_create', payload });
  }

  async itemUpdate(payload: ItemUpdatePayload): Promise<void> {
    await this.send({ type: 'item_update', payload });
  }

  async itemDelete(payload: ItemDeletePayload): Promise<void> {
    await this.send({ type: 'item_delete', payload });
  }

  async chartCreate(payload: ChartGroupMetadata): Promise<void> {
    await this.send({ type: 'chart_create', payload });
  }

  async chartUpdate(payload: ChartUpdatePayload): Promise<void> {
    await this.send({ type: 'chart_update', payload });
  }

  async chartDelete(payload: ChartDeletePayload): Promise<void> {
    await this.send({ type: 'chart_delete', payload });
  }

  async monitorCreate(payload: MonitorMetadata): Promise<void> {
    await this.send({ type: 'monitor_create', payload });
  }

  async monitorUpdate(payload: MonitorUpdatePayload): Promise<void> {
    await this.send({ type: 'monitor_update', payload });
  }

  async monitorDelete(payload: MonitorDeletePayload): Promise<void> {
    await this.send({ type: 'monitor_delete', payload });
  }

  async assetMetadata(payload: AssetMetadataPayload): Promise<void> {
    await this.send({ type: 'asset_metadata', payload });
  }

  async assetData(payload: AssetDataPayload): Promise<void> {
    await this.send({ type: 'asset_data', payload });
  }

  async assetDelete(payload: AssetDeletePayload): Promise<void> {
    await this.send({ type: 'asset_delete', payload });
  }

  async screenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    await this.send({ type: 'screenshot_request', payload });
  }

  async sceneRestoreBegin(payload: SceneRestoreBeginPayload): Promise<void> {
    await this.send({ type: 'scene_restore_begin', payload });
  }

  async sceneRestoreEnd(payload: SceneRestoreEndPayload): Promise<void> {
    await this.send({ type: 'scene_restore_end', payload });
  }

  async sceneCaptureResult(payload: SceneCaptureResultPayload): Promise<void> {
    await this.send({ type: 'scene_capture_result', payload });
  }

  async log(payload: LogPayload): Promise<void> {
    await this.send({ type: 'log', payload });
  }

  async error(payload: ErrorPayload): Promise<void> {
    await this.send({ type: 'error', payload });
  }
}

export function createSimulatorEmitter(sendMessage: SimulatorMessageSender): SimulatorEmitter {
  return new SimulatorEmitter(sendMessage);
}
