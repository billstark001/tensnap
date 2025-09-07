import { create, StoreApi, UseBoundStore } from 'zustand';
import { WebSocketConnectionError, WebSocketManager } from '../utils/websocket-manager';
import { ScenarioStore } from './scenario';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { StateSyncRequest, WSMessage } from '@/types/api';
import { registerEventHandlers } from './websocket-scenario';

export interface WebSocketStore {
  id: string;
  wsManager: WebSocketManager | null;
  url: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  // Actions
  initialize: (url: string) => Promise<void>;
  sendMessage: <T = any>(message: WSMessage<T>) => void;
  requestState: () => void;
  requestStateSync: (currentState: StateSyncRequest) => void;  // 统一的状态同步请求
  disconnect: () => void;
  reconnect: () => Promise<void>;
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

  initialize: async (url: string) => {
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

    const wsManager = new WebSocketManager(null, url);

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
      const emptyState: StateSyncRequest = {
        parameters: [],
        environments: [],
        charts: [],
        parameter_cache: {}
      };
      wsManager.send({ type: 'state_sync', payload: emptyState });
    };

    wsManager.on(WebSocketManager.Connected, onConnected);

    wsManager.on(WebSocketManager.Disconnected, () => {
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

  requestState: () => {
    const { sendMessage } = get();
    // 发送空的客户端状态以获取完整状态
    const emptyState: StateSyncRequest = {
      parameters: [],
      environments: [],
      charts: [],
      parameter_cache: {}
    };
    sendMessage<StateSyncRequest>({ type: 'state_sync', payload: emptyState });
  },

  requestStateSync: (currentState: StateSyncRequest) => {
    const { sendMessage } = get();
    sendMessage<StateSyncRequest>({ type: 'state_sync', payload: currentState });
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

  reconnect: async () => {
    const { url } = get();
    if (url) {
      await get().initialize(url);
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
