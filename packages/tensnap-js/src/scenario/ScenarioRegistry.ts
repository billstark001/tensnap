import type {
  Action,
  ChartGroupMetadata,
  EnvCreatePayload,
  EnvLayerCreatePayload,
  MonitorMetadata,
  Parameter,
  ScenarioEnvironmentType,
  StateSyncRequest,
  ProtocolData,
  SimulatorInfoPayload,
} from '@tensnap/protocol';
import type { SimulatorSessionHandlers } from '../runtime';
import { SimulatorSession } from '../runtime';

export interface ScenarioLayerDefinition {
  layerId: string;
  layerType: string;
  dependencyLayerIds?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface ScenarioEnvironmentDefinition {
  id: string;
  type: ScenarioEnvironmentType;
  layers?: readonly ScenarioLayerDefinition[];
}

export interface ScenarioDefinition {
  parameters?: readonly Parameter[];
  actions?: readonly Action[];
  environments?: readonly ScenarioEnvironmentDefinition[];
  charts?: readonly ChartGroupMetadata[];
  monitors?: readonly MonitorMetadata[];
}

export interface ReplayTarget {
  paramCreate(payload: Parameter): Promise<void>;
  actionCreate(payload: Action): Promise<void>;
  envCreate(payload: EnvCreatePayload): Promise<void>;
  envLayerCreate(payload: EnvLayerCreatePayload): Promise<void>;
  chartCreate(payload: ChartGroupMetadata): Promise<void>;
  monitorCreate(payload: MonitorMetadata): Promise<void>;
}

export interface ScenarioSessionOptions extends SimulatorSessionHandlers {
  /** Identity emitted as the first message of each created session. */
  simulatorInfo: SimulatorInfoPayload;
  onStateSync?(payload: StateSyncRequest, session: SimulatorSession): void | Promise<void>;
}

export class ScenarioRegistry {
  private readonly parameters = new Map<string, Parameter>();
  private readonly actions = new Map<string, Action>();
  private readonly environments = new Map<string, ScenarioEnvironmentDefinition>();
  private readonly charts = new Map<string, ChartGroupMetadata>();
  private readonly monitors = new Map<string, MonitorMetadata>();

  static from(definition: ScenarioDefinition): ScenarioRegistry {
    const registry = new ScenarioRegistry();

    for (const parameter of definition.parameters ?? []) {
      registry.registerParameter(parameter);
    }
    for (const action of definition.actions ?? []) {
      registry.registerAction(action);
    }
    for (const environment of definition.environments ?? []) {
      registry.registerEnvironment(environment);
    }
    for (const chart of definition.charts ?? []) {
      registry.registerChart(chart);
    }
    for (const monitor of definition.monitors ?? []) {
      registry.registerMonitor(monitor);
    }

    return registry;
  }

  registerParameter(parameter: Parameter): this {
    this.parameters.set(parameter.id, { ...parameter });
    return this;
  }

  registerAction(action: Action): this {
    this.actions.set(action.id, { ...action });
    return this;
  }

  registerEnvironment(environment: ScenarioEnvironmentDefinition): this {
    this.environments.set(environment.id, {
      ...environment,
      layers: environment.layers?.map((layer) => ({
        ...layer,
        dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
        metadata: { ...(layer.metadata ?? {}) },
      })),
    });
    return this;
  }

  registerChart(chart: ChartGroupMetadata): this {
    this.charts.set(chart.id, {
      ...chart,
      data_list: chart.data_list?.map((entry: NonNullable<ChartGroupMetadata['data_list']>[number]) => ({ ...entry })),
    });
    return this;
  }

  registerMonitor(monitor: MonitorMetadata): this {
    this.monitors.set(monitor.id, { ...monitor });
    return this;
  }

  createSession(options: ScenarioSessionOptions): SimulatorSession {
    const registry = this;
    const simulatorInfo = structuredClone(options.simulatorInfo);
    let stateRevision = 0;
    const { onStateSync, simulatorInfo: _simulatorInfo, ...handlers } = options;

    return new SimulatorSession({
      ...handlers,
      simulatorInfo,
      async onStateSync(payload, session) {
        if (payload.model_id !== simulatorInfo.model.id) {
          await session.emitter.error({
            code: 'model_mismatch',
            message: `Expected model ${simulatorInfo.model.id}.`,
            request_id: payload.request_id,
          });
          return;
        }
        await session.emitter.stateSyncBegin({
          request_id: payload.request_id,
          model_id: payload.model_id,
          instance_id: simulatorInfo.instance_id,
          mode: 'replace',
        });
        await registry.replay(session.emitter);
        await onStateSync?.(payload, session);
        await session.emitter.stateSyncEnd({ request_id: payload.request_id, state_revision: String(++stateRevision) });
      },
    });
  }

  async replay(target: ReplayTarget): Promise<void> {
    await this.replayInventory(target, true);
  }

  /** Replay restorable state without charts, which are forbidden in a restore transaction. */
  async replaySceneRestore(target: ReplayTarget): Promise<void> {
    await this.replayInventory(target, false);
  }

  private async replayInventory(target: ReplayTarget, includeCharts: boolean): Promise<void> {
    for (const parameter of this.parameters.values()) {
      await target.paramCreate({ ...parameter });
    }

    for (const action of this.actions.values()) {
      await target.actionCreate({ ...action });
    }

    for (const environment of this.environments.values()) {
      await target.envCreate({ id: environment.id, type: environment.type });
      for (const layer of environment.layers ?? []) {
        await target.envLayerCreate({
          env_id: environment.id,
          layer_id: layer.layerId,
          layer_type: layer.layerType,
          dependency_layer_ids: layer.dependencyLayerIds,
          metadata: layer.metadata as Record<string, ProtocolData> | undefined,
        });
      }
    }

    if (includeCharts) {
      for (const chart of this.charts.values()) {
        await target.chartCreate({
          ...chart,
          data_list: chart.data_list?.map((entry: NonNullable<ChartGroupMetadata['data_list']>[number]) => ({ ...entry })),
        });
      }
    }

    for (const monitor of this.monitors.values()) {
      await target.monitorCreate({ ...monitor });
    }
  }

  toDefinition(): ScenarioDefinition {
    return {
      parameters: [...this.parameters.values()].map((parameter) => ({ ...parameter })),
      actions: [...this.actions.values()].map((action) => ({ ...action })),
      environments: [...this.environments.values()].map((environment) => ({
        ...environment,
        layers: environment.layers?.map((layer) => ({
          ...layer,
          dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
          metadata: { ...(layer.metadata ?? {}) },
        })),
      })),
      charts: [...this.charts.values()].map((chart) => ({
        ...chart,
        data_list: chart.data_list?.map((entry: NonNullable<ChartGroupMetadata['data_list']>[number]) => ({ ...entry })),
      })),
      monitors: [...this.monitors.values()].map((monitor) => ({ ...monitor })),
    };
  }
}
