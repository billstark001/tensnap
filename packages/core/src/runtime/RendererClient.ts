import type {
  ActionResultPayload, ErrorPayload, SimulatorToRendererMessage, StateSyncEndPayload,
} from '@tensnap/protocol';
import { connectWithHandshake, type ISimulatorTransport } from '../transport';
import { RendererSession, type RendererSessionOptions } from './RendererSession';

/** Owns a renderer session, its transport, and correlated waits; hosts supply the transport and render barrier. */
export class RendererClient {
  /** The authoritative projected state and protocol transaction manager. */
  readonly renderer: RendererSession;
  private activeTransport: ISimulatorTransport | null = null;
  private readonly pendingAborters = new Set<() => void>();

  /** Without a host render callback, requests complete their render barrier immediately. */
  constructor(options: RendererSessionOptions = {}) {
    this.renderer = new RendererSession({
      ...options,
      run: { renderBarrier: { wait: () => {} }, ...options.run },
    });
  }

  /** Destroy any previous transport, await its handshake, then optionally start an initial sync without awaiting its end. */
  async connect(transport: ISimulatorTransport, requestInitialSync = true): Promise<void> {
    this.disconnect();
    this.activeTransport = transport;
    try {
      const handshake = await connectWithHandshake(transport);
      const bufferedMessages = handshake.takeBufferedMessages();
      this.renderer.attachTransport(transport);
      if (handshake.mode === 'legacy') this.renderer.beginLegacyProtocol();
      for (const message of bufferedMessages) this.renderer.handleIncoming(message);
      if (requestInitialSync) this.renderer.requestStateSync();
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  /** Cancel pending waits and destroy the current transport. Safe to call repeatedly. */
  disconnect(): void {
    if (!this.activeTransport) return;
    for (const abort of [...this.pendingAborters]) abort();
    this.activeTransport.disconnect();
    this.renderer.detachTransport();
    this.activeTransport.destroy();
    this.activeTransport = null;
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
      const cleanup = (): void => {
        settled = true;
        clearTimeout(timeoutId);
        this.renderer.removeEventListener('message', onMessage);
        this.renderer.removeEventListener('transport:close', onDisconnect);
        this.renderer.removeEventListener('transport:error', onError);
        this.pendingAborters.delete(onDisconnect);
      };
      this.renderer.addEventListener('message', onMessage);
      this.renderer.addEventListener('transport:close', onDisconnect);
      this.renderer.addEventListener('transport:error', onError);
      this.pendingAborters.add(onDisconnect);
      try {
        requestId = start();
        for (const message of messages) decide(message);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}
