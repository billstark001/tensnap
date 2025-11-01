import { WebSocketManager } from "@/websocket";
import { ScenarioStore, SetDataPayload } from "./scenario";
import { EnvironmentUpdatePayload, AgentUpdatePayload, AgentBatchUpdatePayload, StateSyncResponse, ChartDataPayload, TimeStepStartPayload, TimeStepEndPayload } from "@/types/api";
import { GridEnvironment } from "@/types/modeling";
import { StoreApi, UseBoundStore } from "zustand";

export function registerEventHandlers(
  wsManager: WebSocketManager,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  wsManager.on('time_step_start', (payload: TimeStepStartPayload) => {
    useStore.getState().setCurrentTime(payload.time);
  });

  wsManager.on('time_step_end', (payload: TimeStepEndPayload) => {
    // 创建快照
    const store = useStore.getState();
    const snapshot = {
      id: `snapshot-${Date.now()}`,
      timestamp: Date.now(),
      timeStep: payload.time ?? store.currentTime,
      environments: store.environments,
      parameters: store.parameters,
    };
    store.addSnapshot(snapshot);
  });

  wsManager.on('environment_update', (payload: EnvironmentUpdatePayload) => {
    useStore.getState().updateEnvironment(payload.id, payload.data);
  });

  wsManager.on('agent_update', (payload: AgentUpdatePayload) => {
    useStore.getState().updateEnvironment(
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

  wsManager.on('agent_batch_update', (payload: AgentBatchUpdatePayload) => {
    const updateMap: Record<string, any> = Object.fromEntries(
      payload.updates.map((a: any) => [a.id, a.data]),
    );

    useStore.getState().updateEnvironment(
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

  wsManager.on('state_sync', (payload: StateSyncResponse) => {

    const store = useStore.getState();

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
      store.setData(updateData, true);
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
    const { addChartData, currentTime } = useStore.getState();
    payload.forEach((chartUpdate) => {
      addChartData(chartUpdate.id, chartUpdate.time ?? currentTime, chartUpdate.value);
    });
  });
}