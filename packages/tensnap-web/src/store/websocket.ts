import { create, StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './scenario/store';
import { generateUniqueId } from '@/utils/common';
import { createStoreContext } from '@/utils/zustand';
import { StateSyncRequest, WSMessage } from '@/types/api';
import { registerEventHandlers, unregisterEventHandlers } from './scenario/scenario-ws';
import { WebSocketConnectionError, wsConnected, wsDisconnected, WebSocketManagerImpl, WebSocketManager, WebSocketManagerFake } from '@/websocket';
import { useSettingsStore } from './settings';


const createEmptyStateSyncRequest = (): StateSyncRequest => ({
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
});

export interface WebSocketStore {
  id: string;
  wsManager: WebSocketManager | null;
  url: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;

  // Computed
  isConnected: () => boolean;

  // Actions
  initialize: (url: string, state?: StateSyncRequest) => Promise<void>;
  sendMessage: <T = any>(message: WSMessage<T>) => void;
  requestStateSync: (currentState?: StateSyncRequest) => void;
  disconnect: () => void;
  reconnect: (state?: StateSyncRequest) => Promise<void>;
  changeUrl: (newUrl: string, state?: StateSyncRequest) => Promise<void>;
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

  isConnected: () => {
    const { wsManager } = get();
    return wsManager?.isConnected ?? false;
  },

  initialize: async (url: string, state?: StateSyncRequest) => {
    const { wsManager: currentManager, abortController: currentAbort } = get();

    // 中断当前正在进行的连接
    if (currentAbort) {
      currentAbort.abort();
    }

    // 如果已经有连接，先断开并清理
    if (currentManager) {
      unregisterEventHandlers(currentManager);
      currentManager.destroy();
    }

    // 创建新的 AbortController 用于这次连接
    const abortController = new AbortController();
    set({ url, isConnecting: true, connectionError: null, abortController });

    const wsManager: WebSocketManager = url.startsWith(WebSocketManagerFake.WEBSOCKET_FAKE_PROTOCOL)
      ? WebSocketManagerFake.createFromGlobalOptions(null, url)
      : new WebSocketManagerImpl(null, url);

    // Apply validation settings
    const { clientMessageValidation, serverMessageValidation } = useSettingsStore.getState();
    if (wsManager instanceof WebSocketManagerImpl) {
      wsManager.clientMessageValidation = clientMessageValidation;
      wsManager.serverMessageValidation = serverMessageValidation;
    }

    const onConnected = () => {
      set({
        isConnecting: false,
        connectionError: null,
        abortController: null // 连接成功后清理 AbortController
      });
      useScenarioStore.getState().setConnected(true);
      const stateCount = (state?.envs.length ?? 0)
        + (state?.parameters.length ?? 0)
        + (state?.charts.length ?? 0);
      if (stateCount == 0) {
        // 如果没有提供状态，则请求完整同步
        wsManager.send({ type: 'state_sync', payload: createEmptyStateSyncRequest() });
      }
    };

    const onDisconnected = () => {
      useScenarioStore.getState().setConnected(false);
    };

    wsManager.on(wsConnected, onConnected);
    wsManager.on(wsDisconnected, onDisconnected);

    // 设置消息处理器
    registerEventHandlers(wsManager, useScenarioStore);

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
        // Clean up all event handlers including wsConnected and wsDisconnected
        wsManager.off(wsConnected, onConnected);
        wsManager.off(wsDisconnected, onDisconnected);
        unregisterEventHandlers(wsManager);
        wsManager.destroy();
        set({ wsManager: null });
        throw new Error('Connection was aborted');
      }
      // onConnected will be called by the wsManager

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({
        isConnecting: false,
        connectionError: errorMessage,
        abortController: null
      });
      useScenarioStore.getState().setConnected(false);

      // 对于连接错误，保留 wsManager 以允许自动重连
      // 对于其他错误（如中止），清理所有资源
      if (error instanceof WebSocketConnectionError) {
        // WebSocketConnectionError 表示初始连接失败，但 wsManager 会自动重连
        // 保留 wsManager，不清理
        console.log(`${wsManager.id}: Initial connection failed, will auto-reconnect`);
      } else {
        // 其他错误，清理资源并抛出
        wsManager.off(wsConnected, onConnected);
        wsManager.off(wsDisconnected, onDisconnected);
        unregisterEventHandlers(wsManager);
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
      unregisterEventHandlers(wsManager);
      wsManager.destroy();
      set({ wsManager: null });
      useScenarioStore.getState().setConnected(false);
    }
  },

  reconnect: async (state?: StateSyncRequest) => {
    const { url } = get();
    if (!url) return;

    // 如果没有提供状态，尝试从当前 scenario store 获取
    let currentState = state;
    if (!currentState) {
      const scenarioState = useScenarioStore.getState().dump();
      const { parameters = [], actions = [], environments = [], charts = [] } = scenarioState;
      currentState = {
        parameters,
        actions,
        envs: environments.map(env => ({ id: env.id, type: env.type, layers: [] })),
        charts: charts.flatMap(group => Object.values(group.metadataDict)),
      };
    }
    await get().initialize(url, currentState);
  },

  /**
   * 更改 WebSocket URL 并重新连接
   */
  changeUrl: async (newUrl: string, state?: StateSyncRequest) => {
    const { url: currentUrl } = get();
    if (currentUrl === newUrl) return;

    // 断开当前连接
    get().disconnect();

    // 使用新 URL 初始化连接
    await get().initialize(newUrl, state);
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
      unregisterEventHandlers(wsManager);
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
