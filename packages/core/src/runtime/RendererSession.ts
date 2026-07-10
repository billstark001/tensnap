import type {
  ActionEndPayload,
  AnyProtocolMessage,
  RendererToSimulatorMessage,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncBoundaryPayload,
  StateSyncRequest,
} from '@tensnap/protocol';
import { Scenario } from '../scenario';
import type { ISimulatorTransport, TransportEventMap } from '../transport';
import { LazyEventTarget } from '../utils/LazyEventTarget';
import { RunController, type RunControllerOptions } from './RunController';
import { SnapshotRecorder } from '../snapshot';
import type { RecordingOptions, Snapshot } from '../snapshot';

export type RendererMessageOrigin = 'live' | 'state-sync' | 'replay' | 'optimistic-control';

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

export interface RendererSessionOptions {
  scenario?: Scenario;
  run?: Omit<RunControllerOptions, 'scenario' | 'send'>;
}

const createRequestId = (prefix: string): string => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
);

/**
 * The renderer-side protocol session shared by browser and Node hosts.
 * Scenario mutations are immediate, but a state-sync replay emits one commit
 * at its closing boundary so a UI never renders a partial reconstruction.
 */
export class RendererSession extends LazyEventTarget {
  readonly scenario: Scenario;
  readonly run: RunController;
  readonly recorder: SnapshotRecorder;

  private transport: ISimulatorTransport | null = null;
  private syncRequestId: string | null = null;
  private receivingSync = false;
  private readonly pendingSyncMessages: SimulatorToRendererMessage[] = [];

  private readonly transportMessageHandler = (message: TransportEventMap['message']) => {
    if (!this.isSimulatorMessage(message)) return;
    this.handleIncoming(message);
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
    this.receivingSync = false;
    this.pendingSyncMessages.length = 0;
    this.syncRequestId = null;
    this.run.reset('disconnected');
  }

  destroy(): void {
    this.detachTransport();
  }

  requestStateSync(
    requestId = createRequestId('sync'),
    request?: StateSyncRequest,
  ): string {
    this.syncRequestId = requestId;
    this.receivingSync = false;
    this.pendingSyncMessages.length = 0;
    this.run.requestStateSync(requestId);
    this.send({
      type: 'state_sync',
      payload: request ?? this.scenario.createStateSyncMessage(requestId).payload,
    });
    return requestId;
  }

  setParameter(id: string, value: unknown): void {
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

  /** Apply a recorded/offline message without inventing another wire shape. */
  applyReplay(message: SimulatorToRendererMessage): void {
    this.applyMessage(message, 'replay');
  }

  handleIncoming(message: SimulatorToRendererMessage): void {
    if (message.type === 'state_sync_begin') {
      const payload = message.payload as StateSyncBoundaryPayload;
      if (!this.matchesSyncRequest(payload)) return;
      this.receivingSync = true;
      this.run.recordStateSyncBoundary('begin', payload);
      this.applyMessage(message, 'state-sync');
      return;
    }

    if (message.type === 'state_sync_end') {
      const payload = message.payload as StateSyncBoundaryPayload;
      if (!this.matchesSyncRequest(payload)) return;
      this.applyMessage(message, 'state-sync');
      this.receivingSync = false;
      this.syncRequestId = null;
      this.run.recordStateSyncBoundary('end', payload);
      this.commitPendingSync();
      return;
    }

    this.applyMessage(message, this.receivingSync ? 'state-sync' : 'live');

    if (message.type === 'asset_meta') {
      this.send(this.scenario.createAssetSyncMessage());
    }
    if (message.type === 'action_end') {
      this.run.observeActionEnd(message.payload as ActionEndPayload);
    }
  }

  private applyMessage(message: SimulatorToRendererMessage, origin: RendererMessageOrigin): void {
    this.scenario.apply(message);
    this.recorder.recordMessage(message);
    this.dispatch('message', { message, origin } satisfies RendererSessionMessageDetail);

    if (origin === 'state-sync' && this.receivingSync) {
      this.pendingSyncMessages.push(message);
      return;
    }

    this.dispatch('commit', { origin, messages: [message] } satisfies RendererSessionCommitDetail);
  }

  private commitPendingSync(): void {
    if (this.pendingSyncMessages.length === 0) return;
    const messages = this.pendingSyncMessages.splice(0);
    this.dispatch('commit', { origin: 'state-sync', messages } satisfies RendererSessionCommitDetail);
  }

  private send(message: RendererToSimulatorMessage): void {
    if (!this.transport) {
      throw new Error('Renderer session is not attached to a transport.');
    }
    // Publish before entering the transport. In-memory transports may deliver
    // a synchronous action_end from send(), and observers need the tick id
    // before that completion can be applied.
    this.recorder.recordControl(message);
    this.dispatch('outbound', { message, origin: 'optimistic-control' } satisfies RendererSessionOutboundDetail);
    this.transport.send(message);
  }

  private matchesSyncRequest(payload: StateSyncBoundaryPayload): boolean {
    return this.syncRequestId === null
      || payload.request_id === undefined
      || payload.request_id === this.syncRequestId;
  }

  private isSimulatorMessage(message: AnyProtocolMessage): message is SimulatorToRendererMessage {
    return !(
      message.type === 'action_start'
      || message.type === 'asset_sync'
      || message.type === 'param_change'
      || message.type === 'state_sync'
      || message.type === 'screenshot_response'
    );
  }

  private dispatch<T>(type: string, detail: T): void {
    this.dispatchLazyCustom(type, () => detail);
  }
}
