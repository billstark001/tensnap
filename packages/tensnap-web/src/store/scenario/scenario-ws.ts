import { WebSocketManager } from "@/websocket";
import { ScenarioStore } from "./store";
import {
  MetadataUpdatePayload,
  ActionEndPayload,
  ActionCUPayload,
  ActionDeletePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerUpdatePayload,
  EnvLayerDeletePayload,
  AgentCreatePayload,
  AgentUpdatePayload,
  AgentDeletePayload,
  EdgeCreatePayload,
  EdgeUpdatePayload,
  EdgeDeletePayload,
  ParameterCUPayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  ChartCreatePayload,
  ChartUpdatePayload,
  ChartDeletePayload,
  LogPayload,
  ErrorPayload,
} from "@/types/api";
import { StoreApi, UseBoundStore } from "zustand";
import { getToastState } from "../toast";

/**
 * Cleanup function to remove all event handlers
 */
export function unregisterEventHandlers(wsManager: WebSocketManager) {
  wsManager.off('metadata_update');
  wsManager.off('action_end');
  wsManager.off('action_create');
  wsManager.off('action_update');
  wsManager.off('action_delete');
  wsManager.off('env_create');
  wsManager.off('env_delete');
  wsManager.off('env_layer_create');
  wsManager.off('env_layer_update');
  wsManager.off('env_layer_delete');
  wsManager.off('agent_create');
  wsManager.off('agent_update');
  wsManager.off('agent_delete');
  wsManager.off('edge_create');
  wsManager.off('edge_update');
  wsManager.off('edge_delete');
  wsManager.off('parameter_create');
  wsManager.off('parameter_update');
  wsManager.off('parameter_delete');
  wsManager.off('parameter_sync');
  wsManager.off('chart_create');
  wsManager.off('chart_update');
  wsManager.off('chart_delete');
  wsManager.off('log');
  wsManager.off('error');
}

export function registerEventHandlers(
  wsManager: WebSocketManager,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  // Clear any existing handlers first to prevent duplicates
  unregisterEventHandlers(wsManager);

  // -- Metadata --
  wsManager.on('metadata_update', (payload: MetadataUpdatePayload) => {
    if (payload.time !== undefined) {
      useStore.getState().setCurrentTime(payload.time);
    }
  });

  // -- Actions --
  wsManager.on('action_end', (payload: ActionEndPayload) => {
    useStore.getState().handleActionEnd(payload.id, payload.continue);
  });

  wsManager.on('action_create', (payload: ActionCUPayload) => {
    useStore.getState().upsertAction(payload);
  });

  wsManager.on('action_update', (payload: ActionCUPayload) => {
    useStore.getState().upsertAction(payload);
  });

  wsManager.on('action_delete', (payload: ActionDeletePayload) => {
    useStore.getState().deleteAction(payload.id);
  });

  // -- Environments --
  wsManager.on('env_create', (payload: EnvCreatePayload) => {
    useStore.getState().createEnv(payload.id, payload.type);
  });

  wsManager.on('env_delete', (payload: EnvDeletePayload) => {
    useStore.getState().deleteEnv(payload.id);
  });

  // -- Layers --
  wsManager.on('env_layer_create', (payload: EnvLayerCreatePayload) => {
    const { env_id, layer_id, layer_type, data } = payload;
    useStore.getState().createEnvLayer(env_id, layer_id, layer_type, data);
  });

  wsManager.on('env_layer_update', (payload: EnvLayerUpdatePayload) => {
    const { env_id, layer_id, data } = payload;
    useStore.getState().updateEnvLayer(env_id, layer_id, data);
  });

  wsManager.on('env_layer_delete', (payload: EnvLayerDeletePayload) => {
    useStore.getState().deleteEnvLayer(payload.env_id, payload.layer_id);
  });

  // -- Agents --
  wsManager.on('agent_create', (payload: AgentCreatePayload) => {
    const { env_id, layer_id, agents } = payload;
    useStore.getState().createAgents(env_id, layer_id, agents);
  });

  wsManager.on('agent_update', (payload: AgentUpdatePayload) => {
    const { env_id, layer_id, agents } = payload;
    useStore.getState().updateAgents(env_id, layer_id, agents);
  });

  wsManager.on('agent_delete', (payload: AgentDeletePayload) => {
    const { env_id, layer_id, ids } = payload;
    useStore.getState().deleteAgents(env_id, layer_id, ids);
  });

  // -- Edges --
  wsManager.on('edge_create', (payload: EdgeCreatePayload) => {
    const { env_id, layer_id, edges } = payload;
    useStore.getState().createEdges(env_id, layer_id, edges);
  });

  wsManager.on('edge_update', (payload: EdgeUpdatePayload) => {
    const { env_id, layer_id, edges } = payload;
    useStore.getState().updateEdges(env_id, layer_id, edges);
  });

  wsManager.on('edge_delete', (payload: EdgeDeletePayload) => {
    const { env_id, layer_id, edges } = payload;
    useStore.getState().deleteEdges(env_id, layer_id, edges);
  });

  // -- Parameters --
  wsManager.on('parameter_create', (payload: ParameterCUPayload) => {
    useStore.getState().upsertParameter(payload);
  });

  wsManager.on('parameter_update', (payload: ParameterCUPayload) => {
    useStore.getState().upsertParameter(payload);
  });

  wsManager.on('parameter_delete', (payload: ParameterDeletePayload) => {
    useStore.getState().deleteParameter(payload.id);
  });

  wsManager.on('parameter_sync', (payload: ParameterSyncPayload) => {
    useStore.getState().syncParameterValue(payload.id, payload.value);
  });

  // -- Charts --
  wsManager.on('chart_create', (payload: ChartCreatePayload) => {
    useStore.getState().upsertChart(payload);
  });

  wsManager.on('chart_update', (payload: ChartUpdatePayload) => {
    const { updates, operations } = payload;
    const { addChartData, executeChartOperations } = useStore.getState();
    if (updates) addChartData(updates);
    if (operations) executeChartOperations(operations);
  });

  wsManager.on('chart_delete', (payload: ChartDeletePayload) => {
    useStore.getState().deleteChart(payload.id);
  });

  // -- Log / Error --
  wsManager.on('log', (payload: LogPayload) => {
    useStore.getState().log(payload);
  });

  wsManager.on('error', (payload: ErrorPayload) => {
    const toast = getToastState();
    const message = payload.error || 'An unknown error occurred.';
    toast.error("Error from server", message);
  });
}
