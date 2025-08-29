import { WebSocketManager } from "@/utils/websocket-manager";
import { ScenarioStore } from "./scenario";
import { TimeStepPayload, EnvironmentUpdatePayload, AgentUpdatePayload, AgentBatchUpdatePayload, StateSyncResponse, ChartDataPayload } from "@/types/api";
import { GridEnvironment } from "@/types/modeling";

export function registerEventHandlers(
  wsManager: WebSocketManager,
  store: ScenarioStore,
) {
  wsManager.on('time_step_start', (payload: TimeStepPayload) => {
    store.setCurrentTime(payload.time);
  });

  wsManager.on('time_step_end', (payload: TimeStepPayload) => {
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

  wsManager.on('environment_update', (payload: EnvironmentUpdatePayload) => {
    store.updateEnvironment(payload.id, payload.data);
  });

  wsManager.on('agent_update', (payload: AgentUpdatePayload) => {
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

  wsManager.on('agent_batch_update', (payload: AgentBatchUpdatePayload) => {
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

  wsManager.on('state_sync', (payload: StateSyncResponse) => {
    // 处理统一的状态同步响应
    console.log('Received state sync:', payload);

    // 处理参数更新 - 使用现有的 setParameters 方法
    const allParameters = [
      ...payload.added_parameters,
      ...payload.updated_parameters
    ];
    if (allParameters.length > 0) {
      store.setParameters(allParameters);
    }

    // 处理环境更新
    const allEnvironments = [
      ...payload.added_environments,
      ...payload.updated_environments
    ];
    if (allEnvironments.length > 0) {
      store.setEnvironments(allEnvironments);
    }

    // 处理图表更新 - 转换ChartState到ChartData格式
    const allCharts = [
      ...payload.added_charts,
      ...payload.updated_charts
    ];
    if (allCharts.length > 0) {
      // 转换ChartState到ChartData格式
      const chartData = allCharts.map(chart => ({
        id: chart.id,
        label: chart.label,
        getter: chart.id, // 使用id作为getter标识
        color: chart.color,
        data: chart.data
      }));
      store.setCharts(chartData, true);
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
    payload.forEach((chartUpdate: any) => {
      store.addChartData(chartUpdate.id, chartUpdate.time, chartUpdate.value);
    });
  });
}