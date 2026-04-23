import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { StateSyncRequest, ISimulatorTransport, RendererToSimulatorMessage } from '@tensnap/core';
import { registerEventHandlers, unregisterEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, WebSocketManagerImpl } from '@/transport';
import { useSettingsStore } from './settings';
import { resolveTransport } from '@/transport/registry';

const getStateSyncItemCount = (state?: StateSyncRequest) => (
  (state?.parameters.length ?? 0)
  + (state?.actions.length ?? 0)
  + (state?.envs.length ?? 0)
  + (state?.charts.length ?? 0)
);

const buildStateSyncPayload = (state: StateSyncRequest | undefined, requestId: string): StateSyncRequest => ({
  request_id: requestId,
  parameters: state?.parameters ?? [],
  actions: state?.actions ?? [],
  envs: state?.envs ?? [],
  charts: state?.charts ?? [],
});

export interface TransportStore {
  id: string;
  transport: ISimulatorTransport | null;
  connectionId: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  isConnected: () => boolean;

  initialize: (transport: ISimulatorTransport | string, state?: StateSyncRequest) => Promise<void>;
  sendMessage: (message: RendererToSimulatorMessage) => void;
  requestStateSync: (currentState?: StateSyncRequest) => void;
  disconnect: () => void;
  reconnect: (state?: StateSyncRequest) => Promise<void>;
  changeTransport: (transport: ISimulatorTransport | string, state?: StateSyncRequest) => Promise<void>;
  destroy: () => void;
  abortConnection: () => void;
}

export const createTransportStore = (
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>,
) => create<TransportStore>((set, get) => {
  const dispatchStateSync = (transport: ISimulatorTransport, state?: StateSyncRequest) => {
    const requestId = generateUniqueId();
    const scenarioStore = useScenarioStore.getState();
    const payload = buildStateSyncPayload(
      state ?? scenarioStore.createStateSyncMessage(requestId).payload,
      requestId,
    );

    scenarioStore.prepareStateSync(requestId, {
      autoLayoutOnComplete: scenarioStore.isMainViewAutoLayoutCandidate(),
    });
    transport.send({ type: 'state_sync', payload });

    if (transport.transportKind === 'inmemory') {
      setTimeout(() => {
        useScenarioStore.getState().handleStateSyncBoundary('end', { request_id: requestId });
      }, 0);
    }
  };

  return ({
  id: generateUniqueId(),
  transport: null,
  connectionId: null,
  isConnecting: false,
  connectionError: null,
  abortController: null,

  isConnected: () => get().transport?.isConnected ?? false,

  initialize: async (transportOrUrl: ISimulatorTransport | string, state?: StateSyncRequest) => {
    const { transport: currentTransport, abortController: currentAbort } = get();

    if (currentAbort) currentAbort.abort();
    if (currentTransport) {
      unregisterEventHandlers(currentTransport);
      currentTransport.destroy();
    }
    useScenarioStore.getState().resetStateSync();

    const abortController = new AbortController();
    const transport = typeof transportOrUrl === 'string'
      ? (resolveTransport(transportOrUrl) ?? new WebSocketManagerImpl(null, transportOrUrl))
      : transportOrUrl;

    set({ connectionId: transport.connectionId, isConnecting: true, connectionError: null, abortController });

    const { clientMessageValidation, serverMessageValidation } = useSettingsStore.getState();
    if (transport instanceof WebSocketManagerImpl) {
      transport.clientMessageValidation = clientMessageValidation;
      transport.serverMessageValidation = serverMessageValidation;
    }

    const onOpen = () => {
      set({ isConnecting: false, connectionError: null, abortController: null });
      useScenarioStore.getState().setConnected(true);
      const isEmptyState = !state || getStateSyncItemCount(state) === 0;
      if (isEmptyState) {
        dispatchStateSync(transport);
      }
    };

    const onClose = () => {
      useScenarioStore.getState().setConnected(false);
      useScenarioStore.getState().resetStateSync();
    };

    transport.on('open', onOpen);
    transport.on('close', onClose);
    registerEventHandlers(transport, useScenarioStore);

    set({ transport, isConnecting: true, connectionError: null });

    try {
      await transport.connect(abortController.signal);
      if (abortController.signal.aborted) {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        unregisterEventHandlers(transport);
        transport.destroy();
        set({ transport: null });
        useScenarioStore.getState().resetStateSync();
        throw new Error('Connection was aborted');
      }
      if (state && getStateSyncItemCount(state) > 0) {
        dispatchStateSync(transport, state);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ isConnecting: false, connectionError: errorMessage, abortController: null });
      useScenarioStore.getState().setConnected(false);
      useScenarioStore.getState().resetStateSync();

      if (transport.transportKind === 'websocket' && error instanceof WebSocketConnectionError) {
        console.log('Initial connection failed, will auto-reconnect');
      } else {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        unregisterEventHandlers(transport);
        transport.destroy();
        set({ transport: null });
        throw error;
      }
    }
  },

  sendMessage: (message) => {
    const { transport } = get();
    if (transport) {
      transport.send(message);
    } else {
      console.warn('Transport not connected');
    }
  },

  requestStateSync: (currentState) => {
    const { transport } = get();
    if (!transport) {
      console.warn('Transport not connected');
      return;
    }
    dispatchStateSync(transport, currentState);
  },

  disconnect: () => {
    const { transport, abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ abortController: null });
    }
    if (transport) {
      unregisterEventHandlers(transport);
      transport.destroy();
      set({ transport: null });
      useScenarioStore.getState().setConnected(false);
      useScenarioStore.getState().resetStateSync();
    }
  },

  reconnect: async (state) => {
    const { transport, connectionId } = get();
    if (!transport || !connectionId) return;

    const nextTransport = transport.transportKind === 'websocket'
      ? new WebSocketManagerImpl(null, connectionId, transport.encoding === 'msgpack')
      : transport;

    await get().initialize(nextTransport, state ?? useScenarioStore.getState().createStateSyncMessage().payload);
  },

  changeTransport: async (transportOrUrl, state) => {
    if (typeof transportOrUrl === 'string' && get().connectionId === transportOrUrl) return;
    get().disconnect();
    await get().initialize(transportOrUrl, state);
  },

  destroy: () => {
    const { transport, abortController } = get();
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
