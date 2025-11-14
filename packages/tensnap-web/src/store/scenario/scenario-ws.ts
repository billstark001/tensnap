import { WebSocketManager } from "@/websocket";
import { ScenarioStore, SetDataPayload } from "./store";
import { EnvironmentUpdatePayload, AgentUpdatePayload, AgentBatchUpdatePayload, TileUpdatePayload, TileBatchUpdatePayload, StateSyncResponse, ChartUpdatePayload, TimeStepStartPayload, TimeStepEndPayload, LogPayload, ErrorPayload } from "@/types/api";
import { StoreApi, UseBoundStore } from "zustand";
import { getToastState } from "../toast";

/**
 * Cleanup function to remove all event handlers
 */
export function unregisterEventHandlers(wsManager: WebSocketManager) {
  wsManager.off('time_step_start');
  wsManager.off('time_step_end');
  wsManager.off('environment_update');
  wsManager.off('agent_update');
  wsManager.off('agent_batch_update');
  wsManager.off('tile_update');
  wsManager.off('tile_batch_update');
  wsManager.off('state_sync');
  wsManager.off('chart_update');
  wsManager.off('log');
  wsManager.off('error');
}

export function registerEventHandlers(
  wsManager: WebSocketManager,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  // Clear any existing handlers first to prevent duplicates
  unregisterEventHandlers(wsManager);
  wsManager.on('time_step_start', (payload: TimeStepStartPayload) => {
    useStore.getState().setCurrentTime(payload.time, true);
  });

  wsManager.on('time_step_end', (payload: TimeStepEndPayload) => {
    const store = useStore.getState();
    store.setCurrentTime(payload.time ?? store.currentTime, false);
  });

  wsManager.on('environment_update', (payload: EnvironmentUpdatePayload) => {
    const { id, data, agents, tiles } = payload;
    useStore.getState().updateEnvironment(id, data, agents, tiles);
  });

  wsManager.on('agent_update', (payload: AgentUpdatePayload) => {
    const { environment_id, agent_id, data } = payload;
    useStore.getState().updateAgents(
      environment_id,
      [{ id: agent_id, data }]
    );
  });

  wsManager.on('agent_batch_update', (payload: AgentBatchUpdatePayload) => {
    const { environment_id, updates } = payload;
    useStore.getState().updateAgents(
      environment_id,
      updates.map(({ id, data, operation }) => ({ id, data, operation }))
    );
  });

  wsManager.on('tile_update', (payload: TileUpdatePayload) => {
    const { environment_id, tile_id, data } = payload;
    useStore.getState().updateTiles(
      environment_id,
      [{ id: tile_id, data }]
    );
  });

  wsManager.on('tile_batch_update', (payload: TileBatchUpdatePayload) => {
    const { environment_id, updates } = payload;
    useStore.getState().updateTiles(
      environment_id,
      updates.map(({ id, data, operation }) => ({ id, data, operation }))
    );
  });

  wsManager.on('state_sync', (payload: StateSyncResponse) => {

    const store = useStore.getState();

    const {
      added_parameters,
      removed_parameters,
      updated_parameters,

      added_environments,
      removed_environments,
      updated_environments,

      added_charts,
      removed_charts,
      updated_charts,

      clear_charts,
    } = payload ?? {};


    const allParameters = [
      ...added_parameters,
      ...updated_parameters
    ];

    const allEnvironments = [
      ...added_environments,
      ...updated_environments
    ];

    const allCharts = [
      ...added_charts,
      ...updated_charts
    ];

    // 统一更新数据
    const hasUpdates = allParameters.length > 0 || allEnvironments.length > 0 || allCharts.length > 0;
    if (hasUpdates) {
      const updateData: SetDataPayload = {
        clearCharts: clear_charts,
        removedChartIds: removed_charts,
        removedEnvironmentIds: removed_environments,
        removedParameterIds: removed_parameters,
        parameters: allParameters,
        environments: allEnvironments,
        charts: allCharts,
      };
      // Always preserve existing views and mark removed items as disabled instead of deleting them
      store.setData(updateData, { updateLayout: true, preserveExisting: true });
    } else {
      store.updateMainViewLayout();
    }

    // 处理删除的项目 - 暂时不删除，而是标记为禁用以提供更好的用户体验
    // 这样用户可以看到之前存在但现在不可用的项目
    if (payload.removed_parameters.length > 0 ||
      payload.removed_environments.length > 0 ||
      payload.removed_charts.length > 0) {
      store.log({
        message: 'Some items have been removed from the simulation state.',
        data: {
          parameters: payload.removed_parameters,
          environments: payload.removed_environments,
          charts: payload.removed_charts
        }
      });
    }
  });

  wsManager.on('chart_update', (payload: ChartUpdatePayload) => {
    const { updates, operations } = payload;
    const { addChartData, executeChartOperations } = useStore.getState();
    if (updates) {
      addChartData(updates);
    }
    if (operations) {
      executeChartOperations(operations);
    }
  });

  wsManager.on('log', (payload: LogPayload) => {
    const { log } = useStore.getState();
    log(payload);
  });

  wsManager.on('error', (payload: ErrorPayload) => {
    const toast = getToastState();
    const message = payload.error || 'An unknown error occurred.';
    toast.error("Error from server", message);
  });
}