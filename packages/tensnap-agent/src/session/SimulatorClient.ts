import type {
  ActionResultPayload, AnyProtocolMessage, ErrorPayload, ProtocolData, SceneCaptureResultPayload,
  SceneRestoreEndPayload, SimulatorToRendererMessage, StateSyncEndPayload,
} from '@tensnap/protocol';
import { RendererSession, type RendererSessionOptions, type SceneRestoreOptions } from '@tensnap/core/runtime';
import type { ConnectOptions } from '../types';
import { NodeWebSocketTransport } from './NodeWebSocketTransport';

/**
 * A Node simulator connection shared by the CLI runtime and direct clients.
 * RendererSession remains the source of truth for protocol transactions and
 * projected state; this class owns only connection and request lifecycles.
 */
export class SimulatorClient {
  readonly renderer: RendererSession;
  private activeTransport: NodeWebSocketTransport | null = null;
  private readonly wireListeners = new Set<(message: AnyProtocolMessage) => void>();
  private readonly pendingAborters = new Set<() => void>();

  constructor(options: RendererSessionOptions = {}) {
    this.renderer = new RendererSession({
      ...options,
      run: { renderBarrier: { wait: () => {} }, ...options.run },
    });
  }

  onWireMessage(listener: (message: AnyProtocolMessage) => void): () => void {
    this.wireListeners.add(listener);
    return () => this.wireListeners.delete(listener);
  }

  /** Wait for this connection's handshake, then optionally request an initial sync without waiting for its commit. */
  async connect(options: ConnectOptions, requestInitialSync = true): Promise<void> {
    this.disconnect();
    const transport = new NodeWebSocketTransport(options.simulatorUrl, options.encoding ?? 'msgpack', {
      clientMessages: options.clientMessageValidation ?? 'off',
      serverMessages: options.serverMessageValidation ?? 'off',
    });
    this.activeTransport = transport;
    transport.on('message', (message) => {
      for (const listener of this.wireListeners) listener(message as AnyProtocolMessage);
    });
    this.renderer.attachTransport(transport);
    const handshakeAbort = new AbortController();
    const handshake = this.waitForSimulatorInfo(10_000, handshakeAbort.signal);
    void handshake.catch(() => {});
    try {
      await transport.connect();
      await handshake;
      if (requestInitialSync) this.renderer.requestStateSync();
    } catch (error) {
      handshakeAbort.abort();
      this.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    if (!this.activeTransport) return;
    for (const abort of [...this.pendingAborters]) abort();
    this.activeTransport.disconnect();
    this.renderer.detachTransport();
    this.activeTransport.destroy();
    this.activeTransport = null;
  }

  async sync(requestId?: string): Promise<SimulatorToRendererMessage[]> {
    const { messages } = await this.collectRequest(
      () => this.renderer.requestStateSync(requestId),
      (message, id) => {
        if (message.type === 'state_sync_end' && (message.payload as StateSyncEndPayload).request_id === id) return { value: undefined };
        if (message.type === 'error' && (message.payload as ErrorPayload).request_id === id) {
          const payload = message.payload as ErrorPayload;
          return { error: new Error(`${payload.code}: ${payload.message}`) };
        }
        return null;
      },
      30_000,
      'state sync',
    );
    return messages;
  }

  requestAction(id: string): string {
    this.renderer.run.cancelContinuousActions();
    return this.renderer.run.requestAction(id);
  }

  /** Wait for a correlated result and the headless render barrier. */
  async invokeAction(id: string, timeoutMs = 10_000): Promise<{ result: ActionResultPayload; messages: SimulatorToRendererMessage[] }> {
    const completed = await this.collectRequest(
      () => this.requestAction(id),
      (message, requestId) => message.type === 'action_result' &&
        (message.payload as ActionResultPayload).request_id === requestId
        ? { value: message.payload as ActionResultPayload } : null,
      timeoutMs,
      `action ${id}`,
    );
    const deadline = Date.now() + timeoutMs;
    while (this.renderer.run.hasInFlightAction) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for action ${id} to finish rendering.`);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { result: completed.value, messages: completed.messages };
  }

  private async collectRequest<T>(
    start: () => string,
    match: (message: SimulatorToRendererMessage, requestId: string) => { value: T } | { error: Error } | null,
    timeoutMs: number,
    label: string,
  ): Promise<{ value: T; messages: SimulatorToRendererMessage[] }> {
    const messages: SimulatorToRendererMessage[] = [];
    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${label}.`)); }, timeoutMs);
      const onMessage = (event: Event): void => {
        const message = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail.message;
        messages.push(message);
        const decision = match(message, requestId);
        if (!decision) return;
        cleanup();
        if ('error' in decision) reject(decision.error);
        else resolve({ value: decision.value, messages });
      };
      const onClose = (): void => { cleanup(); reject(new Error(`Disconnected before ${label} completed.`)); };
      const onDisconnect = (): void => { cleanup(); reject(new Error(`Disconnected before ${label} completed.`)); };
      const onError = (event: Event): void => {
        cleanup();
        const detail = (event as CustomEvent<unknown>).detail;
        reject(detail instanceof Error ? detail : new Error(String(detail)));
      };
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.renderer.removeEventListener('message', onMessage);
        this.renderer.removeEventListener('transport:close', onClose);
        this.renderer.removeEventListener('transport:error', onError);
        this.pendingAborters.delete(onDisconnect);
      };
      let requestId: string;
      this.renderer.addEventListener('message', onMessage);
      this.renderer.addEventListener('transport:close', onClose);
      this.renderer.addEventListener('transport:error', onError);
      this.pendingAborters.add(onDisconnect);
      try { requestId = start(); }
      catch (error) { cleanup(); reject(error); }
    });
  }

  setParameter(id: string, value: ProtocolData): void { this.renderer.setParameter(id, value); }

  async waitForWireMessage(
    predicate: (message: AnyProtocolMessage) => boolean,
    timeoutMs = 10_000,
  ): Promise<AnyProtocolMessage> {
    return await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for simulator message.')); }, timeoutMs);
      const onDisconnect = (): void => { cleanup(); reject(new Error('Disconnected before simulator message arrived.')); };
      const onMessage = (message: AnyProtocolMessage): void => {
        if (!predicate(message)) return;
        cleanup();
        resolve(message);
      };
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.wireListeners.delete(onMessage);
        this.pendingAborters.delete(onDisconnect);
      };
      this.wireListeners.add(onMessage);
      this.pendingAborters.add(onDisconnect);
    });
  }
  captureScene(): Promise<SceneCaptureResultPayload> { return this.renderer.captureScene(); }
  restoreScene(input: Parameters<RendererSession['restoreScene']>[0], options: SceneRestoreOptions = {}): Promise<SceneRestoreEndPayload> {
    return this.renderer.restoreScene(input, options);
  }

  private async waitForSimulatorInfo(timeoutMs: number, signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for simulator_info.')); }, timeoutMs);
      const onInfo = (): void => { cleanup(); resolve(); };
      const onClose = (): void => { cleanup(); reject(new Error('Runtime disconnected before simulator_info arrived.')); };
      const onAbort = (): void => { cleanup(); reject(new Error('Simulator connection was cancelled.')); };
      const onError = (event: Event): void => {
        cleanup();
        const detail = (event as CustomEvent<unknown>).detail;
        reject(detail instanceof Error ? detail : new Error(String(detail)));
      };
      const cleanup = (): void => {
        clearTimeout(timeoutId);
        this.renderer.removeEventListener('simulator:info', onInfo);
        this.renderer.removeEventListener('transport:close', onClose);
        this.renderer.removeEventListener('transport:error', onError);
        signal.removeEventListener('abort', onAbort);
      };
      this.renderer.addEventListener('simulator:info', onInfo);
      this.renderer.addEventListener('transport:close', onClose);
      this.renderer.addEventListener('transport:error', onError);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
