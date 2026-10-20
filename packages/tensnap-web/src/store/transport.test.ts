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
  StateSyncRequest,
} from '@tensnap/protocol';
import { describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './scenario/store';
import { createTransportStore } from './transport';
import { useSettingsStore } from './settings';
import { WebSocketConnectionError, WebSocketManagerImpl } from '@/transport';
import {
  RendererToSimulatorMessageSchema,
  SimulatorToRendererMessageSchema,
} from '@tensnap/protocol';

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

  connect(signal?: AbortSignal): Promise<void> {
    this.state = 'connecting';
    return new Promise<void>((resolve, reject) => {
      const abort = () => {
        this.resolveConnect = null;
        this.state = 'closed';
        reject(new Error('Connection was aborted'));
      };
      if (signal?.aborted) return abort();
      signal?.addEventListener('abort', abort, { once: true });
      this.resolveConnect = () => {
        signal?.removeEventListener('abort', abort);
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

  closeUnexpectedly(): void {
    this.state = 'closed';
    this.emit('close', undefined);
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

class ImmediateSyncTransport extends DeferredTransport {
  override send(message: RendererToSimulatorMessage): void {
    super.send(message);
    if (message.type !== 'state_sync') return;
    const requestId = (message.payload as { request_id: string }).request_id;
    this.receive({
      type: 'state_sync_begin',
      payload: {
        request_id: requestId,
        model_id: 'replacement-model',
        instance_id: 'replacement-instance',
        mode: 'replace',
      },
    });
    this.receive({
      type: 'state_sync_end',
      payload: { request_id: requestId, state_revision: '1' },
    });
  }
}

describe('transport store reconnect state', () => {
  it.each(['first-instance', 'second-instance'])(
    'restarts initial sync after a websocket reconnects during replay (%s)',
    async (instanceId) => {
      const useScenarioStore = createScenarioStore();
      const useTransportStore = createTransportStore(useScenarioStore);
      const transport = new DeferredTransport('ws://fixture', 'websocket');
      const info: SimulatorToRendererMessage = {
        type: 'simulator_info',
        payload: {
          protocol_version: '0.3',
          binding: { name: 'fixture', version: '0.3.0' },
          model: { id: 'reconnecting-model' },
          instance_id: 'first-instance',
          capabilities: [],
        },
      };

      try {
        const initialized = useTransportStore.getState().initialize(transport);
        transport.open();
        transport.receive(info);
        await initialized;
        expect(transport.sent.filter((message) => message.type === 'state_sync')).toHaveLength(1);
        const initialSync = transport.sent.find((message) => message.type === 'state_sync')!
          .payload as StateSyncRequest;
        transport.receive({
          type: 'state_sync_begin',
          payload: {
            request_id: initialSync.request_id,
            model_id: 'reconnecting-model',
            instance_id: 'first-instance',
            mode: 'replace',
          },
        });
        expect(useScenarioStore.getState().stateSync.phase).toBe('receiving');

        transport.closeUnexpectedly();
        const reconnected = transport.connect();
        transport.open();
        const reconnectedInfo = { ...info, payload: { ...info.payload, instance_id: instanceId } };
        transport.receive(reconnectedInfo);
        await reconnected;

        const syncs = transport.sent
          .filter((message) => message.type === 'state_sync')
          .map((message) => message.payload as StateSyncRequest);
        expect(syncs).toHaveLength(2);
        expect(syncs[1].request_id).not.toBe(syncs[0].request_id);
        expect(useScenarioStore.getState().stateSync.phase).toBe('requested');
        transport.receive({
          type: 'state_sync_begin',
          payload: {
            request_id: syncs[1].request_id,
            model_id: 'reconnecting-model',
            instance_id: instanceId,
            mode: 'replace',
          },
        });
        transport.receive({
          type: 'action_create',
          payload: { id: 'step', label: 'Step' },
        });
        transport.receive({ type: 'env_create', payload: { id: 'main', type: '2d' } });
        transport.receive({
          type: 'state_sync_end',
          payload: { request_id: syncs[1].request_id, state_revision: '1' },
        });
        expect(useScenarioStore.getState().stateSync.phase).toBe('idle');
        expect(useScenarioStore.getState().actions.has('step')).toBe(true);
        expect(useScenarioStore.getState().environments.has('main')).toBe(true);

        transport.receive(reconnectedInfo);
        expect(transport.sent.filter((message) => message.type === 'state_sync')).toHaveLength(2);
      } finally {
        useTransportStore.getState().destroy();
      }
    },
  );

  it('keeps a failed initial websocket attached for browser auto-reconnect', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new WebSocketManagerImpl('retry-test', 'ws://unused.test');
    vi.spyOn(transport, 'connect').mockRejectedValue(
      new WebSocketConnectionError('initial failure'),
    );

    await expect(useTransportStore.getState().initialize(transport)).resolves.toBeUndefined();
    expect(useTransportStore.getState().transport).toBe(transport);
    expect(useTransportStore.getState().canReconnect()).toBe(true);
    useTransportStore.getState().destroy();
  });

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

  it.each(['off', 'error'] as const)(
    'keeps explicit %s validation through initialization and reconnect',
    async (policy) => {
      const original = useSettingsStore.getState();
      const sockets: any[] = [];
      class Socket {
        static OPEN = 1;
        readyState = 0;
        onopen?: () => void;
        onmessage?: (event: { data: string }) => void;
        send = vi.fn();
        close() {
          this.readyState = 3;
        }
        constructor() {
          sockets.push(this);
        }
        open() {
          this.readyState = 1;
          this.onopen?.();
        }
      }
      vi.stubGlobal('WebSocket', Socket);
      const sendSchema = vi.spyOn(RendererToSimulatorMessageSchema, 'safeParse');
      const receiveSchema = vi.spyOn(SimulatorToRendererMessageSchema, 'safeParse');
      const store = createTransportStore(createScenarioStore(), policy);
      const transport = new WebSocketManagerImpl('benchmark', 'ws://unused.test', false, 'strict');
      try {
        useSettingsStore.setState({
          clientMessageValidation: 'off',
          serverMessageValidation: 'off',
        });
        const initialized = store.getState().initialize(transport);
        sockets[0].open();
        await initialized;
        for (let round = 0; round < 2; round++) {
          const active = store.getState().transport as WebSocketManagerImpl;
          useSettingsStore.setState({
            clientMessageValidation: 'warning',
            serverMessageValidation: 'warning',
          });
          useSettingsStore.setState({
            clientMessageValidation: 'off',
            serverMessageValidation: 'off',
          });
          expect(active.clientMessageValidation).toBe(policy);
          expect(active.serverMessageValidation).toBe(policy);
          sendSchema.mockClear();
          receiveSchema.mockClear();
          active.send({
            type: 'action_invoke',
            payload: { id: 'start', request_id: 'diagnostic' },
          });
          sockets[round].onmessage({
            data: JSON.stringify({ type: 'metadata_update', payload: { time: 1 } }),
          });
          expect(sendSchema).toHaveBeenCalledTimes(policy === 'off' ? 0 : 1);
          expect(receiveSchema).toHaveBeenCalledTimes(policy === 'off' ? 0 : 1);
          if (policy === 'error')
            expect(() =>
              active.send({ type: 'action_invoke', payload: { id: 42 } } as any),
            ).toThrow();
          if (round === 0) {
            const reconnected = store.getState().reconnect();
            sockets[1].open();
            sockets[1].onmessage({
              data: JSON.stringify({ type: 'metadata_update', payload: { time: 0 } }),
            });
            await reconnected;
          }
        }
      } finally {
        store.getState().destroy();
        useSettingsStore.setState(original);
        sendSchema.mockRestore();
        receiveSchema.mockRestore();
        vi.unstubAllGlobals();
      }
    },
  );

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

  it('keeps the current transport when initialize receives an unknown built-in model', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const current = new DeferredTransport('mock://current');
    const initialized = useTransportStore.getState().initialize(current);
    current.open();
    await initialized;

    await expect(useTransportStore.getState().initialize('inmemory:missing-model')).rejects.toThrow(
      /No built-in model/,
    );
    expect(useTransportStore.getState().transport).toBe(current);
    expect(current.isConnected).toBe(true);
    expect(useScenarioStore.getState().connected).toBe(true);
    useTransportStore.getState().destroy();
  });

  it('replays the replacement handshake once when sync responds synchronously', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const first = new DeferredTransport('mock://first');
    const initialized = useTransportStore.getState().initialize(first);
    first.open();
    await initialized;

    const second = new ImmediateSyncTransport('mock://second');
    const replacement = useTransportStore.getState().changeTransport(second);
    second.open();
    second.receive({
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

    expect(useScenarioStore.getState().stateSync.requestId).toBeNull();
    expect(useScenarioStore.getState().diagnostics).toEqual([]);
    useTransportStore.getState().destroy();
  });

  it('preserves the current transport when a replacement fails to connect', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const currentTransport = new DeferredTransport('mock://current');
    const failingTransport = new FailingTransport('mock://failing');

    const initialized = useTransportStore.getState().initialize(currentTransport);
    currentTransport.open();
    await initialized;

    await expect(useTransportStore.getState().changeTransport(failingTransport)).rejects.toThrow(
      'candidate connection failed',
    );

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

  it('keeps the latest source and status when an older candidate is superseded', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const current = new DeferredTransport('mock://current');
    const firstInit = useTransportStore.getState().initialize(current);
    current.open();
    await firstInit;

    const stale = new DeferredTransport('mock://stale');
    const latest = new DeferredTransport('mock://latest');
    const staleChange = useTransportStore.getState().changeTransport(stale);
    const staleRejection = expect(staleChange).rejects.toThrow(/abort/i);
    const latestChange = useTransportStore.getState().changeTransport(latest);
    latest.open();
    latest.receive({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'transport-test', version: '0.3.0' },
        model: { id: 'latest-model' },
        instance_id: 'latest-instance',
        capabilities: [],
      },
    });
    await staleRejection;
    await latestChange;

    expect(useTransportStore.getState().transport).toBe(latest);
    expect(useTransportStore.getState().connectionError).toBeNull();
    expect(latest.sent.filter((message) => message.type === 'state_sync')).toHaveLength(1);
    expect(current.connectionState).toBe('destroyed');
    useTransportStore.getState().destroy();
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

    useTransportStore.getState().destroy();

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
      parameters: [{ id: 'old-only', label: 'Old only', type: 'number', value: 1 }],
      actions: [],
      envs: [],
      charts: [],
      monitors: [],
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
      payload: {
        model_id: 'replacement-model',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
        monitors: [],
      },
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
      parameters: [],
      actions: [],
      envs: [],
      charts: [],
      monitors: [],
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
    expect(useScenarioStore.getState().diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'model_mismatch', severity: 'error' }),
      ]),
    );
  });

  it('starts a v0.2 sync after the transport selects legacy mode', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('mock://legacy');

    const initialized = useTransportStore.getState().initialize(transport, {
      parameters: [],
      actions: [],
      envs: [],
      charts: [],
      monitors: [],
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
      payload: {
        request_id: requestId,
        model_id: 'legacy',
        instance_id: 'legacy',
        mode: 'replace',
      },
    });
    transport.receive({
      type: 'state_sync_end',
      payload: { request_id: requestId, state_revision: 'legacy' },
    });
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
    expect(useTransportStore.getState().connectionError).toMatch(
      /legacy simulator cannot be verified/i,
    );
    expect(useScenarioStore.getState().connected).toBe(false);
  });

  it('reports a sync request after the retained transport disconnects', async () => {
    const useScenarioStore = createScenarioStore();
    const useTransportStore = createTransportStore(useScenarioStore);
    const transport = new DeferredTransport('mock://disconnected');
    const initialized = useTransportStore.getState().initialize(transport);
    transport.open();
    await initialized;
    transport.disconnect();

    expect(() => useTransportStore.getState().requestStateSync()).not.toThrow();
    expect(useScenarioStore.getState().diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'state_sync_while_disconnected', severity: 'warning' }),
      ]),
    );
    useTransportStore.getState().destroy();
  });
});

it('uses the global IP family for initial connections and updates reconnect policy', async () => {
  const original = useSettingsStore.getState().ip_family;
  const connect = vi.spyOn(WebSocketManagerImpl.prototype, 'connect').mockResolvedValue(undefined);
  const store = createTransportStore(createScenarioStore());
  try {
    useSettingsStore.getState().setIPFamily('ipv6');
    await store.getState().initialize('ws://localhost:8765/model');
    expect((store.getState().transport as WebSocketManagerImpl).ip_family).toBe('ipv6');
    expect(store.getState().connectionId).toBe('ws://localhost:8765/model');
    useSettingsStore.getState().setIPFamily('ipv4');
    expect((store.getState().transport as WebSocketManagerImpl).ip_family).toBe('ipv4');
    await store.getState().reconnect();
    expect((store.getState().transport as WebSocketManagerImpl).ip_family).toBe('ipv4');
    expect(store.getState().connectionId).toBe('ws://localhost:8765/model');
  } finally {
    store.getState().destroy();
    connect.mockRestore();
    useSettingsStore.getState().setIPFamily(original);
  }
});
