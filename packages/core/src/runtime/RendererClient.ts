import type {
  ActionResultPayload, ErrorPayload, SimulatorToRendererMessage, StateSyncEndPayload,
} from '@tensnap/protocol';
import { connectWithHandshake, type ISimulatorTransport, type TransportHandshake } from '../transport';
import { RendererSession, type RendererSessionOptions } from './RendererSession';

export interface RendererClientOptions extends RendererSessionOptions {
  /** Use a session already configured by the host, including its render barrier. */
  session?: RendererSession;
}

export interface ReplaceTransportOptions {
  signal?: AbortSignal;
  requestInitialSync?: boolean;
  resetSimulatorIdentity?: boolean;
  /** Install host listeners and state after the swap, before buffered messages are replayed. */
  onActivated?: (mode: TransportHandshake['mode']) => void;
}

/** Owns a renderer session, its transport, and correlated waits; hosts supply the transport and render barrier. */
export class RendererClient {
  /** The authoritative projected state and protocol transaction manager. */
  readonly renderer: RendererSession;
  private activeTransport: ISimulatorTransport | null = null;
  private pendingReplacement: { transport: ISimulatorTransport; controller: AbortController; destroyed: boolean } | null = null;
  private readonly pendingAborters = new Set<() => void>();
  private connectionGeneration = 0;

  /** Without a host render callback, requests complete their render barrier immediately. */
  constructor(options: RendererClientOptions = {}) {
    const { session, ...sessionOptions } = options;
    this.renderer = session ?? new RendererSession({
      ...sessionOptions,
      run: { renderBarrier: { wait: () => {} }, ...sessionOptions.run },
    });
  }

  /** Destroy any previous transport, await its handshake, then optionally start an initial sync without awaiting its end. */
  async connect(transport: ISimulatorTransport, requestInitialSync = true): Promise<void> {
    this.disconnect();
    await this.replaceTransport(transport, { requestInitialSync });
  }

  /** Attach before connection so a host-managed reconnecting transport can deliver its first message. */
  attachTransport(transport: ISimulatorTransport): void {
    if (this.activeTransport === transport) return;
    this.disconnect();
    this.activeTransport = transport;
    this.renderer.attachTransport(transport);
  }

  /** Keep the active transport until a candidate passes its handshake, then swap and replay in wire order. */
  async replaceTransport(transport: ISimulatorTransport, options: ReplaceTransportOptions = {}): Promise<void> {
    if (transport === this.activeTransport) throw new Error('The replacement transport is already active.');
    const generation = ++this.connectionGeneration;
    this.cancelPendingReplacement();
    const controller = new AbortController();
    const pending = { transport, controller, destroyed: false };
    this.pendingReplacement = pending;
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) controller.abort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });
    let installed = false;
    const assertCurrent = (): void => {
      if (generation !== this.connectionGeneration || controller.signal.aborted) {
        throw new Error('The replacement connection was cancelled.');
      }
    };
    try {
      const handshake = await connectWithHandshake(transport, controller.signal);
      assertCurrent();
      if (this.pendingReplacement !== pending) throw new Error('The replacement connection was cancelled.');
      this.pendingReplacement = null;
      let bufferedMessages: SimulatorToRendererMessage[];
      try {
        this.releaseActiveTransport();
      } finally {
        // Keep buffering during retirement, and always remove the handshake listeners.
        bufferedMessages = handshake.takeBufferedMessages();
      }
      // A close listener on the old transport may synchronously disconnect or
      // start another replacement while it is being retired.
      assertCurrent();
      if (options.resetSimulatorIdentity) this.renderer.resetSimulatorIdentity();
      this.activeTransport = transport;
      installed = true;
      this.renderer.attachTransport(transport);
      if (handshake.mode === 'legacy') this.renderer.beginLegacyProtocol();
      options.onActivated?.(handshake.mode);
      assertCurrent();
      for (const message of bufferedMessages) this.renderer.handleIncoming(message);
      assertCurrent();
      if (options.requestInitialSync ?? true) this.renderer.requestStateSync();
    } catch (error) {
      if (this.pendingReplacement === pending) this.pendingReplacement = null;
      if (this.activeTransport === transport && generation === this.connectionGeneration) this.releaseActiveTransport();
      else if (!pending.destroyed && !installed) transport.destroy();
      throw error;
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Cancel pending waits and destroy the current transport. Safe to call repeatedly. */
  disconnect(): void {
    this.connectionGeneration += 1;
    this.cancelPendingReplacement();
    this.releaseActiveTransport();
  }

  private cancelPendingReplacement(): void {
    const pending = this.pendingReplacement;
    if (!pending) return;
    this.pendingReplacement = null;
    pending.destroyed = true;
    pending.controller.abort();
    pending.transport.destroy();
  }

  private releaseActiveTransport(): void {
    if (!this.activeTransport) return;
    for (const abort of [...this.pendingAborters]) abort();
    const transport = this.activeTransport;
    this.activeTransport = null;
    try {
      transport.disconnect();
    } finally {
      try {
        this.renderer.detachTransport();
      } finally {
        transport.destroy();
      }
    }
  }

  /** Request a full sync and resolve after its matching end frame; reject on a correlated error or disconnect. */
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

  /** Interrupt continuous dispatch and send one action, returning its request ID. */
  requestAction(id: string): string {
    this.renderer.run.cancelContinuousActions();
    return this.renderer.run.requestAction(id);
  }

  /** Send one action and wait for its result and the host's render barrier. */
  async invokeAction(id: string, timeoutMs = 10_000): Promise<{ result: ActionResultPayload; messages: SimulatorToRendererMessage[] }> {
    const renderedIds = new Set<string>();
    let wakeRendered: (() => void) | null = null;
    const onRendered = (event: Event): void => {
      renderedIds.add((event as CustomEvent<{ request_id: string }>).detail.request_id);
      wakeRendered?.();
    };
    this.renderer.addEventListener('action:rendered', onRendered);
    try {
      const completed = await this.collectRequest(
        () => this.requestAction(id),
        (message, requestId) => message.type === 'action_result' &&
          (message.payload as ActionResultPayload).request_id === requestId &&
          (message.payload as ActionResultPayload).id === id
          ? { value: message.payload as ActionResultPayload } : null,
        timeoutMs,
        `action ${id}`,
      );
      const requestId = completed.value.request_id;
      if (!renderedIds.has(requestId)) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = (): void => {
            clearTimeout(timeout);
            this.renderer.removeEventListener('transport:close', onDisconnect);
            this.renderer.removeEventListener('transport:error', onError);
            this.pendingAborters.delete(onDisconnect);
            wakeRendered = null;
          };
          const onDisconnect = (): void => {
            cleanup();
            reject(new Error(`Disconnected before action ${id} finished rendering.`));
          };
          const onError = (event: Event): void => {
            cleanup();
            const detail = (event as CustomEvent<unknown>).detail;
            reject(detail instanceof Error ? detail : new Error(String(detail)));
          };
          const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for action ${id} to finish rendering.`));
          }, timeoutMs);
          wakeRendered = () => {
            if (!renderedIds.has(requestId)) return;
            cleanup();
            resolve();
          };
          this.renderer.addEventListener('transport:close', onDisconnect);
          this.renderer.addEventListener('transport:error', onError);
          this.pendingAborters.add(onDisconnect);
          if (!this.renderer.isConnected) onDisconnect();
          else wakeRendered();
        });
      }
      return { result: completed.value, messages: completed.messages };
    } finally {
      this.renderer.removeEventListener('action:rendered', onRendered);
    }
  }

  private async collectRequest<T>(
    start: () => string,
    match: (message: SimulatorToRendererMessage, requestId: string) => { value: T } | { error: Error } | null,
    timeoutMs: number,
    label: string,
  ): Promise<{ value: T; messages: SimulatorToRendererMessage[] }> {
    const messages: SimulatorToRendererMessage[] = [];
    const protocolErrors: ErrorPayload[] = [];
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => { cleanup(); reject(new Error(`Timed out waiting for ${label}.`)); }, timeoutMs);
      let settled = false;
      // In-memory transports may emit the entire response before start() returns its request ID.
      let requestId: string | null = null;
      const decide = (message: SimulatorToRendererMessage): void => {
        if (settled || requestId === null) return;
        const decision = match(message, requestId);
        if (!decision) return;
        cleanup();
        if ('error' in decision) reject(decision.error);
        else resolve({ value: decision.value, messages });
      };
      const onMessage = (event: Event): void => {
        const message = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail.message;
        messages.push(message);
        decide(message);
      };
      const onDisconnect = (): void => { cleanup(); reject(new Error(`Disconnected before ${label} completed.`)); };
      const onError = (event: Event): void => {
        cleanup();
        const detail = (event as CustomEvent<unknown>).detail;
        reject(detail instanceof Error ? detail : new Error(String(detail)));
      };
      const decideProtocolError = (payload: ErrorPayload): void => {
        if (settled || requestId === null || payload.request_id !== requestId) return;
        cleanup();
        reject(new Error(`${payload.code}: ${payload.message}`));
      };
      const onProtocolError = (event: Event): void => {
        const payload = (event as CustomEvent<ErrorPayload>).detail;
        if (requestId === null) protocolErrors.push(payload);
        else decideProtocolError(payload);
      };
      const cleanup = (): void => {
        settled = true;
        clearTimeout(timeoutId);
        this.renderer.removeEventListener('message', onMessage);
        this.renderer.removeEventListener('transport:close', onDisconnect);
        this.renderer.removeEventListener('transport:error', onError);
        this.renderer.removeEventListener('protocol:error', onProtocolError);
        this.pendingAborters.delete(onDisconnect);
      };
      this.renderer.addEventListener('message', onMessage);
      this.renderer.addEventListener('transport:close', onDisconnect);
      this.renderer.addEventListener('transport:error', onError);
      this.renderer.addEventListener('protocol:error', onProtocolError);
      this.pendingAborters.add(onDisconnect);
      try {
        requestId = start();
        for (const message of messages) decide(message);
        for (const payload of protocolErrors) decideProtocolError(payload);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}
