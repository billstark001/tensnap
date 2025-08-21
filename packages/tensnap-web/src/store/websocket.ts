import { create } from 'zustand';
import { WebSocketManager } from '../utils/websocket-manager';
import { useScenarioStore } from './scenario';
import { GridEnvironment, WSMessage } from '../types';
import { generateUniqueId } from '@/components/view/utils/common';

interface WebSocketStore {
  id: string;
  wsManager: WebSocketManager | null;
  url: string | null;
  isConnecting: boolean;
  connectionError: string | null;
  abortController: AbortController | null;
  
  // Actions
  initialize: (url: string) => Promise<void>;
  sendMessage: (message: WSMessage) => void;
  requestState: () => void;
  disconnect: () => void;
  reconnect: () => Promise<void>;
  destroy: () => void;
  abortConnection: () => void;
}

export const useWebSocketStore = create<WebSocketStore>((set, get) => ({
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

    try {
      const wsManager = new WebSocketManager(null, url);
      const store = useScenarioStore.getState();

      // 设置消息处理器
      wsManager.on('time_step_start', (payload) => {
        store.setCurrentTime(payload.time);
      });

      wsManager.on('time_step_end', (payload) => {
        // 创建快照
        const snapshot = {
          id: `snapshot-${Date.now()}`,
          timestamp: Date.now(),
          timeStep: payload.time,
          environments: store.environments,
          parameters: store.parameters,
        };
        store.addSnapshot(snapshot);
      });

      wsManager.on('environment_update', (payload) => {
        store.updateEnvironment(payload.id, payload.data);
      });

      wsManager.on('agent_update', (payload) => {
        store.updateEnvironment(
          payload.environment_id,
          env => ({
            ...env,
            agents: (env as GridEnvironment).agents.map(agent =>
              agent.id === payload.agent_id
                ? { ...agent, ...payload.data }
                : agent
            ),
          }),
        );
      });

      wsManager.on('agent_batch_update', (payload) => {
        const updateMap: Record<string, any> = Object.fromEntries(
          payload.updates.map((a: any) => [a.id, a.data]),
        );

        store.updateEnvironment(
          payload.environment_id,
          env => ({
            ...env,
            agents: (env as GridEnvironment).agents.map(agent =>
              agent.id in updateMap
                ? { ...agent, ...updateMap[agent.id] }
                : agent
            ),
          }),
        );
      });

      wsManager.on('parameters', (payload) => {
        store.setParameters(payload);
      });

      wsManager.on('environments_list', (payload) => {
        store.setEnvironments(payload);
      });

      wsManager.on('chart_data', (payload) => {
        payload.forEach((chartUpdate: any) => {
          store.addChartData(chartUpdate.id, chartUpdate.time, chartUpdate.value);
        });
      });

      // 连接 WebSocket，传入 AbortController 的信号
      await wsManager.connect(abortController.signal);
      // 检查在连接过程中是否被中断
      if (abortController.signal.aborted) {
        wsManager.destroy();
        throw new Error('Connection was aborted');
      }

      set({ 
        wsManager,
        isConnecting: false, 
        connectionError: null,
        abortController: null // 连接成功后清理 AbortController
      });

      // 设置连接状态并请求初始状态
      store.setConnected(true);
      wsManager.send({ type: 'get_state', payload: {} });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Connection failed';
      set({ 
        isConnecting: false, 
        connectionError: errorMessage,
        wsManager: null,
        abortController: null
      });
      useScenarioStore.getState().setConnected(false);
      throw error;
    }
  },

  sendMessage: (message: WSMessage) => {
    const { wsManager } = get();
    if (wsManager) {
      wsManager.send(message);
    } else {
      console.warn('WebSocket not connected');
    }
  },

  requestState: () => {
    const { sendMessage } = get();
    sendMessage({ type: 'get_state', payload: {} });
  },

  disconnect: () => {
    const { wsManager, abortController } = get();
    
    // 中断正在进行的连接
    if (abortController) {
      abortController.abort();
    }
    
    if (wsManager) {
      wsManager.disconnect();
      set({ wsManager: null, abortController: null });
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
