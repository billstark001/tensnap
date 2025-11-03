import { WebSocketManager } from "@/websocket";
import { ScenarioStore, SetDataPayload } from "./scenario";
import { EnvironmentUpdatePayload, AgentUpdatePayload, AgentBatchUpdatePayload, StateSyncResponse, ChartUpdatePayload, TimeStepStartPayload, TimeStepEndPayload, LogPayload } from "@/types/api";
import { StoreApi, UseBoundStore } from "zustand";

export function registerEventHandlers(
  wsManager: WebSocketManager,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  wsManager.on('time_step_start', (payload: TimeStepStartPayload) => {
    useStore.getState().setCurrentTime(payload.time, true);
  });

  wsManager.on('time_step_end', (payload: TimeStepEndPayload) => {
    // 创建快照
    const store = useStore.getState();
    store.setCurrentTime(payload.time ?? store.currentTime, false);
    const snapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      timeStep: payload.time ?? store.currentTime,
    };
    store.addSnapshot(snapshot);
  });

  wsManager.on('environment_update', (payload: EnvironmentUpdatePayload) => {
    const { id, data } = payload;
    useStore.getState().updateEnvironment(id, data);
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
      updates.map(({ id, data }) => ({ id, data }))
    );
  });

  wsManager.on('state_sync', (payload: StateSyncResponse) => {

    const store = useStore.getState();

    const {
      mode = 'full',
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
        cleanCharts: clear_charts,
        removedChartIds: removed_charts,
        removedEnvironmentIds: removed_environments,
        removedParameterIds: removed_parameters,
        parameters: allParameters,
        environments: allEnvironments,
        charts: allCharts,
      };
      store.setData(updateData, { updateLayout: true, preserveExisting: mode === 'incremental' });
    } else {
      store.updateMainViewLayout();
    }

    // 处理删除的项目 - 暂时不删除，而是标记为禁用以提供更好的用户体验
    // 这样用户可以看到之前存在但现在不可用的项目
    if (payload.removed_parameters.length > 0 ||
      payload.removed_environments.length > 0 ||
      payload.removed_charts.length > 0) {
      console.log('Items removed from server:', {
        parameters: payload.removed_parameters,
        environments: payload.removed_environments,
        charts: payload.removed_charts
      });
      // 可以在此处实现禁用逻辑，而不是直接删除
    }
  });

  wsManager.on('chart_update', (payload: ChartUpdatePayload) => {
    const { addChartData } = useStore.getState();
    addChartData(payload);
  });

  wsManager.on('log', (payload: LogPayload) => {
    // TODO 处理日志消息
    if (payload.target) {
      console.log(`[${payload.level.toUpperCase()}][${payload.target}] ${payload.message}`);
    } else {
      console.log(`[${payload.level.toUpperCase()}] ${payload.message}`);
    }
  });
}