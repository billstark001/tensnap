import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { StateSyncRequest, ISimulatorTransport, RendererToSimulatorMessage } from '@tensnap/core';
import { registerEventHandlers, unregisterEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, WebSocketManagerImpl } from '@/transport';
import { useSettingsStore } from './settings';
import { resolveTransport } from '@/transport/registry';

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
) => create<TransportStore>((set, get) => ({
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
      if (!state || ((state.parameters.length + state.actions.length + state.envs.length + state.charts.length) === 0)) {
        transport.send(useScenarioStore.getState().createStateSyncMessage());
      }
    };

    const onClose = () => {
      useScenarioStore.getState().setConnected(false);
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
        throw new Error('Connection was aborted');
      }
      if (state && (state.parameters.length + state.actions.length + state.envs.length + state.charts.length) > 0) {
        transport.send({ type: 'state_sync', payload: state });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ isConnecting: false, connectionError: errorMessage, abortController: null });
      useScenarioStore.getState().setConnected(false);

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
    const { sendMessage } = get();
    sendMessage({ type: 'state_sync', payload: currentState ?? { parameters: [], actions: [], envs: [], charts: [] } });
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
  },

  abortConnection: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isConnecting: false, connectionError: 'Connection aborted by user', abortController: null });
    }
  },
}));

export const {
  Provider: TransportStoreProvider,
  useStore: useTransportStore,
} = createStoreContext<TransportStore>();
