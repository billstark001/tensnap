import type {
  Action,
  ChartGroupMetadata,
  EnvCreatePayload,
  EnvLayerCreatePayload,
  Parameter,
  ScenarioEnvironmentType,
  StateSyncRequest,
} from '@tensnap/core';
import type { SimulatorSessionHandlers } from '../runtime';
import { SimulatorSession } from '../runtime';

export interface ScenarioLayerDefinition {
  layerId: string;
  layerType: string;
  dependencyLayerIds?: Record<string, string>;
  data?: Record<string, unknown>;
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
}

export interface ReplayTarget {
  paramCreate(payload: Parameter): Promise<void>;
  actionCreate(payload: Action): Promise<void>;
  envCreate(payload: EnvCreatePayload): Promise<void>;
  envLayerCreate(payload: EnvLayerCreatePayload): Promise<void>;
  chartCreate(payload: ChartGroupMetadata): Promise<void>;
}

export interface ScenarioSessionOptions extends SimulatorSessionHandlers {
  onStateSync?(payload: StateSyncRequest, session: SimulatorSession): void | Promise<void>;
}

export class ScenarioRegistry {
  private readonly parameters = new Map<string, Parameter>();
  private readonly actions = new Map<string, Action>();
  private readonly environments = new Map<string, ScenarioEnvironmentDefinition>();
  private readonly charts = new Map<string, ChartGroupMetadata>();

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
        data: { ...(layer.data ?? {}) },
      })),
    });
    return this;
  }

  registerChart(chart: ChartGroupMetadata): this {
    this.charts.set(chart.id, {
      ...chart,
      dataList: chart.dataList?.map((entry: NonNullable<ChartGroupMetadata['dataList']>[number]) => ({ ...entry })),
    });
    return this;
  }

  createSession(options: ScenarioSessionOptions = {}): SimulatorSession {
    const registry = this;
    const { onStateSync, ...handlers } = options;

    return new SimulatorSession({
      ...handlers,
      async onStateSync(payload, session) {
        await session.emitter.stateSyncBegin({ request_id: payload.request_id });
        await registry.replay(session.emitter);
        await onStateSync?.(payload, session);
        await session.emitter.stateSyncEnd({ request_id: payload.request_id });
      },
    });
  }

  async replay(target: ReplayTarget): Promise<void> {
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
          data: layer.data,
        });
      }
    }

    for (const chart of this.charts.values()) {
      await target.chartCreate({
        ...chart,
        dataList: chart.dataList?.map((entry: NonNullable<ChartGroupMetadata['dataList']>[number]) => ({ ...entry })),
      });
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
          data: { ...(layer.data ?? {}) },
        })),
      })),
      charts: [...this.charts.values()].map((chart) => ({
        ...chart,
        dataList: chart.dataList?.map((entry: NonNullable<ChartGroupMetadata['dataList']>[number]) => ({ ...entry })),
      })),
    };
  }
}