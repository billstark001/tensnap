import type {
  ActionInvokePayload,
  ActionResultPayload,
  AnyProtocolMessage,
  ErrorPayload,
  ProtocolData,
  RendererToSimulatorMessage,
  SceneCaptureResultPayload,
  SceneRestoreEndPayload,
  SceneRestorePayload,
  ScreenshotResponsePayload,
  SimulatorInfoPayload,
  SimulatorToRendererMessage,
  StateSyncBeginPayload,
  StateSyncEndPayload,
  StateSyncRequest,
} from '@tensnap/protocol';
import { ProtocolValidationError } from '@tensnap/protocol';
import { Scenario } from '../scenario';
import type { ISimulatorTransport, TransportEventMap } from '../transport';
import type { DiagnosticEvent } from '../diagnostics';
import { LazyEventTarget } from '../utils/LazyEventTarget';
import { RunController, type RunControllerOptions } from './RunController';
import { applySnapshotFrame, projectedRestoreChangesTopology, SnapshotRecorder } from '../snapshot';
import type { RecordingOptions, Snapshot, SnapshotFrame, SnapshotModelIdentity } from '../snapshot';
import type { ChartGroup } from '../chart';
import { ActionRunMetrics, type ActionRunMetricSnapshot } from './ActionRunMetrics';

export type RendererMessageOrigin = 'live' | 'state-sync' | 'scene-restore' | 'replay' | 'optimistic-control';
export type RendererIdentityStatus = 'awaiting-info' | 'matching' | 'instance-changed' | 'sync-required' | 'model-mismatch';

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

export interface RendererSessionActionMetricsDetail {
  metrics: ActionRunMetricSnapshot | null;
}

export interface RendererSessionRecordingDetail {
  snapshot: Snapshot;
  reason: 'manual' | 'run';
}

export interface RendererSceneCaptureDetail {
  result: SceneCaptureResultPayload;
}

export interface RendererIdentityDetail {
  status: RendererIdentityStatus;
  simulator_info: SimulatorInfoPayload;
  previous?: SimulatorInfoPayload;
}

export interface RendererSessionOptions {
  scenario?: Scenario;
  run?: Omit<RunControllerOptions, 'scenario' | 'send'>;
  /** Upper bound for state sync, scene restore, and scene capture requests. */
  transactionTimeoutMs?: number;
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

export interface SceneOperationOptions {
  /** Overrides the session transaction timeout for this operation. */
  timeoutMs?: number;
  /** Cancels the operation locally; simulator state is then considered unknown. */
  signal?: AbortSignal;
}

export interface SceneRestoreOptions extends SceneOperationOptions {
  /** Renderer-local chart handling; charts are never sent to the simulator. */
  chartPolicy?: RestoreChartPolicy;
  /** Required only when replacing live charts with a local snapshot's charts. */
  replacementCharts?: ChartGroup[];
}

type ActiveProtocolRequestKind = 'state-sync' | 'scene-restore' | 'scene-capture';

interface ActiveProtocolRequest {
  kind: ActiveProtocolRequestKind;
  requestId: string;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  removeAbortListener?: () => void;
  resolve?: (payload: unknown) => void;
  reject?: (error: Error) => void;
  restoreOptions?: Pick<IncomingTransaction, 'chartPolicy' | 'replacementCharts' | 'truncateTime'>;
}

const DEFAULT_TRANSACTION_TIMEOUT_MS = 30_000;

function normalizeTransactionTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('transactionTimeoutMs must be a positive finite number.');
  }
  return Math.floor(value);
}

const createRequestId = (prefix: string): string => `${prefix}-${crypto.randomUUID()}`;

/**
 * A simulator_info frame is immutable for the lifetime of its connection, but
 * it is still transport input.  Keep the session usable when a permissive
 * codec (or an older binding) supplies a null/malformed capability list.
 */
function normalizeSimulatorInfo(info: SimulatorInfoPayload): SimulatorInfoPayload {
  const capabilities = Array.isArray(info.capabilities)
    ? info.capabilities.filter((capability): capability is string => typeof capability === 'string')
    : [];
  return { ...info, capabilities };
}

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
 * v0.2 had no `simulator_info`. This identity is never persisted; it only
 * lets the existing transactional session machinery run against a legacy
 * transport after that transport has selected legacy mode.
 */
const LEGACY_SIMULATOR_INFO: SimulatorInfoPayload = {
  protocol_version: '0.3',
  binding: { name: 'legacy', version: '0.2' },
  model: { id: 'legacy' },
  instance_id: 'legacy',
  capabilities: [],
};

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
  private activeRequest: ActiveProtocolRequest | null = null;
  private transaction: IncomingTransaction | null = null;
  private announcedInfo: SimulatorInfoPayload | null = null;
  private committedInfo: SimulatorInfoPayload | null = null;
  private legacySession = false;
  /** Identity loaded from project storage before the first simulator handshake. */
  private expectedIdentity: SnapshotModelIdentity | null = null;
  private identityStatusState: RendererIdentityStatus = 'awaiting-info';
  private actionMetrics: ActionRunMetrics | null = null;
  private readonly transactionTimeoutMs: number;

  private readonly transportMessageHandler = (message: TransportEventMap['message']) => {
    if (!this.isSimulatorMessage(message)) return;
    this.handleIncoming(message as SimulatorToRendererMessage);
  };
  private readonly transportOpenHandler = () => this.dispatch('transport:open', undefined);
  private readonly transportCloseHandler = () => {
    this.failActiveRequest(
      'transaction_disconnected',
      'The simulator connection closed before the protocol transaction completed.',
    );
    this.clearActionMetrics();
    this.dispatch('transport:close', undefined);
  };
  private readonly transportErrorHandler = (error: unknown) => {
    if (error instanceof ProtocolValidationError) {
      this.run.reset('validation-error');
    }
    this.failActiveRequest(
      'transaction_transport_error',
      error instanceof Error ? error.message : String(error),
      true,
      true,
    );
    this.clearActionMetrics();
    this.reportDiagnostic({
      severity: 'error',
      domain: 'transport',
      source: 'renderer-session',
      code: error instanceof ProtocolValidationError ? 'validation_error' : 'transport_error',
      message: error instanceof Error ? error.message : String(error),
      details: error,
    });
    this.dispatch('transport:error', error);
  };
  private readonly transportValidationWarningHandler = (warning: TransportEventMap['validation-warning']) => {
    this.reportDiagnostic({
      severity: 'warning',
      domain: 'protocol',
      source: 'renderer-session',
      code: 'validation_warning',
      message: warning.message,
      details: warning.issues,
      dedupeKey: `validation:${warning.direction}:${warning.message}`,
    });
    this.dispatch('transport:validation-warning', warning);
  };
  private readonly transportCodecWarningHandler = (warning: TransportEventMap['codec-warning']) => {
    this.reportDiagnostic({
      severity: 'warning',
      domain: 'protocol',
      source: 'renderer-session',
      code: warning.code,
      message: warning.message,
      target: warning.path,
      dedupeKey: `codec:${warning.code}:${warning.path}`,
    });
    this.dispatch('transport:codec-warning', warning);
  };
  private readonly transportDiagnosticHandler = (diagnostic: TransportEventMap['diagnostic']) => {
    this.reportDiagnostic(diagnostic);
    this.dispatch('transport:diagnostic', diagnostic);
  };
  private readonly scenarioDiagnosticHandler = (event: Event) => {
    this.reportDiagnostic((event as CustomEvent<DiagnosticEvent>).detail);
  };

  constructor(options: RendererSessionOptions = {}) {
    super();
    this.transactionTimeoutMs = normalizeTransactionTimeout(
      options.transactionTimeoutMs ?? DEFAULT_TRANSACTION_TIMEOUT_MS,
    );
    this.scenario = options.scenario ?? new Scenario();
    this.scenario.addEventListener('diagnostic', this.scenarioDiagnosticHandler);
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

  /** True only after the attached transport selected the v0.2 compatibility codec. */
  get isLegacyProtocol(): boolean {
    return this.legacySession;
  }

  get identityStatus(): RendererIdentityStatus {
    return this.identityStatusState;
  }

  /** The latest durable identity, suitable for project and snapshot persistence. */
  get modelIdentity(): SnapshotModelIdentity | null {
    if (this.legacySession) {
      return this.expectedIdentity === null ? null : structuredClone(this.expectedIdentity);
    }
    const info = this.committedInfo
      ?? (this.expectedIdentity !== null && this.identityStatusState !== 'matching' ? null : this.announcedInfo);
    if (info) {
      return {
        model_id: info.model.id,
        ...(info.model.state_schema_version === undefined ? {} : { state_schema_version: info.model.state_schema_version }),
        ...(info.instance_id === undefined ? {} : { instance_id: info.instance_id }),
      };
    }
    return this.expectedIdentity === null ? null : structuredClone(this.expectedIdentity);
  }

  /** Identity to include in a state-sync request before the next sync commits. */
  get stateSyncIdentity(): SnapshotModelIdentity | null {
    if (this.legacySession) return null;
    if (this.committedInfo) {
      return {
        model_id: this.committedInfo.model.id,
        ...(this.committedInfo.model.state_schema_version === undefined ? {} : { state_schema_version: this.committedInfo.model.state_schema_version }),
        instance_id: this.committedInfo.instance_id,
      };
    }
    return this.expectedIdentity === null ? null : structuredClone(this.expectedIdentity);
  }

  /**
   * Installs the identity persisted with a project before a transport opens.
   * A later incompatible handshake remains disconnected from the project state.
   */
  setExpectedSimulatorIdentity(identity: SnapshotModelIdentity | null | undefined): void {
    this.expectedIdentity = identity === null || identity === undefined ? null : structuredClone(identity);
    if (this.legacySession) {
      this.identityStatusState = this.expectedIdentity === null ? 'matching' : 'model-mismatch';
      return;
    }
    if (!this.announcedInfo) {
      this.identityStatusState = 'awaiting-info';
      return;
    }
    this.updateIdentityStatus(this.announcedInfo);
  }

  attachTransport(transport: ISimulatorTransport): void {
    if (this.transport === transport) return;
    this.detachTransport();
    this.transport = transport;
    transport.on('message', this.transportMessageHandler);
    transport.on('open', this.transportOpenHandler);
    transport.on('close', this.transportCloseHandler);
    transport.on('error', this.transportErrorHandler);
    transport.on('diagnostic', this.transportDiagnosticHandler);
    transport.on('validation-warning', this.transportValidationWarningHandler);
    transport.on('codec-warning', this.transportCodecWarningHandler);
  }

  detachTransport(): void {
    const transport = this.transport;
    if (transport) {
      transport.off('message', this.transportMessageHandler);
      transport.off('open', this.transportOpenHandler);
      transport.off('close', this.transportCloseHandler);
      transport.off('error', this.transportErrorHandler);
      transport.off('diagnostic', this.transportDiagnosticHandler);
      transport.off('validation-warning', this.transportValidationWarningHandler);
      transport.off('codec-warning', this.transportCodecWarningHandler);
      this.transport = null;
      this.cancelActiveRequest('The renderer session detached from its transport.');
      this.run.reset('disconnected');
    }
    this.clearActionMetrics();
  }

  destroy(): void {
    this.detachTransport();
    this.scenario.removeEventListener('diagnostic', this.scenarioDiagnosticHandler);
  }

  /**
   * Forget the identity associated with a deliberately replaced project
   * source. Reconnects keep identity so they can reconcile; source changes
   * must start a replace sync and never send the former model's inventory.
   */
  resetSimulatorIdentity(): void {
    this.cancelActiveRequest('The simulator source was replaced.');
    this.announcedInfo = null;
    this.committedInfo = null;
    this.expectedIdentity = null;
    this.legacySession = false;
    this.identityStatusState = 'awaiting-info';
    this.clearActionMetrics();
  }

  /** Starts the one metrics window owned by this session's next action run. */
  beginActionMetrics(actionId: string): void {
    this.actionMetrics = new ActionRunMetrics(actionId);
    this.dispatch('action:metrics', { metrics: null } satisfies RendererSessionActionMetricsDetail);
  }

  requestStateSync(requestId = createRequestId('sync'), request?: StateSyncRequest): string {
    const info = this.requireCompatibleSimulator(true);
    this.assertNoActiveRequest();
    const payload = request ?? this.scenario.createStateSyncMessage(
      info.model.id,
      requestId,
      this.stateSyncIdentity?.instance_id,
    ).payload;
    if (payload.request_id !== requestId || (!this.legacySession && payload.model_id !== info.model.id)) {
      throw new Error('state_sync identity must match the active simulator session.');
    }
    if (!this.run.requestStateSync(requestId)) {
      throw new Error('Cannot request state sync while another state sync is active.');
    }
    this.activateRequest('state-sync', requestId);
    try {
      this.send({ type: 'state_sync', payload });
    } catch (error) {
      this.failActiveRequest('transaction_send_failed', error instanceof Error ? error.message : String(error), false);
      throw error;
    }
    return requestId;
  }

  requestSceneRestore(
    payload: Omit<SceneRestorePayload, 'request_id' | 'model_id'> & { request_id?: string },
    options: SceneRestoreOptions = {},
  ): string {
    return this.issueSceneRestore(payload, options);
  }

  restoreScene(
    payload: Omit<SceneRestorePayload, 'request_id' | 'model_id'> & { request_id?: string },
    options: SceneRestoreOptions = {},
  ): Promise<SceneRestoreEndPayload> {
    return new Promise((resolve, reject) => {
      try {
        this.issueSceneRestore(payload, options, {
          resolve: (result) => resolve(result as SceneRestoreEndPayload),
          reject,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private issueSceneRestore(
    payload: Omit<SceneRestorePayload, 'request_id' | 'model_id'> & { request_id?: string },
    options: SceneRestoreOptions,
    completion?: Pick<ActiveProtocolRequest, 'resolve' | 'reject'>,
  ): string {
    const info = this.requireCompatibleSimulator();
    this.assertNoActiveRequest();
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
    if (this.run.hasInFlightAction) throw new Error('Wait for the in-flight action before scene restore.');
    const requestId = payload.request_id ?? createRequestId('restore');
    this.activateRequest('scene-restore', requestId, options, completion, {
      chartPolicy,
      replacementCharts: options.replacementCharts === undefined ? undefined : structuredClone(options.replacementCharts),
      truncateTime: payload.time,
    });
    try {
      this.send({
        type: 'scene_restore',
        payload: { ...payload, request_id: requestId, model_id: info.model.id },
      });
    } catch (error) {
      this.failActiveRequest('transaction_send_failed', error instanceof Error ? error.message : String(error), false);
      throw error;
    }
    return requestId;
  }

  /** Request an exact scene checkpoint at an action boundary. */
  requestSceneCapture(requestId = createRequestId('capture'), options: SceneOperationOptions = {}): string {
    return this.issueSceneCapture(requestId, options);
  }

  captureScene(options: SceneOperationOptions = {}): Promise<SceneCaptureResultPayload> {
    return new Promise((resolve, reject) => {
      try {
        this.issueSceneCapture(createRequestId('capture'), options, {
          resolve: (result) => resolve(result as SceneCaptureResultPayload),
          reject,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private issueSceneCapture(
    requestId: string,
    options: SceneOperationOptions,
    completion?: Pick<ActiveProtocolRequest, 'resolve' | 'reject'>,
  ): string {
    const info = this.requireCompatibleSimulator();
    this.assertNoActiveRequest();
    if (this.run.status?.inFlight) {
      throw new Error('Wait for the in-flight action before scene capture.');
    }
    if (!info.capabilities.includes('scene.restore.checkpoint')) {
      throw new Error('The connected simulator does not support checkpoint scene capture.');
    }
    this.run.stop('stopped');
    if (this.run.hasInFlightAction) {
      throw new Error('Wait for the in-flight action before scene capture.');
    }
    this.activateRequest('scene-capture', requestId, options, completion);
    try {
      this.send({ type: 'scene_capture', payload: { request_id: requestId } });
    } catch (error) {
      this.failActiveRequest('transaction_send_failed', error instanceof Error ? error.message : String(error), false);
      throw error;
    }
    return requestId;
  }

  setParameter(id: string, value: ProtocolData): void {
    this.requireCompatibleSimulator();
    const previous = this.scenario.applyOptimisticParameterChange(id, value);
    try {
      this.send(this.scenario.createParamChangeMessage(id, value));
    } catch (error) {
      // A synchronous transport failure did not reach the simulator, so put
      // the UI back on its last canonical value rather than leaving a phantom
      // optimistic parameter behind.
      this.scenario.applyOptimisticParameterChange(id, previous.value);
      throw error;
    }
  }

  sendScreenshotResponse(payload: ScreenshotResponsePayload): void {
    this.send(this.scenario.createScreenshotResponseMessage(payload));
  }

  startRecording(options: RecordingOptions = {}): Snapshot {
    return this.beginRecording(options, 'manual');
  }

  private beginRecording(options: RecordingOptions, reason: RendererSessionRecordingDetail['reason']): Snapshot {
    const snapshot = this.recorder.start({
      ...options,
      ...(options.modelIdentity === undefined && this.modelIdentity !== null ? { modelIdentity: this.modelIdentity } : {}),
    });
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

  /** Apply a recorded frame, including locally optimistic parameter controls. */
  applyReplayFrame(frame: SnapshotFrame): void {
    applySnapshotFrame(this.scenario, frame, {
      applyMessage: (message) => this.applyReplay(message),
    });
  }

  handleIncoming(message: SimulatorToRendererMessage): void {
    if (message.type === 'simulator_info') {
      if (this.legacySession) {
        this.reportSessionError('protocol_mode_changed', 'A transport session cannot switch from legacy to strict protocol mode.');
        return;
      }
      this.acceptSimulatorInfo(message.payload as SimulatorInfoPayload);
      return;
    }
    if (!this.announcedInfo && !this.legacySession) {
      this.reportSessionError('handshake_required', 'simulator_info must be the first simulator message.');
      return;
    }
    // A persisted project may be attached to a different model at the same
    // endpoint. Keep its loaded Scenario entirely isolated until the user
    // explicitly changes source or discards the old state.
    if (this.identityStatusState === 'model-mismatch') return;
    if ((this.identityStatusState === 'sync-required' || this.identityStatusState === 'instance-changed')
      && !this.transaction
      && message.type !== 'state_sync_begin'
      && message.type !== 'error') {
      this.reportSessionError('state_sync_required', 'A replacement state sync is required before accepting simulator mutations.');
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
    if (message.type === 'scene_capture_result') {
      this.completeSceneCapture(message.payload as SceneCaptureResultPayload, message);
      return;
    }
    if (message.type === 'error') {
      this.abortCorrelatedControl(message.payload as ErrorPayload);
      this.applyCommittedMessage(message, 'live');
      return;
    }
    if (this.transaction) {
      this.applyTransactionMessage(message);
      return;
    }
    this.applyCommittedMessage(message, 'live');
    if (message.type === 'action_result') {
      const payload = message.payload as ActionResultPayload;
      this.run.observeActionResult(payload);
      const metrics = this.actionMetrics?.recordCompletion(payload);
      if (metrics) {
        this.dispatch('action:metrics', { metrics } satisfies RendererSessionActionMetricsDetail);
      }
    }
    if (message.type === 'asset_metadata') this.send(this.scenario.createAssetSyncMessage());
  }

  private acceptSimulatorInfo(info: SimulatorInfoPayload): void {
    const normalizedInfo = normalizeSimulatorInfo(info);
    const previous = this.announcedInfo;
    const recoveryRequired = this.identityStatusState === 'sync-required';
    this.announcedInfo = structuredClone(normalizedInfo);
    this.updateIdentityStatus(normalizedInfo);
    if (recoveryRequired && this.identityStatusState === 'matching') {
      this.identityStatusState = 'sync-required';
    }
    this.dispatch('simulator:info', {
      status: this.identityStatusState,
      simulator_info: this.simulatorInfo!,
      previous: previous === null ? undefined : structuredClone(previous),
    } satisfies RendererIdentityDetail);
  }

  /**
   * Called by a transport after its handshake grace period selects v0.2.
   * Existing projects cannot be safely bound because v0.2 has no model
   * identity, so they remain isolated rather than being auto-synchronised.
   */
  beginLegacyProtocol(): void {
    if (this.legacySession) return;
    if (this.announcedInfo !== null) {
      this.reportSessionError('protocol_mode_changed', 'A transport session cannot switch from strict to legacy protocol mode.');
      return;
    }
    this.legacySession = true;
    this.identityStatusState = this.expectedIdentity === null && this.committedInfo === null
      ? 'matching'
      : 'model-mismatch';
    this.dispatch('simulator:legacy', { status: this.identityStatusState });
  }

  private beginStateSync(payload: StateSyncBeginPayload, message: SimulatorToRendererMessage): void {
    const info = this.announcedInfo ?? LEGACY_SIMULATOR_INFO;
    const active = this.activeRequest;
    const invalidLegacySync = this.legacySession
      ? this.transaction || active?.kind !== 'state-sync' || payload.request_id !== active.requestId
      : this.transaction || active?.kind !== 'state-sync' || payload.request_id !== active.requestId || payload.model_id !== info.model.id || payload.instance_id !== info.instance_id || (payload.mode === 'reconcile' && this.stateSyncIdentity?.instance_id !== payload.instance_id);
    if (invalidLegacySync) {
      this.reportSessionError('invalid_state_sync', 'Rejected unmatched state_sync_begin.');
      return;
    }
    const staging = this.createStagingScenario();
    if (payload.mode === 'reconcile') staging.load(this.scenario.dump());
    this.transaction = { kind: 'state-sync', requestId: payload.request_id, scenario: staging, messages: [message] };
    try {
      staging.apply(message);
    } catch (error) {
      this.failActiveRequest(
        'invalid_state_sync',
        `Unable to begin state sync: ${error instanceof Error ? error.message : String(error)}`,
        true,
        true,
      );
      return;
    }
    this.run.recordStateSyncBoundary('begin', payload);
    this.dispatch('message', { message, origin: 'state-sync' } satisfies RendererSessionMessageDetail);
  }

  private endStateSync(payload: StateSyncEndPayload, message: SimulatorToRendererMessage): void {
    const transaction = this.transaction;
    if (!transaction || transaction.kind !== 'state-sync' || payload.request_id !== transaction.requestId) {
      this.reportSessionError('invalid_state_sync', 'Rejected unmatched state_sync_end.');
      return;
    }
    try {
      transaction.scenario.apply(message);
      transaction.messages.push(message);
      this.scenario.load(transaction.scenario.dump());
      this.recorder.recordMessages(transaction.messages);
    } catch (error) {
      this.failActiveRequest(
        'invalid_state_sync',
        `Unable to complete state sync: ${error instanceof Error ? error.message : String(error)}`,
        true,
        true,
      );
      return;
    }
    this.dispatch('commit', { origin: 'state-sync', messages: transaction.messages } satisfies RendererSessionCommitDetail);
    this.dispatch('message', { message, origin: 'state-sync' } satisfies RendererSessionMessageDetail);
    if (this.legacySession) {
      this.committedInfo = null;
      this.expectedIdentity = null;
    } else {
      this.committedInfo = structuredClone(this.announcedInfo!);
      this.expectedIdentity = this.modelIdentity;
    }
    this.identityStatusState = 'matching';
    this.transaction = null;
    this.completeActiveRequest('state-sync');
    this.run.recordStateSyncBoundary('end', payload);
    if (transaction.messages.some((entry) => entry.type === 'asset_metadata')) this.send(this.scenario.createAssetSyncMessage());
  }

  private beginSceneRestore(message: SimulatorToRendererMessage): void {
    const payload = message.payload as { request_id: string };
    const active = this.activeRequest;
    if (this.transaction || active?.kind !== 'scene-restore' || payload.request_id !== active.requestId) {
      this.reportSessionError('invalid_scene_restore', 'Rejected unmatched scene_restore_begin.');
      return;
    }
    const staging = this.createStagingScenario();
    staging.load(this.scenario.dump());
    const options = active.restoreOptions;
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
    try {
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
    } catch (error) {
      this.failActiveRequest(
        'invalid_scene_restore',
        `Unable to commit scene restore: ${error instanceof Error ? error.message : String(error)}`,
        true,
        true,
      );
      return;
    }
    this.dispatch('message', { message, origin: 'scene-restore' } satisfies RendererSessionMessageDetail);
    this.transaction = null;
    this.completeActiveRequest('scene-restore', structuredClone(payload));
  }

  private completeSceneCapture(payload: SceneCaptureResultPayload, message: SimulatorToRendererMessage): void {
    const info = this.announcedInfo!;
    const active = this.activeRequest;
    if (active?.kind !== 'scene-capture' || payload.request_id !== active.requestId) {
      this.reportSessionError('invalid_scene_capture', 'Rejected unmatched scene_capture_result.', payload.request_id);
      return;
    }
    if (payload.model_id !== info.model.id
      || (payload.state_schema_version !== undefined
        && info.model.state_schema_version !== undefined
        && payload.state_schema_version !== info.model.state_schema_version)) {
      this.failActiveRequest(
        'invalid_scene_capture',
        'Rejected scene_capture_result for a different model or state schema.',
      );
      return;
    }
    this.recorder.recordMessage(message);
    this.dispatch('message', { message, origin: 'live' } satisfies RendererSessionMessageDetail);
    this.dispatch('scene:capture', { result: structuredClone(payload) } satisfies RendererSceneCaptureDetail);
    this.completeActiveRequest('scene-capture', structuredClone(payload));
  }

  private applyTransactionMessage(message: SimulatorToRendererMessage): void {
    const transaction = this.transaction!;
    if (transaction.kind === 'scene-restore' && message.type.startsWith('chart_')) {
      this.failActiveRequest('invalid_scene_restore', 'Chart messages are forbidden during scene restore.', true, true);
      return;
    }
    try {
      transaction.scenario.apply(message);
    } catch (error) {
      this.failActiveRequest(
        transaction.kind === 'state-sync' ? 'invalid_state_sync' : 'invalid_scene_restore',
        `Rejected invalid transaction data: ${error instanceof Error ? error.message : String(error)}`,
        true,
        true,
      );
      return;
    }
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

  private abortCorrelatedControl(payload: ErrorPayload): void {
    if (payload.request_id === undefined || payload.request_id !== this.activeRequest?.requestId) return;
    this.failActiveRequest(payload.code, payload.message, false);
  }

  private assertNoActiveRequest(): void {
    if (this.activeRequest || this.transaction) {
      throw new Error('A protocol transaction is already active.');
    }
  }

  private activateRequest(
    kind: ActiveProtocolRequestKind,
    requestId: string,
    options: SceneOperationOptions = {},
    completion?: Pick<ActiveProtocolRequest, 'resolve' | 'reject'>,
    restoreOptions?: ActiveProtocolRequest['restoreOptions'],
  ): void {
    if (options.signal?.aborted) throw new Error('The protocol transaction was aborted before it started.');
    const timeoutMs = normalizeTransactionTimeout(options.timeoutMs ?? this.transactionTimeoutMs);
    const active: ActiveProtocolRequest = {
      kind,
      requestId,
      timeoutHandle: null,
      ...completion,
      ...(restoreOptions === undefined ? {} : { restoreOptions }),
    };
    this.activeRequest = active;

    active.timeoutHandle = setTimeout(() => {
      if (this.activeRequest !== active) return;
      this.failActiveRequest(
        'transaction_timeout',
        `The ${kind} transaction timed out after ${timeoutMs} ms.`,
        true,
        kind !== 'scene-capture',
      );
    }, timeoutMs);
    (active.timeoutHandle as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();

    if (options.signal) {
      const onAbort = () => {
        if (this.activeRequest !== active) return;
        this.failActiveRequest(
          'transaction_aborted',
          `The ${kind} transaction was aborted.`,
          true,
          kind === 'scene-restore',
        );
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
      active.removeAbortListener = () => options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private releaseActiveRequest(): ActiveProtocolRequest | null {
    const active = this.activeRequest;
    if (!active) return null;
    if (active.timeoutHandle !== null) clearTimeout(active.timeoutHandle);
    active.removeAbortListener?.();
    this.activeRequest = null;
    this.transaction = null;
    return active;
  }

  private completeActiveRequest(kind: ActiveProtocolRequestKind, payload?: unknown): boolean {
    if (this.activeRequest?.kind !== kind) return false;
    const active = this.releaseActiveRequest()!;
    active.resolve?.(payload);
    return true;
  }

  private failActiveRequest(
    code: string,
    message: string,
    report = true,
    requiresStateSync = false,
  ): boolean {
    const requestId = this.activeRequest?.requestId;
    const kind = this.activeRequest?.kind;
    const active = this.releaseActiveRequest();
    if (!active) return false;
    if (requiresStateSync && kind !== 'scene-capture' && this.isConnected) {
      this.identityStatusState = 'sync-required';
    }
    if (kind === 'state-sync') {
      if (requiresStateSync) this.run.reset('disconnected');
      else this.run.abortStateSync(active.requestId);
    }
    active.reject?.(new Error(message));
    if (report) this.reportSessionError(code, message, requestId);
    return true;
  }

  private cancelActiveRequest(message: string): void {
    this.failActiveRequest('transaction_cancelled', message, false);
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
    if (payload.envs !== undefined
      && !capabilities.has('scene.restore.topology')
      && projectedRestoreChangesTopology(this.scenario, payload.envs)) {
      throw new Error('Changing scene topology requires scene.restore.topology capability.');
    }
  }

  private requireCompatibleSimulator(allowStateSyncRecovery = false): SimulatorInfoPayload {
    if (this.legacySession) {
      if (this.identityStatusState === 'model-mismatch') {
        throw new Error('A legacy simulator cannot be verified against this renderer project. Start a new project before synchronising.');
      }
      if (!allowStateSyncRecovery && this.identityStatusState !== 'matching') {
        throw new Error('Complete a replacement state sync before mutating the simulator.');
      }
      return LEGACY_SIMULATOR_INFO;
    }
    if (!this.announcedInfo) throw new Error('Wait for simulator_info before sending renderer messages.');
    if (this.identityStatusState === 'model-mismatch') {
      throw new Error('The connected simulator model does not match this renderer project.');
    }
    if (!allowStateSyncRecovery && this.identityStatusState !== 'matching') {
      throw new Error('Complete a replacement state sync before mutating the simulator.');
    }
    return this.announcedInfo;
  }

  private updateIdentityStatus(info: SimulatorInfoPayload): void {
    const expected = this.committedInfo
      ? {
        model_id: this.committedInfo.model.id,
        ...(this.committedInfo.model.state_schema_version === undefined ? {} : { state_schema_version: this.committedInfo.model.state_schema_version }),
        instance_id: this.committedInfo.instance_id,
      }
      : this.expectedIdentity;
    if (!expected) {
      this.identityStatusState = 'matching';
      return;
    }
    if (expected.model_id !== info.model.id
      || (expected.state_schema_version !== undefined
        && expected.state_schema_version !== info.model.state_schema_version)) {
      this.identityStatusState = 'model-mismatch';
      return;
    }
    this.identityStatusState = expected.instance_id !== undefined && expected.instance_id !== info.instance_id
      ? 'instance-changed'
      : 'matching';
  }

  private reportSessionError(code: string, message: string, requestId?: string): void {
    const payload: ErrorPayload = {
      code,
      message,
      ...(requestId === undefined ? {} : { request_id: requestId }),
    };
    this.reportDiagnostic({
      severity: 'error',
      domain: 'protocol',
      source: 'renderer-session',
      code,
      message,
      requestId,
      dedupeKey: `${code}:${requestId ?? ''}:${message}`,
    });
    this.dispatch('protocol:error', payload);
  }

  private reportDiagnostic(event: Omit<DiagnosticEvent, 'timestamp'> & { timestamp?: number }): void {
    this.dispatch('diagnostic', {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    } satisfies DiagnosticEvent);
  }

  private createStagingScenario(): Scenario {
    const staging = new Scenario({ layerRegistry: this.scenario.layerRegistry });
    staging.addEventListener('diagnostic', this.scenarioDiagnosticHandler);
    return staging;
  }

  private send(message: RendererToSimulatorMessage): void {
    if (!this.transport) throw new Error('Renderer session is not attached to a transport.');
    const activeKind = this.activeRequest?.kind;
    if ((message.type === 'param_change' || message.type === 'action_invoke') && activeKind) {
      throw new Error('Cannot mutate the simulator while a protocol transaction is active.');
    }
    if (message.type === 'state_sync' && activeKind !== 'state-sync') {
      throw new Error('state_sync must belong to the active state-sync transaction.');
    }
    if (message.type === 'scene_restore' && activeKind !== 'scene-restore') {
      throw new Error('scene_restore must belong to the active restore transaction.');
    }
    if (message.type === 'scene_capture' && activeKind !== 'scene-capture') {
      throw new Error('scene_capture must belong to the active capture transaction.');
    }
    if (message.type === 'state_sync'
      || message.type === 'param_change'
      || message.type === 'action_invoke'
      || message.type === 'scene_restore'
      || message.type === 'scene_capture') {
      this.requireCompatibleSimulator(message.type === 'state_sync');
    }
    this.recorder.recordControl(message);
    if (message.type === 'action_invoke') {
      this.actionMetrics?.recordDispatch(message.payload as ActionInvokePayload);
    }
    this.dispatch('outbound', { message, origin: 'optimistic-control' } satisfies RendererSessionOutboundDetail);
    this.transport.send(message);
  }

  private clearActionMetrics(): void {
    if (!this.actionMetrics) return;
    this.actionMetrics = null;
    this.dispatch('action:metrics', { metrics: null } satisfies RendererSessionActionMetricsDetail);
  }

  private isSimulatorMessage(message: AnyProtocolMessage): boolean {
    return !rendererToSimulatorMessageTypes.has(message.type);
  }

  private dispatch<T>(type: string, detail: T): void {
    this.dispatchLazyCustom(type, () => detail);
  }
}
