import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { WebSocketManager } from '../utils/websocket-manager';
import { useScenarioStore } from '../store/scenario';
import { GridEnvironment, WSMessage } from '../types';

interface WebSocketContextType {
  wsManager: WebSocketManager | null;
  sendMessage: (message: WSMessage) => void;
  requestState: () => void;
}

const WebSocketContext = createContext<WebSocketContextType | undefined>(undefined);

interface WebSocketProviderProps {
  url: string;
  children: React.ReactNode;
}

export function WebSocketProvider({ url, children }: WebSocketProviderProps) {
  const wsManager = useRef<WebSocketManager | null>(null);
  const store = useScenarioStore();

  useEffect(() => {
    wsManager.current = new WebSocketManager(url);

    // Set up message handlers
    wsManager.current.on('time_step_start', (payload) => {
      store.setCurrentTime(payload.time);
    });

    wsManager.current.on('time_step_end', (payload) => {
      // Could trigger snapshot save here
      const snapshot = {
        id: `snapshot-${Date.now()}`,
        timestamp: Date.now(),
        timeStep: payload.time,
        environments: store.environments,
        parameters: store.parameters,
      };
      store.addSnapshot(snapshot);
    });

    wsManager.current.on('environment_update', (payload) => {
      store.updateEnvironment(payload.id, payload.data);
    });

    wsManager.current.on('agent_update', (payload) => {

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

    wsManager.current.on('agent_batch_update', (payload) => {

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

    wsManager.current.on('parameters', (payload) => {
      store.setParameters(payload);
    });

    wsManager.current.on('environments_list', (payload) => {
      store.setEnvironments(payload);
    });

    wsManager.current.on('chart_data', (payload) => {
      payload.forEach((chartUpdate: any) => {
        store.addChartData(chartUpdate.id, chartUpdate.time, chartUpdate.value);
      });
    });

    // Connect
    wsManager.current.connect()
      .then(() => {
        store.setConnected(true);
        // Request initial state
        if (wsManager.current) {
          wsManager.current.send({ type: 'get_state', payload: {} });
        }
      })
      .catch(console.error);

    return () => {
      wsManager.current?.disconnect();
      store.setConnected(false);
    };
  }, [url]);

  const sendMessage = useCallback((message: WSMessage) => {
    wsManager.current?.send(message);
  }, []);

  const requestState = useCallback(() => {
    sendMessage({ type: 'get_state', payload: {} });
  }, [sendMessage]);

  return (
    <WebSocketContext.Provider
      value={{
        wsManager: wsManager.current,
        sendMessage,
        requestState,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}