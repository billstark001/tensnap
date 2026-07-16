import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import type { ISimulatorTransport, TransportEventMap } from '@tensnap/core';
import { SimulatorInfoPayloadSchema } from '@tensnap/protocol';
import type { SimulatorToRendererMessage, StateSyncRequest } from '@tensnap/protocol';
import { registerEventHandlers, unregisterEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, WebSocketManagerImpl } from '@/transport';
import { useSettingsStore } from './settings';
import { isInMemoryConnectionId, resolveTransport } from '@/transport/registry';
import type { StateSyncInventory } from './project';

const buildStateSyncPayload = (
  state: StateSyncInventory | undefined,
  requestId: string,
  modelId: string,
  instanceId?: string,
): StateSyncRequest => ({
  request_id: requestId,
  model_id: modelId,
  ...(instanceId === undefined ? {} : { instance_id: instanceId }),
  parameters: state?.parameters ?? [],
  actions: state?.actions ?? [],
  envs: state?.envs ?? [],
  charts: state?.charts ?? [],
  monitors: state?.monitors ?? [],
});

export interface TransportStore {
  id: string;
  transport: ISimulatorTransport | null;
  connectionId: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  isConnected: () => boolean;
  canReconnect: () => boolean;

  initialize: (transport: ISimulatorTransport | string, state?: StateSyncInventory) => Promise<void>;
  requestStateSync: (currentState?: StateSyncInventory) => void;
  disconnect: () => void;
  reconnect: (state?: StateSyncInventory) => Promise<void>;
  changeTransport: (
    transport: ISimulatorTransport | string,
    state?: StateSyncInventory,
    options?: { resetSimulatorIdentity?: boolean },
  ) => Promise<void>;
  destroy: () => void;
  abortConnection: () => void;
}

export const createTransportStore = (
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>,
) => create<TransportStore>((set, get) => {
  let pendingSimulatorInfoListener: EventListener | null = null;

  const removePendingSimulatorInfoListener = () => {
    if (!pendingSimulatorInfoListener) return;
    useScenarioStore.getState().session.removeEventListener('simulator:info', pendingSimulatorInfoListener);
    pendingSimulatorInfoListener = null;
  };

  const dispatchStateSync = (state?: StateSyncInventory) => {
    const requestId = generateUniqueId();
    const scenarioStore = useScenarioStore.getState();
    const simulatorInfo = scenarioStore.session.simulatorInfo;
    if (!simulatorInfo) return;
    const payload = buildStateSyncPayload(state, requestId, simulatorInfo.model.id, scenarioStore.session.stateSyncIdentity?.instance_id);

    scenarioStore.prepareStateSync(requestId, {
      autoLayoutOnComplete: scenarioStore.isMainViewAutoLayoutCandidate(),
    });
    scenarioStore.session.requestStateSync(requestId, payload);
  };

  const resolveTransportInput = (transportOrUrl: ISimulatorTransport | string): ISimulatorTransport => {
    if (typeof transportOrUrl !== 'string') return transportOrUrl;
    const resolved = resolveTransport(transportOrUrl);
    if (resolved) return resolved;
    if (isInMemoryConnectionId(transportOrUrl)) {
      throw new Error(`No built-in model is registered for ${transportOrUrl}.`);
    }
    return new WebSocketManagerImpl(null, transportOrUrl);
  };

  const configureTransportValidation = (transport: ISimulatorTransport) => {
    const { clientMessageValidation, serverMessageValidation } = useSettingsStore.getState();
    if (transport instanceof WebSocketManagerImpl) {
      transport.clientMessageValidation = clientMessageValidation;
      transport.serverMessageValidation = serverMessageValidation;
    }
  };

  const installConnectedTransport = (
    transport: ISimulatorTransport,
    state: StateSyncInventory | undefined,
    bufferedMessages: SimulatorToRendererMessage[],
    resetSimulatorIdentity: boolean,
    previousAbort: AbortController | null,
  ) => {
    const scenarioStore = useScenarioStore.getState();
    const { transport: currentTransport } = get();
    removePendingSimulatorInfoListener();
    previousAbort?.abort();
    scenarioStore.setConnected(false);
    if (currentTransport) {
      unregisterEventHandlers(currentTransport);
      currentTransport.destroy();
    }
    scenarioStore.resetStateSync();
    if (resetSimulatorIdentity) scenarioStore.session.resetSimulatorIdentity();

    const onOpen = () => {
      set({ isConnecting: false, connectionError: null, abortController: null });
      scenarioStore.setConnected(true);
    };
    const onClose = () => {
      scenarioStore.setConnected(false);
      scenarioStore.resetStateSync();
    };
    transport.on('open', onOpen);
    transport.on('close', onClose);
    registerEventHandlers(transport, useScenarioStore);

    const onSimulatorInfo: EventListener = () => {
      if (get().transport !== transport) return;
      removePendingSimulatorInfoListener();
      if (scenarioStore.session.identityStatus === 'model-mismatch') {
        set({ connectionError: 'The connected simulator model does not match this project.' });
        scenarioStore.resetStateSync();
        return;
      }
      try {
        dispatchStateSync(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ connectionError: message });
        scenarioStore.resetStateSync();
      }
    };
    pendingSimulatorInfoListener = onSimulatorInfo;
    scenarioStore.session.addEventListener('simulator:info', onSimulatorInfo);

    set({
      transport,
      connectionId: transport.connectionId,
      isConnecting: false,
      connectionError: null,
      abortController: null,
    });
    scenarioStore.setConnected(true);
    for (const message of bufferedMessages) scenarioStore.session.handleIncoming(message);
  };

  return ({
  id: generateUniqueId(),
  transport: null,
  connectionId: null,
  isConnecting: false,
  connectionError: null,
  abortController: null,

  isConnected: () => get().transport?.isConnected ?? false,
  canReconnect: () => {
    const { transport, connectionId } = get();
    return Boolean(transport && connectionId && transport.transportKind === 'websocket');
  },

  initialize: async (transportOrUrl: ISimulatorTransport | string, state?: StateSyncInventory) => {
    const { transport: currentTransport, abortController: currentAbort } = get();
    const scenarioStore = useScenarioStore.getState();

    removePendingSimulatorInfoListener();
    if (currentAbort) currentAbort.abort();
    scenarioStore.setConnected(false);
    if (currentTransport) {
      unregisterEventHandlers(currentTransport);
      currentTransport.destroy();
    }
    scenarioStore.resetStateSync();

    const abortController = new AbortController();
    const transport = resolveTransportInput(transportOrUrl);

    set({ connectionId: transport.connectionId, isConnecting: true, connectionError: null, abortController });

    configureTransportValidation(transport);

    const onOpen = () => {
      set({ isConnecting: false, connectionError: null, abortController: null });
      scenarioStore.setConnected(true);
    };

    const onClose = () => {
      scenarioStore.setConnected(false);
      scenarioStore.resetStateSync();
    };

    transport.on('open', onOpen);
    transport.on('close', onClose);
    registerEventHandlers(transport, useScenarioStore);
    const onSimulatorInfo: EventListener = () => {
      if (get().transport !== transport) return;
      removePendingSimulatorInfoListener();
      if (scenarioStore.session.identityStatus === 'model-mismatch') {
        set({ connectionError: 'The connected simulator model does not match this project.' });
        scenarioStore.resetStateSync();
        return;
      }
      try {
        dispatchStateSync(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ connectionError: message });
        scenarioStore.resetStateSync();
      }
    };
    pendingSimulatorInfoListener = onSimulatorInfo;
    scenarioStore.session.addEventListener('simulator:info', onSimulatorInfo);

    set({ transport, isConnecting: true, connectionError: null });

    try {
      await transport.connect(abortController.signal);
      if (abortController.signal.aborted) {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        removePendingSimulatorInfoListener();
        unregisterEventHandlers(transport);
        transport.destroy();
        set({ transport: null });
        scenarioStore.resetStateSync();
        throw new Error('Connection was aborted');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ isConnecting: false, connectionError: errorMessage, abortController: null });
      scenarioStore.setConnected(false);
      scenarioStore.resetStateSync();

      if (transport.transportKind === 'websocket' && error instanceof WebSocketConnectionError) {
        console.log('Initial connection failed, will auto-reconnect');
      } else {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        removePendingSimulatorInfoListener();
        unregisterEventHandlers(transport);
        transport.destroy();
        set({ transport: null });
        throw error;
      }
    }
  },

  requestStateSync: (currentState) => {
    const { transport } = get();
    if (!transport) {
      console.warn('Transport not connected');
      return;
    }
    dispatchStateSync(currentState);
  },

  disconnect: () => {
    const { transport, abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ abortController: null });
    }
    if (transport) {
      removePendingSimulatorInfoListener();
      unregisterEventHandlers(transport);
      transport.destroy();
      set({ transport: null });
      useScenarioStore.getState().setConnected(false);
      useScenarioStore.getState().resetStateSync();
    }
  },

  reconnect: async (state) => {
    if (!get().canReconnect()) return;

    const { transport, connectionId } = get();
    if (!transport || !connectionId) return;

    const nextTransport = new WebSocketManagerImpl(null, connectionId, transport.encoding === 'msgpack');

    await get().initialize(nextTransport, state);
  },

  changeTransport: async (transportOrUrl, state, options) => {
    if (typeof transportOrUrl === 'string' && get().connectionId === transportOrUrl) return;
    const transport = resolveTransportInput(transportOrUrl);
    configureTransportValidation(transport);
    const previousAbort = get().abortController;
    const abortController = new AbortController();
    const bufferedMessages: SimulatorToRendererMessage[] = [];
    let receivedSimulatorInfo = false;
    let resolveSimulatorInfo: (() => void) | null = null;
    const bufferMessage = (message: TransportEventMap['message']) => {
      const simulatorMessage = message as SimulatorToRendererMessage;
      bufferedMessages.push(simulatorMessage);
      if (simulatorMessage.type === 'simulator_info') {
        receivedSimulatorInfo = true;
        resolveSimulatorInfo?.();
      }
    };
    transport.on('message', bufferMessage);
    set({ isConnecting: true, connectionError: null, abortController });
    try {
      await transport.connect(abortController.signal);
      if (abortController.signal.aborted) throw new Error('Connection was aborted');
      if (!receivedSimulatorInfo) {
        await new Promise<void>((resolve, reject) => {
          resolveSimulatorInfo = resolve;
          const timeout = setTimeout(
            () => reject(new Error('The replacement simulator did not send simulator_info during handshake.')),
            10_000,
          );
          (timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
          const finish = () => {
            clearTimeout(timeout);
            abortController.signal.removeEventListener('abort', abort);
          };
          const abort = () => {
            finish();
            reject(new Error('Connection was aborted'));
          };
          abortController.signal.addEventListener('abort', abort, { once: true });
          resolveSimulatorInfo = () => {
            finish();
            resolve();
          };
        });
      }
      if (bufferedMessages[0]?.type !== 'simulator_info') {
        throw new Error('simulator_info must be the first replacement simulator message.');
      }
      SimulatorInfoPayloadSchema.parse(bufferedMessages[0].payload);
    } catch (error) {
      transport.off('message', bufferMessage);
      transport.destroy();
      set({
        isConnecting: false,
        connectionError: error instanceof Error ? error.message : String(error),
        abortController: previousAbort,
      });
      throw error;
    }
    transport.off('message', bufferMessage);
    installConnectedTransport(
      transport,
      state,
      bufferedMessages,
      options?.resetSimulatorIdentity ?? false,
      previousAbort,
    );
  },

  destroy: () => {
    const { transport, abortController } = get();
    removePendingSimulatorInfoListener();
    if (abortController) abortController.abort();
    if (transport) {
      unregisterEventHandlers(transport);
      transport.destroy();
    }
    set({
      transport: null,
      connectionId: null,
      isConnecting: false,
      connectionError: null,
      abortController: null,
    });
    useScenarioStore.getState().setConnected(false);
    useScenarioStore.getState().resetStateSync();
  },

  abortConnection: () => {
    const { abortController } = get();
    if (abortController) {
      removePendingSimulatorInfoListener();
      abortController.abort();
      set({ isConnecting: false, connectionError: 'Connection aborted by user', abortController: null });
      useScenarioStore.getState().resetStateSync();
    }
  },
  });
});

export const {
  Provider: TransportStoreProvider,
  useStore: useTransportStore,
} = createStoreContext<TransportStore>();
