import { WebSocketManager } from "@/websocket";
import { ScenarioStore, SetDataPayload } from "./scenario";
import { EnvironmentUpdatePayload, AgentUpdatePayload, AgentBatchUpdatePayload, StateSyncResponse, ChartDataPayload, TimeStepStartPayload, TimeStepEndPayload, LogPayload } from "@/types/api";
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
    const mode = payload.mode || 'full';

    // 处理参数更新 - 使用现有的 setData 方法
    const allParameters = [
      ...payload.added_parameters,
      ...payload.updated_parameters
    ];

    // 处理环境更新
    const allEnvironments = [
      ...payload.added_environments,
      ...payload.updated_environments
    ];

    // 处理图表更新 - 转换ChartState到ChartData格式
    const allCharts = [
      ...payload.added_charts,
      ...payload.updated_charts
    ];

    // 统一更新数据
    const hasUpdates = allParameters.length > 0 || allEnvironments.length > 0 || allCharts.length > 0;
    if (hasUpdates) {
      const updateData: SetDataPayload = {};
      if (allParameters.length > 0) updateData.parameters = allParameters;
      if (allEnvironments.length > 0) updateData.environments = allEnvironments;
      if (allCharts.length > 0) {
        // 转换ChartState到ChartData格式
        updateData.charts = allCharts.map(chart => ({
          id: chart.id,
          label: chart.label,
          getter: chart.id, // 使用id作为getter标识
          color: chart.color,
          data: [], // 初始数据为空，等待后续的chart_data消息填充
        }));
      }
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

  wsManager.on('chart_data', (payload: ChartDataPayload) => {
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