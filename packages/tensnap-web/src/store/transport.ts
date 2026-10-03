import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { connectWithHandshake, type ISimulatorTransport, type TransportEventHandler, type TransportEventMap } from '@tensnap/core/transport';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';
import { registerEventHandlers, unregisterEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, WebSocketManagerImpl } from '@/transport';
import { useSettingsStore } from './settings';
import { isInMemoryConnectionId, resolveTransport } from '@/transport/registry';
import { createStateSyncInventoryFromSnapshot, type StateSyncInventory } from '@tensnap/core/scenario';

export interface TransportStore {
  transport: ISimulatorTransport | null;
  connectionId: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  isConnected: () => boolean;
  canReconnect: () => boolean;

  /** Open a project transport and keep WebSocket auto-reconnect available after an initial failure. */
  initialize: (transport: ISimulatorTransport | string, state?: StateSyncInventory) => Promise<void>;
  /** Request replacement state using the project inventory, or an empty inventory when omitted. */
  requestStateSync: (currentState?: StateSyncInventory) => void;
  reconnect: (state?: StateSyncInventory) => Promise<void>;
  /** Validate a candidate connection before replacing the active project transport. */
  changeTransport: (
    transport: ISimulatorTransport | string,
    state?: StateSyncInventory,
    options?: { resetSimulatorIdentity?: boolean },
  ) => Promise<void>;
  destroy: () => void;
}

export const createTransportStore = (
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>,
) => create<TransportStore>((set, get) => {
  let removePendingHandshakeListeners: (() => void) | null = null;
  let unsubscribeValidationSettings: (() => void) | null = null;

  const stopWaitingForHandshake = () => {
    removePendingHandshakeListeners?.();
    removePendingHandshakeListeners = null;
  };

  const dispatchStateSync = (state?: StateSyncInventory) => {
    const requestId = generateUniqueId();
    const scenarioStore = useScenarioStore.getState();
    if (!scenarioStore.session.simulatorInfo && !scenarioStore.session.isLegacyProtocol) return;

    scenarioStore.prepareStateSync(requestId, {
      autoLayoutOnComplete: scenarioStore.isMainViewAutoLayoutCandidate(),
    });
    scenarioStore.session.requestStateSync(requestId, state ?? createStateSyncInventoryFromSnapshot());
  };

  const reportConnectionDiagnostic = (
    severity: 'warning' | 'error',
    code: string,
    message: string,
    details?: unknown,
  ) => {
    useScenarioStore.getState().appendDiagnostic({
      severity,
      domain: 'transport',
      source: 'transport-store',
      code,
      message,
      ...(details === undefined ? {} : { details }),
    });
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

  const watchTransportValidation = (transport: ISimulatorTransport) => {
    unsubscribeValidationSettings?.();
    unsubscribeValidationSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.clientMessageValidation === previous.clientMessageValidation
        && state.serverMessageValidation === previous.serverMessageValidation) return;
      if (get().transport === transport) configureTransportValidation(transport);
    });
  };

  const stopWatchingTransportValidation = () => {
    unsubscribeValidationSettings?.();
    unsubscribeValidationSettings = null;
  };

  const retireTransport = (abortController?: AbortController | null) => {
    stopWatchingTransportValidation();
    stopWaitingForHandshake();
    abortController?.abort();
    const scenarioStore = useScenarioStore.getState();
    scenarioStore.setConnected(false);
    const active = get().transport;
    if (active) {
      unregisterEventHandlers(active);
      active.destroy();
    }
    scenarioStore.resetStateSync();
  };

  const activateTransport = (transport: ISimulatorTransport, state?: StateSyncInventory) => {
    const scenarioStore = useScenarioStore.getState();
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

    const onSimulatorReady = () => {
      if (get().transport !== transport) return;
      stopWaitingForHandshake();
      if (scenarioStore.session.identityStatus === 'model-mismatch') {
        const message = scenarioStore.session.isLegacyProtocol
          ? 'The connected legacy simulator cannot be verified against this project.'
          : 'The connected simulator model does not match this project.';
        set({ connectionError: message });
        scenarioStore.setConnected(false);
        reportConnectionDiagnostic('error', 'model_mismatch', message, scenarioStore.session.simulatorInfo);
        scenarioStore.resetStateSync();
        return;
      }
      try {
        dispatchStateSync(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({ connectionError: message });
        reportConnectionDiagnostic('error', 'state_sync_failed', message, error);
        scenarioStore.resetStateSync();
      }
    };
    const onSimulatorInfo: EventListener = onSimulatorReady;
    scenarioStore.session.addEventListener('simulator:info', onSimulatorInfo);
    const onProtocolMode: TransportEventHandler<TransportEventMap['protocol-mode']> = (detail) => {
      if (detail.mode !== 'legacy') return;
      scenarioStore.session.beginLegacyProtocol();
      onSimulatorReady();
    };
    transport.on('protocol-mode', onProtocolMode);
    removePendingHandshakeListeners = () => {
      scenarioStore.session.removeEventListener('simulator:info', onSimulatorInfo);
      transport.off('protocol-mode', onProtocolMode);
    };
    watchTransportValidation(transport);
    return { onOpen, onClose, onSimulatorReady };
  };

  const installConnectedTransport = (
    transport: ISimulatorTransport,
    state: StateSyncInventory | undefined,
    bufferedMessages: SimulatorToRendererMessage[],
    resetSimulatorIdentity: boolean,
    previousAbort: AbortController | null,
    protocolMode: 'strict' | 'legacy' | null,
  ) => {
    const scenarioStore = useScenarioStore.getState();
    retireTransport(previousAbort);
    if (resetSimulatorIdentity) scenarioStore.session.resetSimulatorIdentity();

    set({
      transport,
      connectionId: transport.connectionId,
      isConnecting: false,
      connectionError: null,
      abortController: null,
    });
    const { onSimulatorReady } = activateTransport(transport, state);
    scenarioStore.setConnected(true);
    if (protocolMode === 'legacy') {
      scenarioStore.session.beginLegacyProtocol();
      onSimulatorReady();
    }
    for (const message of bufferedMessages) scenarioStore.session.handleIncoming(message);
  };

  return ({
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
    const { abortController: currentAbort } = get();
    const scenarioStore = useScenarioStore.getState();

    retireTransport(currentAbort);

    const abortController = new AbortController();
    const transport = resolveTransportInput(transportOrUrl);

    set({ connectionId: transport.connectionId, isConnecting: true, connectionError: null, abortController });

    configureTransportValidation(transport);

    set({ transport, isConnecting: true, connectionError: null });
    const { onOpen, onClose } = activateTransport(transport, state);

    try {
      await transport.connect(abortController.signal);
      if (abortController.signal.aborted) {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        stopWaitingForHandshake();
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
        reportConnectionDiagnostic('warning', 'initial_connection_failed', 'Initial connection failed; automatic reconnect remains enabled.', error);
      } else {
        transport.off('open', onOpen);
        transport.off('close', onClose);
        stopWaitingForHandshake();
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
      reportConnectionDiagnostic('warning', 'state_sync_while_disconnected', 'Cannot synchronize state without a connected transport.');
      return;
    }
    dispatchStateSync(currentState);
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
    set({ isConnecting: true, connectionError: null, abortController });
    let handshake;
    try {
      handshake = await connectWithHandshake(transport, abortController.signal);
    } catch (error) {
      transport.destroy();
      set({
        isConnecting: false,
        connectionError: error instanceof Error ? error.message : String(error),
        abortController: previousAbort,
      });
      throw error;
    }
    const bufferedMessages = handshake.takeBufferedMessages();
    installConnectedTransport(
      transport,
      state,
      bufferedMessages,
      options?.resetSimulatorIdentity ?? false,
      previousAbort,
      handshake.mode,
    );
  },

  destroy: () => {
    retireTransport(get().abortController);
    set({
      transport: null,
      connectionId: null,
      isConnecting: false,
      connectionError: null,
      abortController: null,
    });
  },
  });
});

export const {
  Provider: TransportStoreProvider,
  useStore: useTransportStore,
} = createStoreContext<TransportStore>();
