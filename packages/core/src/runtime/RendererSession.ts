import type {
  ActionResultPayload,
  AnyProtocolMessage,
  ErrorPayload,
  ProtocolData,
  RendererToSimulatorMessage,
  SceneRestoreEndPayload,
  SceneRestorePayload,
  ScreenshotResponsePayload,
  SimulatorInfoPayload,
  SimulatorToRendererMessage,
  StateSyncBeginPayload,
  StateSyncEndPayload,
  StateSyncRequest,
} from '@tensnap/protocol';
import { Scenario } from '../scenario';
import type { ISimulatorTransport, TransportEventMap } from '../transport';
import { LazyEventTarget } from '../utils/LazyEventTarget';
import { RunController, type RunControllerOptions } from './RunController';
import { SnapshotRecorder } from '../snapshot';
import type { RecordingOptions, Snapshot } from '../snapshot';
import type { ChartGroup } from '../chart';

export type RendererMessageOrigin = 'live' | 'state-sync' | 'scene-restore' | 'replay' | 'optimistic-control';
export type RendererIdentityStatus = 'awaiting-info' | 'matching' | 'instance-changed' | 'model-mismatch';

export interface RendererSessionMessageDetail {
  message: SimulatorToRendererMessage;
  origin: RendererMessageOrigin;
}

export interface RendererSessionCommitDetail {
  origin: RendererMessageOrigin;
  messages: readonly SimulatorToRendererMessage[];
}

export interface RendererSessionOutboundDetail {
  message: RendererToSimulatorMessage;
  origin: 'optimistic-control';
}

export interface RendererSessionRecordingDetail {
  snapshot: Snapshot;
  reason: 'manual' | 'run';
}

export interface RendererIdentityDetail {
  status: RendererIdentityStatus;
  simulator_info: SimulatorInfoPayload;
  previous?: SimulatorInfoPayload;
}

export interface RendererSessionOptions {
  scenario?: Scenario;
  run?: Omit<RunControllerOptions, 'scenario' | 'send'>;
}

interface IncomingTransaction {
  kind: 'state-sync' | 'scene-restore';
  requestId: string;
  scenario: Scenario;
  messages: SimulatorToRendererMessage[];
  chartPolicy?: RestoreChartPolicy;
  replacementCharts?: ChartGroup[];
  truncateTime?: number;
}

export type RestoreChartPolicy = 'preserve' | 'replace' | 'truncate';

export interface SceneRestoreOptions {
  /** Renderer-local chart handling; charts are never sent to the simulator. */
  chartPolicy?: RestoreChartPolicy;
  /** Required only when replacing live charts with a local snapshot's charts. */
  replacementCharts?: ChartGroup[];
}

const createRequestId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

const rendererToSimulatorMessageTypes = new Set<string>([
  'state_sync',
  'param_change',
  'action_invoke',
  'asset_sync',
  'screenshot_response',
  'scene_restore',
  'scene_capture',
]);

/**
 * Host-neutral renderer protocol session. It accepts no simulator mutation
 * before `simulator_info`, and applies sync/restore traffic to an isolated
 * Scenario until a successful transaction end atomically replaces live state.
 */
export class RendererSession extends LazyEventTarget {
  readonly scenario: Scenario;
  readonly run: RunController;
  readonly recorder: SnapshotRecorder;

  private transport: ISimulatorTransport | null = null;
  private syncRequestId: string | null = null;
  private restoreRequestId: string | null = null;
  private transaction: IncomingTransaction | null = null;
  private pendingRestoreOptions: Pick<IncomingTransaction, 'requestId' | 'chartPolicy' | 'replacementCharts' | 'truncateTime'> | null = null;
  private announcedInfo: SimulatorInfoPayload | null = null;
  private committedInfo: SimulatorInfoPayload | null = null;
  private identityStatusState: RendererIdentityStatus = 'awaiting-info';

  private readonly transportMessageHandler = (message: TransportEventMap['message']) => {
    if (!this.isSimulatorMessage(message)) return;
    this.handleIncoming(message as SimulatorToRendererMessage);
  };
  private readonly transportOpenHandler = () => this.dispatch('transport:open', undefined);
  private readonly transportCloseHandler = () => this.dispatch('transport:close', undefined);
  private readonly transportErrorHandler = (error: unknown) => this.dispatch('transport:error', error);

  constructor(options: RendererSessionOptions = {}) {
    super();
    this.scenario = options.scenario ?? new Scenario();
    this.recorder = new SnapshotRecorder(this.scenario);
    const onRunStateChange = options.run?.onStateChange;
    const onRunStart = options.run?.onRunStart;
    const onRunStop = options.run?.onRunStop;
    this.run = new RunController({
      ...options.run,
      scenario: this.scenario,
      send: (message) => this.send(message),
      onStateChange: (status) => {
        onRunStateChange?.(status);
        this.dispatch('run:status', status);
      },
      onRunStart: (status) => {
        onRunStart?.(status);
        if (status.spec.record) {
          this.beginRecording({
            maxSteps: status.spec.record.maxSteps ?? 10_000,
            maxBytes: status.spec.record.maxBytes ?? 64 * 1024 * 1024,
            ringBuffer: status.spec.record.ringBuffer ?? true,
            ...status.spec.record,
          }, 'run');
        }
      },
      onRunStop: (status) => {
        onRunStop?.(status);
        if (!status.spec.record) return;
        const snapshot = this.recorder.stop();
        if (snapshot) this.dispatch('recording:complete', { snapshot, reason: 'run' } satisfies RendererSessionRecordingDetail);
      },
    });
  }

  get attachedTransport(): ISimulatorTransport | null {
    return this.transport;
  }

  get isConnected(): boolean {
    return this.transport?.isConnected ?? false;
  }

  get simulatorInfo(): SimulatorInfoPayload | null {
    return this.announcedInfo === null ? null : structuredClone(this.announcedInfo);
  }

  get identityStatus(): RendererIdentityStatus {
    return this.identityStatusState;
  }

  attachTransport(transport: ISimulatorTransport): void {
    if (this.transport === transport) return;
    this.detachTransport();
    this.transport = transport;
    transport.on('message', this.transportMessageHandler);
    transport.on('open', this.transportOpenHandler);
    transport.on('close', this.transportCloseHandler);
    transport.on('error', this.transportErrorHandler);
  }

  detachTransport(): void {
    const transport = this.transport;
    if (!transport) return;
    transport.off('message', this.transportMessageHandler);
    transport.off('open', this.transportOpenHandler);
    transport.off('close', this.transportCloseHandler);
    transport.off('error', this.transportErrorHandler);
    this.transport = null;
    this.discardTransaction();
    this.syncRequestId = null;
    this.restoreRequestId = null;
    this.pendingRestoreOptions = null;
    this.run.reset('disconnected');
  }

  destroy(): void {
    this.detachTransport();
  }

  requestStateSync(requestId = createRequestId('sync'), request?: StateSyncRequest): string {
    const info = this.requireCompatibleSimulator();
    if (this.transaction || this.syncRequestId || this.restoreRequestId) {
      throw new Error('Cannot request state sync during another protocol transaction.');
    }
    const payload = request ?? this.scenario.createStateSyncMessage(
      info.model.id,
      requestId,
      this.committedInfo?.instance_id,
    ).payload;
    if (payload.request_id !== requestId || payload.model_id !== info.model.id) {
      throw new Error('state_sync identity must match the active simulator session.');
    }
    if (!this.run.requestStateSync(requestId)) {
      throw new Error('Cannot request state sync while another state sync is active.');
    }
    this.syncRequestId = requestId;
    this.send({ type: 'state_sync', payload });
    return requestId;
  }

  requestSceneRestore(
    payload: Omit<SceneRestorePayload, 'request_id' | 'model_id'> & { request_id?: string },
    options: SceneRestoreOptions = {},
  ): string {
    const info = this.requireCompatibleSimulator();
    if (this.transaction || this.syncRequestId || this.restoreRequestId) {
      throw new Error('A protocol transaction is already active.');
    }
    const status = this.run.status;
    if (status?.inFlight) throw new Error('Wait for the in-flight action before scene restore.');
    this.assertRestoreCapability(info, payload);
    const chartPolicy = options.chartPolicy ?? 'preserve';
    if (chartPolicy === 'replace' && !options.replacementCharts) {
      throw new Error('Replacing charts during scene restore requires a local snapshot chart state.');
    }
    if (chartPolicy === 'truncate' && payload.time === undefined) {
      throw new Error('Truncating charts during scene restore requires an explicit restore time.');
    }
    this.run.stop('stopped');
    const requestId = payload.request_id ?? createRequestId('restore');
    this.restoreRequestId = requestId;
    this.pendingRestoreOptions = {
      requestId,
      chartPolicy,
      replacementCharts: options.replacementCharts === undefined ? undefined : structuredClone(options.replacementCharts),
      truncateTime: payload.time,
    };
    this.send({
      type: 'scene_restore',
      payload: { ...payload, request_id: requestId, model_id: info.model.id },
    });
    return requestId;
  }

  setParameter(id: string, value: ProtocolData): void {
    this.send(this.scenario.createParamChangeMessage(id, value));
  }

  sendScreenshotResponse(payload: ScreenshotResponsePayload): void {
    this.send(this.scenario.createScreenshotResponseMessage(payload));
  }

  startRecording(options: RecordingOptions = {}): Snapshot {
    return this.beginRecording(options, 'manual');
  }

  private beginRecording(options: RecordingOptions, reason: RendererSessionRecordingDetail['reason']): Snapshot {
    const snapshot = this.recorder.start(options);
    this.dispatch('recording:start', { snapshot, reason } satisfies RendererSessionRecordingDetail);
    return snapshot;
  }

  stopRecording(): Snapshot | null {
    const snapshot = this.recorder.stop();
    if (snapshot) this.dispatch('recording:complete', { snapshot, reason: 'manual' } satisfies RendererSessionRecordingDetail);
    return snapshot;
  }

  /** Snapshot playback uses the normal renderer replay path, not invented messages. */
  applyReplay(message: SimulatorToRendererMessage): void {
    this.applyCommittedMessage(message, 'replay');
  }

  handleIncoming(message: SimulatorToRendererMessage): void {
    if (message.type === 'simulator_info') {
      this.acceptSimulatorInfo(message.payload as SimulatorInfoPayload);
      return;
    }
    if (!this.announcedInfo) {
      this.reportSessionError('handshake_required', 'simulator_info must be the first simulator message.');
      return;
    }
    if (message.type === 'state_sync_begin') {
      this.beginStateSync(message.payload as StateSyncBeginPayload, message);
      return;
    }
    if (message.type === 'state_sync_end') {
      this.endStateSync(message.payload as StateSyncEndPayload, message);
      return;
    }
    if (message.type === 'scene_restore_begin') {
      this.beginSceneRestore(message);
      return;
    }
    if (message.type === 'scene_restore_end') {
      this.endSceneRestore(message.payload as SceneRestoreEndPayload, message);
      return;
    }
    if (this.transaction) {
      this.applyTransactionMessage(message);
      return;
    }
    this.applyCommittedMessage(message, 'live');
    if (message.type === 'action_result') this.run.observeActionResult(message.payload as ActionResultPayload);
    if (message.type === 'asset_metadata') this.send(this.scenario.createAssetSyncMessage());
  }

  private acceptSimulatorInfo(info: SimulatorInfoPayload): void {
    const previous = this.announcedInfo;
    this.announcedInfo = structuredClone(info);
    if (this.committedInfo && this.committedInfo.model.id !== info.model.id) {
      this.identityStatusState = 'model-mismatch';
    } else if (this.committedInfo && this.committedInfo.instance_id !== info.instance_id) {
      this.identityStatusState = 'instance-changed';
    } else {
      this.identityStatusState = 'matching';
    }
    this.dispatch('simulator:info', {
      status: this.identityStatusState,
      simulator_info: this.simulatorInfo!,
      previous: previous === null ? undefined : structuredClone(previous),
    } satisfies RendererIdentityDetail);
  }

  private beginStateSync(payload: StateSyncBeginPayload, message: SimulatorToRendererMessage): void {
    const info = this.announcedInfo!;
    if (this.transaction || !this.syncRequestId || payload.request_id !== this.syncRequestId || payload.model_id !== info.model.id || payload.instance_id !== info.instance_id || (payload.mode === 'reconcile' && this.committedInfo?.instance_id !== payload.instance_id)) {
      this.reportSessionError('invalid_state_sync', 'Rejected unmatched state_sync_begin.');
      return;
    }
    const staging = new Scenario({ layerRegistry: this.scenario.layerRegistry });
    if (payload.mode === 'reconcile') staging.load(this.scenario.dump());
    this.transaction = { kind: 'state-sync', requestId: payload.request_id, scenario: staging, messages: [message] };
    staging.apply(message);
    this.run.recordStateSyncBoundary('begin', payload);
    this.dispatch('message', { message, origin: 'state-sync' } satisfies RendererSessionMessageDetail);
  }

  private endStateSync(payload: StateSyncEndPayload, message: SimulatorToRendererMessage): void {
    const transaction = this.transaction;
    if (!transaction || transaction.kind !== 'state-sync' || payload.request_id !== transaction.requestId) {
      this.reportSessionError('invalid_state_sync', 'Rejected unmatched state_sync_end.');
      return;
    }
    transaction.scenario.apply(message);
    transaction.messages.push(message);
    this.scenario.load(transaction.scenario.dump());
    this.recorder.recordMessages(transaction.messages);
    this.dispatch('commit', { origin: 'state-sync', messages: transaction.messages } satisfies RendererSessionCommitDetail);
    this.dispatch('message', { message, origin: 'state-sync' } satisfies RendererSessionMessageDetail);
    this.committedInfo = structuredClone(this.announcedInfo!);
    this.identityStatusState = 'matching';
    this.transaction = null;
    this.syncRequestId = null;
    this.run.recordStateSyncBoundary('end', payload);
    if (transaction.messages.some((entry) => entry.type === 'asset_metadata')) this.send(this.scenario.createAssetSyncMessage());
  }

  private beginSceneRestore(message: SimulatorToRendererMessage): void {
    const payload = message.payload as { request_id: string };
    if (this.transaction || !this.restoreRequestId || payload.request_id !== this.restoreRequestId) {
      this.reportSessionError('invalid_scene_restore', 'Rejected unmatched scene_restore_begin.');
      return;
    }
    const staging = new Scenario({ layerRegistry: this.scenario.layerRegistry });
    staging.load(this.scenario.dump());
    const options = this.pendingRestoreOptions;
    this.pendingRestoreOptions = null;
    this.transaction = {
      kind: 'scene-restore',
      requestId: payload.request_id,
      scenario: staging,
      messages: [message],
      chartPolicy: options?.chartPolicy,
      replacementCharts: options?.replacementCharts,
      truncateTime: options?.truncateTime,
    };
    this.dispatch('message', { message, origin: 'scene-restore' } satisfies RendererSessionMessageDetail);
  }

  private endSceneRestore(payload: SceneRestoreEndPayload, message: SimulatorToRendererMessage): void {
    const transaction = this.transaction;
    if (!transaction || transaction.kind !== 'scene-restore' || payload.request_id !== transaction.requestId) {
      this.reportSessionError('invalid_scene_restore', 'Rejected unmatched scene_restore_end.');
      return;
    }
    transaction.messages.push(message);
    if (payload.status === 'ok') {
      if (transaction.chartPolicy === 'replace') {
        const snapshot = transaction.scenario.dump();
        snapshot.charts = structuredClone(transaction.replacementCharts ?? []);
        transaction.scenario.load(snapshot);
      }
      if (transaction.chartPolicy === 'truncate' && transaction.truncateTime !== undefined) {
        transaction.scenario.charts.truncateAll(transaction.truncateTime, false);
      }
      this.scenario.load(transaction.scenario.dump());
      this.recorder.recordMessages(transaction.messages);
      this.dispatch('commit', { origin: 'scene-restore', messages: transaction.messages } satisfies RendererSessionCommitDetail);
    }
    this.dispatch('message', { message, origin: 'scene-restore' } satisfies RendererSessionMessageDetail);
    this.transaction = null;
    this.restoreRequestId = null;
  }

  private applyTransactionMessage(message: SimulatorToRendererMessage): void {
    const transaction = this.transaction!;
    if (transaction.kind === 'scene-restore' && message.type.startsWith('chart_')) {
      this.reportSessionError('invalid_scene_restore', 'Chart messages are forbidden during scene restore.');
      this.transaction = null;
      this.restoreRequestId = null;
      return;
    }
    transaction.scenario.apply(message);
    transaction.messages.push(message);
    this.dispatch('message', {
      message,
      origin: transaction.kind === 'state-sync' ? 'state-sync' : 'scene-restore',
    } satisfies RendererSessionMessageDetail);
  }

  private applyCommittedMessage(message: SimulatorToRendererMessage, origin: RendererMessageOrigin): void {
    this.scenario.apply(message);
    this.recorder.recordMessage(message);
    this.dispatch('message', { message, origin } satisfies RendererSessionMessageDetail);
    this.dispatch('commit', { origin, messages: [message] } satisfies RendererSessionCommitDetail);
  }

  private discardTransaction(): void {
    this.transaction = null;
    this.pendingRestoreOptions = null;
  }

  private assertRestoreCapability(
    info: SimulatorInfoPayload,
    payload: Omit<SceneRestorePayload, 'request_id' | 'model_id'> & { request_id?: string },
  ): void {
    const capabilities = new Set(info.capabilities);
    if (payload.expected_instance_id !== undefined && payload.expected_instance_id !== info.instance_id) {
      throw new Error('scene_restore expected_instance_id does not match the active simulator instance.');
    }
    if (payload.state_schema_version !== undefined && info.model.state_schema_version !== undefined && payload.state_schema_version !== info.model.state_schema_version) {
      throw new Error('scene_restore state_schema_version does not match the active simulator model.');
    }
    if (payload.checkpoint !== undefined && !capabilities.has('scene.restore.checkpoint')) {
      throw new Error('The connected simulator does not support checkpoint scene restore.');
    }
    if ((payload.time !== undefined || payload.parameters !== undefined || payload.envs !== undefined) && !capabilities.has('scene.restore.projected')) {
      throw new Error('The connected simulator does not support projected scene restore.');
    }
    if (payload.envs !== undefined && !capabilities.has('scene.restore.topology')) {
      for (const environment of payload.envs) {
        const existing = this.scenario.getEnvironment(environment.id);
        if (!existing || existing.type !== environment.type) {
          throw new Error('Changing scene topology requires scene.restore.topology capability.');
        }
        if (existing.layers.size !== environment.layers.length) {
          throw new Error('Changing scene topology requires scene.restore.topology capability.');
        }
        for (const layer of environment.layers) {
          const current = existing.layers.get(layer.layer_id);
          if (!current || current.layerType !== layer.layer_type) {
            throw new Error('Changing scene topology requires scene.restore.topology capability.');
          }
        }
      }
    }
  }

  private requireCompatibleSimulator(): SimulatorInfoPayload {
    if (!this.announcedInfo) throw new Error('Wait for simulator_info before sending renderer messages.');
    if (this.identityStatusState === 'model-mismatch') {
      throw new Error('The connected simulator model does not match this renderer project.');
    }
    return this.announcedInfo;
  }

  private reportSessionError(code: string, message: string): void {
    const payload: ErrorPayload = { code, message };
    this.dispatch('protocol:error', payload);
  }

  private send(message: RendererToSimulatorMessage): void {
    if (!this.transport) throw new Error('Renderer session is not attached to a transport.');
    if (message.type === 'state_sync'
      || message.type === 'param_change'
      || message.type === 'action_invoke'
      || message.type === 'scene_restore'
      || message.type === 'scene_capture') {
      this.requireCompatibleSimulator();
    }
    this.recorder.recordControl(message);
    this.dispatch('outbound', { message, origin: 'optimistic-control' } satisfies RendererSessionOutboundDetail);
    this.transport.send(message);
  }

  private isSimulatorMessage(message: AnyProtocolMessage): boolean {
    return !rendererToSimulatorMessageTypes.has(message.type);
  }

  private dispatch<T>(type: string, detail: T): void {
    this.dispatchLazyCustom(type, () => detail);
  }
}
