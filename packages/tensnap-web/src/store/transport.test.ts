import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import type {
  ProtocolEncoding,
  RendererToSimulatorMessage,
} from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { createScenarioStore } from './scenario/store';
import { createTransportStore } from './transport';

class DeferredTransport implements ISimulatorTransport {
  readonly encoding: ProtocolEncoding = 'json';

  private state: TransportConnectionState = 'closed';
  private handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();
  private resolveConnect: (() => void) | null = null;

  constructor(
    readonly connectionId: string,
    readonly transportKind: 'mock' | 'websocket' | 'inmemory' = 'mock',
  ) {}

  get connectionState(): TransportConnectionState {
    return this.state;
  }

  get isConnected(): boolean {
    return this.state === 'open';
  }

  connect(): Promise<void> {
    this.state = 'connecting';
    return new Promise<void>((resolve) => {
      this.resolveConnect = () => {
        this.state = 'open';
        this.emit('open', undefined);
        resolve();
      };
    });
  }

  disconnect(): void {
    this.state = 'closed';
  }

  destroy(): void {
    this.state = 'destroyed';
    this.handlers.clear();
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!handler) {
      this.handlers.delete(type);
      return;
    }

    const group = this.handlers.get(type);
    if (!group) {
      return;
    }

    group.delete(handler);
    if (group.size === 0) {
      this.handlers.delete(type);
    }
  }

  send(message: RendererToSimulatorMessage): void {
    void message;
    // no-op for tests
  }

  open(): void {
    this.resolveConnect?.();
    this.resolveConnect = null;
  }

  private emit<K extends keyof TransportEventMap>(type: K, payload: TransportEventMap[K]): void {
    const group = this.handlers.get(type);
    if (!group) {
      return;
    }

    for (const handler of group) {
      handler(payload);
    }
  }
}

describe('transport store reconnect state', () => {
  it('marks the scenario disconnected before swapping transports', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const firstTransport = new DeferredTransport('mock://first');
    const secondTransport = new DeferredTransport('mock://second');

    const firstInit = useTransportStore.getState().initialize(firstTransport);
    firstTransport.open();
    await firstInit;

    expect(useScenarioStore.getState().connected).toBe(true);

    const secondInit = useTransportStore.getState().initialize(secondTransport);

    expect(useScenarioStore.getState().connected).toBe(false);

    secondTransport.open();
    await secondInit;

    expect(useScenarioStore.getState().connected).toBe(true);
  });

  it('does not reconnect destroyed in-memory transports', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('inmemory:model-1', 'inmemory');

    const init = useTransportStore.getState().initialize(transport);
    transport.open();
    await init;

    expect(useTransportStore.getState().canReconnect()).toBe(false);

    useTransportStore.getState().disconnect();

    await expect(useTransportStore.getState().reconnect()).resolves.toBeUndefined();
    expect(useTransportStore.getState().transport).toBeNull();
  });

  it('only exposes reconnect for websocket transports', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('ws://example.test', 'websocket');

    const init = useTransportStore.getState().initialize(transport);
    transport.open();
    await init;

    expect(useTransportStore.getState().canReconnect()).toBe(true);
  });
});
