import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { StateSyncRequest, WSMessage } from '@/types/api';
import { registerEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, wsConnected, wsDisconnected, WebSocketManagerImpl, WebSocketManager, WebSocketManagerFake } from '@/websocket';


const createEmptyStateSyncRequest = (): StateSyncRequest => ({
  parameters: [],
  environments: [],
  charts: [],
});

export interface WebSocketStore {
  id: string;
  wsManager: WebSocketManager | null;
  url: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  // Actions
  initialize: (url: string, state?: StateSyncRequest) => Promise<void>;
  sendMessage: <T = any>(message: WSMessage<T>) => void;
  requestStateSync: (currentState?: StateSyncRequest) => void;
  disconnect: () => void;
  reconnect: (state?: StateSyncRequest) => Promise<void>;
  destroy: () => void;
  abortConnection: () => void;
}

export const createWebSocketStore = (
  useScenarioStore: UseBoundStore<StoreApi<ScenarioStore>>
) => create<WebSocketStore>((set, get) => ({
  id: generateUniqueId(),
  wsManager: null,
  url: null,
  isConnecting: false,
  connectionError: null,
  abortController: null,

  initialize: async (url: string, state?: StateSyncRequest) => {
    const { wsManager: currentManager, abortController: currentAbort } = get();

    // 中断当前正在进行的连接
    if (currentAbort) {
      currentAbort.abort();
    }

    // 如果已经有连接，先断开
    if (currentManager) {
      currentManager.disconnect();
    }

    // 创建新的 AbortController 用于这次连接
    const abortController = new AbortController();
    set({ url, isConnecting: true, connectionError: null, abortController });

    const wsManager: WebSocketManager = url.startsWith(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL)
      ? WebSocketManagerFake.createFromGlobalOptions(null, url)
      : new WebSocketManagerImpl(null, url)

    // 设置消息处理器
    registerEventHandlers(wsManager, useScenarioStore);

    const onConnected = () => {
      set({
        isConnecting: false,
        connectionError: null,
        abortController: null // 连接成功后清理 AbortController
      });
      // 设置连接状态并请求初始状态
      useScenarioStore.getState().setConnected(true);
      wsManager.send({ type: 'state_sync', payload: state ?? createEmptyStateSyncRequest()});
    };

    wsManager.on(wsConnected, onConnected);

    wsManager.on(wsDisconnected, () => {
      useScenarioStore.getState().setConnected(false);
    });

    set({
      wsManager,
      isConnecting: true,
      connectionError: null,
    });

    try {
      // 连接 WebSocket，传入 AbortController 的信号
      await wsManager.connect(abortController.signal);
      // 检查在连接过程中是否被中断
      if (abortController.signal.aborted) {
        wsManager.destroy();
        throw new Error('Connection was aborted');
      }
      onConnected();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({
        isConnecting: false,
        connectionError: errorMessage,
        abortController: null
      });
      useScenarioStore.getState().setConnected(false);
      if (!(error instanceof WebSocketConnectionError)) {
        wsManager.destroy();
        set({ wsManager: null });
        throw error;
      }
    }
  },

  sendMessage: <T>(message: WSMessage<T>) => {
    const { wsManager } = get();
    if (wsManager) {
      wsManager.send(message);
    } else {
      console.warn('WebSocket not connected');
    }
  },

  requestStateSync: (currentState?: StateSyncRequest) => {
    const { sendMessage } = get();
    sendMessage<StateSyncRequest>({ type: 'state_sync', payload: currentState ?? createEmptyStateSyncRequest() });
  },

  disconnect: () => {
    const { wsManager, abortController } = get();

    // 中断正在进行的连接
    if (abortController) {
      abortController.abort();
      set({ abortController: null });
    }

    if (wsManager) {
      wsManager.destroy();
      set({ wsManager: null });
      useScenarioStore.getState().setConnected(false);
    }
  },

  reconnect: async (state?: StateSyncRequest) => {
    const { url } = get();
    if (url) {
      await get().initialize(url, state);
    }
  },

  /**
   * 销毁 WebSocket store，清理所有资源
   */
  destroy: () => {
    const { wsManager, abortController } = get();

    // 中断正在进行的连接
    if (abortController) {
      abortController.abort();
    }

    // 销毁 WebSocket 管理器
    if (wsManager) {
      wsManager.destroy();
    }

    // 重置所有状态
    set({
      wsManager: null,
      url: null,
      isConnecting: false,
      connectionError: null,
      abortController: null,
    });

    useScenarioStore.getState().setConnected(false);
  },

  /**
   * 中断当前的连接过程
   */
  abortConnection: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({
        isConnecting: false,
        connectionError: 'Connection aborted by user',
        abortController: null
      });
    }
  },
}));

export const {
  Provider: WebSocketStoreProvider,
  useStore: useWebSocketStore,
} = createStoreContext<WebSocketStore>();
