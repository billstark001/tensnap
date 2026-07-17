import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import type {
  ProtocolEncoding,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './scenario/store';
import { createTransportStore } from './transport';
import { useSettingsStore } from './settings';
import { WebSocketManagerImpl } from '@/transport';

class DeferredTransport implements ISimulatorTransport {
  readonly encoding: ProtocolEncoding = 'json';

  private state: TransportConnectionState = 'closed';
  private handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();
  private resolveConnect: (() => void) | null = null;
  readonly sent: RendererToSimulatorMessage[] = [];

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
    this.sent.push(message);
  }

  open(): void {
    this.resolveConnect?.();
    this.resolveConnect = null;
  }

  receive(message: SimulatorToRendererMessage): void {
    const group = this.handlers.get('message');
    if (!group) return;
    for (const handler of group) handler(message);
  }

  selectLegacyProtocol(): void {
    this.emit('protocol-mode', { mode: 'legacy', reason: 'handshake-timeout' });
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

class FailingTransport extends DeferredTransport {
  override connect(): Promise<void> {
    return Promise.reject(new Error('candidate connection failed'));
  }
}

describe('transport store reconnect state', () => {
  it('applies validation setting changes to the active websocket immediately', async () => {
    const originalClient = useSettingsStore.getState().clientMessageValidation;
    const originalServer = useSettingsStore.getState().serverMessageValidation;
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new WebSocketManagerImpl('validation-test', 'ws://unused.test');
    vi.spyOn(transport, 'connect').mockResolvedValue();

    try {
      await useTransportStore.getState().initialize(transport);
      useSettingsStore.getState().setClientMessageValidation('warning');
      useSettingsStore.getState().setServerMessageValidation('error');

      expect(transport.clientMessageValidation).toBe('warning');
      expect(transport.serverMessageValidation).toBe('error');
    } finally {
      useTransportStore.getState().destroy();
      useSettingsStore.getState().setClientMessageValidation(originalClient);
      useSettingsStore.getState().setServerMessageValidation(originalServer);
    }
  });

  it('keeps the current transport alive until a replacement connects', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const firstTransport = new DeferredTransport('mock://first');
    const secondTransport = new DeferredTransport('mock://second');

    const firstInit = useTransportStore.getState().initialize(firstTransport);
    firstTransport.open();
    await firstInit;

    const replacement = useTransportStore.getState().changeTransport(secondTransport);
    expect(useTransportStore.getState().transport).toBe(firstTransport);
    expect(firstTransport.isConnected).toBe(true);
    expect(useScenarioStore.getState().connected).toBe(true);

    secondTransport.open();
    secondTransport.receive({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'transport-test', version: '0.3.0' },
        model: { id: 'replacement-model' },
        instance_id: 'replacement-instance',
        capabilities: [],
      },
    });
    await replacement;

    expect(useTransportStore.getState().transport).toBe(secondTransport);
    expect(firstTransport.connectionState).toBe('destroyed');
    expect(useScenarioStore.getState().connected).toBe(true);
  });

  it('preserves the current transport when a replacement fails to connect', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const currentTransport = new DeferredTransport('mock://current');
    const failingTransport = new FailingTransport('mock://failing');

    const initialized = useTransportStore.getState().initialize(currentTransport);
    currentTransport.open();
    await initialized;

    await expect(useTransportStore.getState().changeTransport(failingTransport))
      .rejects.toThrow('candidate connection failed');

    expect(useTransportStore.getState().transport).toBe(currentTransport);
    expect(currentTransport.isConnected).toBe(true);
    expect(useScenarioStore.getState().connected).toBe(true);
  });

  it('preserves the current transport when replacement handshake times out', async () => {
    vi.useFakeTimers();
    try {
      const useScenarioStore = createScenarioStore();
      const useTransportStore = createTransportStore(useScenarioStore);
      const currentTransport = new DeferredTransport('mock://current');
      const silentTransport = new DeferredTransport('mock://silent');

      const initialized = useTransportStore.getState().initialize(currentTransport);
      currentTransport.open();
      await initialized;

      const replacement = useTransportStore.getState().changeTransport(silentTransport);
      const rejection = expect(replacement).rejects.toThrow(/did not send simulator_info/);
      silentTransport.open();
      await vi.advanceTimersByTimeAsync(10_000);
      await rejection;

      expect(useTransportStore.getState().transport).toBe(currentTransport);
      expect(currentTransport.isConnected).toBe(true);
      expect(useScenarioStore.getState().connected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('removes a superseded simulator-info listener before the next source announces', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const firstTransport = new DeferredTransport('mock://first');
    const secondTransport = new DeferredTransport('mock://second');

    const firstInit = useTransportStore.getState().initialize(firstTransport, {
      parameters: [{ id: 'old-only', label: 'Old only', type: 'number', value: 1 }], actions: [], envs: [], charts: [], monitors: [],
    });
    firstTransport.open();
    await firstInit;

    const secondInit = useTransportStore.getState().initialize(secondTransport);
    secondTransport.open();
    await secondInit;
    secondTransport.receive({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'transport-test', version: '0.3.0' },
        model: { id: 'replacement-model' },
        instance_id: 'replacement-instance',
        capabilities: [],
      },
    });

    const stateSyncs = secondTransport.sent.filter((message) => message.type === 'state_sync');
    expect(stateSyncs).toHaveLength(1);
    expect(stateSyncs[0]).toMatchObject({
      payload: { model_id: 'replacement-model', parameters: [], actions: [], envs: [], charts: [], monitors: [] },
    });
  });

  it('does not auto-sync a persisted project into a different model', async () => {
    const useScenarioStore = createScenarioStore();
    useScenarioStore.getState().session.setExpectedSimulatorIdentity({
      model_id: 'saved-model',
      state_schema_version: '1',
      instance_id: 'saved-instance',
    });
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('mock://mismatch');

    const initialized = useTransportStore.getState().initialize(transport, {
      parameters: [], actions: [], envs: [], charts: [], monitors: [],
    });
    transport.open();
    await initialized;
    transport.receive({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'transport-test', version: '0.3.0' },
        model: { id: 'other-model', state_schema_version: '1' },
        instance_id: 'other-instance',
        capabilities: [],
      },
    });

    expect(transport.sent.filter((message) => message.type === 'state_sync')).toEqual([]);
    expect(useTransportStore.getState().connectionError).toMatch(/does not match this project/i);
    expect(useScenarioStore.getState().connected).toBe(false);
    expect(useScenarioStore.getState().diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'model_mismatch', severity: 'error' }),
    ]));
  });

  it('starts a v0.2 sync after the transport selects legacy mode', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('mock://legacy');

    const initialized = useTransportStore.getState().initialize(transport, {
      parameters: [], actions: [], envs: [], charts: [], monitors: [],
    });
    transport.open();
    await initialized;
    transport.selectLegacyProtocol();

    const sync = transport.sent.find((message) => message.type === 'state_sync');
    expect(sync).toMatchObject({ payload: { model_id: 'legacy', monitors: [] } });
    expect(useScenarioStore.getState().session.isLegacyProtocol).toBe(true);

    const requestId = (sync!.payload as { request_id: string }).request_id;
    transport.receive({
      type: 'state_sync_begin',
      payload: { request_id: requestId, model_id: 'legacy', instance_id: 'legacy', mode: 'replace' },
    });
    transport.receive({ type: 'state_sync_end', payload: { request_id: requestId, state_revision: 'legacy' } });
    expect(useScenarioStore.getState().stateSync.requestId).toBeNull();
  });

  it('does not auto-sync a persisted project into an unverified legacy simulator', async () => {
    const useScenarioStore = createScenarioStore();
    useScenarioStore.getState().session.setExpectedSimulatorIdentity({ model_id: 'saved-model' });
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('mock://legacy-mismatch');

    const initialized = useTransportStore.getState().initialize(transport);
    transport.open();
    await initialized;
    transport.selectLegacyProtocol();

    expect(transport.sent.filter((message) => message.type === 'state_sync')).toEqual([]);
    expect(useTransportStore.getState().connectionError).toMatch(/legacy simulator cannot be verified/i);
    expect(useScenarioStore.getState().connected).toBe(false);
  });
});
