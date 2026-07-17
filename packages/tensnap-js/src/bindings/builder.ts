import type { SimulatorSession } from '../runtime';
import type { ScenarioDefinition } from '../scenario';
import { chartBinding, chartGroupBinding } from './charts';
import { monitorBinding } from './monitors';
import { buildScenarioDefinition, getCurrentConfig } from './definition';
import { EnvironmentBuilder } from './layers';
import {
  booleanParameter,
  createConfigParameter,
  enumParameter,
  inferConfigFields,
  numberParameter,
  stringParameter,
} from './parameters';
import { createBoundSession } from './session';
import type {
  ActionBinding,
  ActionOptions,
  AssetBinding,
  AssetOptions,
  BooleanParameterOptions,
  BoundModelDefinition,
  ChartBinding,
  ChartOptions,
  ChartSeriesOptions,
  ConfigParamField,
  DeclarativeExampleBinding,
  EnvironmentBinding,
  EnvironmentOptions,
  EnumParameterOptions,
  ModelBuilderOptions,
  ModelMetadata,
  MonitorBinding,
  MonitorOptions,
  NumberParameterOptions,
  ParameterBinding,
  ParamsFromConfigOptions,
  StringParameterOptions,
} from './types';
import { titleFromId } from './utils';

export class ModelBuilder<
  TConfig extends object,
  TModel,
  TMetadata extends ModelMetadata = ModelMetadata,
> {
  private readonly parameters: ParameterBinding<TConfig, TModel>[] = [];
  private readonly environments: EnvironmentBinding<TModel>[] = [];
  private readonly charts: ChartBinding<TConfig, TModel>[] = [];
  private readonly monitors: MonitorBinding<TConfig, TModel>[] = [];
  private readonly actions: ActionBinding<TConfig, TModel>[] = [];
  private readonly assets: AssetBinding<TConfig, TModel>[] = [];

  constructor(
    private readonly metadata: TMetadata,
    private readonly options: ModelBuilderOptions<TConfig, TModel>,
  ) {}

  numberParam(id: string, options: NumberParameterOptions<TConfig, TModel>): this {
    this.parameters.push(numberParameter(id, options));
    return this;
  }

  booleanParam(id: string, options: BooleanParameterOptions<TConfig, TModel>): this {
    this.parameters.push(booleanParameter(id, options));
    return this;
  }

  stringParam(id: string, options: StringParameterOptions<TConfig, TModel>): this {
    this.parameters.push(stringParameter(id, options));
    return this;
  }

  enumParam<TValue extends string>(
    id: string,
    options: EnumParameterOptions<TConfig, TModel, TValue>,
  ): this {
    this.parameters.push(enumParameter(id, options));
    return this;
  }

  paramsFromConfig<TSource extends object>(
    options: ParamsFromConfigOptions<TConfig, TModel, TSource>,
  ): this {
    const defaults = (this.options.defaults ?? {}) as TConfig;
    const fields = (options.fields ?? inferConfigFields(options.get(
      this.options.create(defaults),
      defaults,
    ))) as Record<string, ConfigParamField | undefined>;
    for (const [key, field] of Object.entries(fields)) {
      if (field) {
        this.parameters.push(createConfigParameter(key as keyof TSource & string, field, options));
      }
    }
    return this;
  }

  env(id: string, options: EnvironmentOptions = {}): EnvironmentBuilder<TConfig, TModel> {
    const environment: EnvironmentBinding<TModel> = {
      id,
      type: options.type ?? '2d',
      layers: [],
    };
    this.environments.push(environment);
    return new EnvironmentBuilder(this, environment);
  }

  chart(id: string, options: ChartOptions<TConfig, TModel>): this {
    this.charts.push(chartBinding(id, options));
    return this;
  }

  chartGroup(
    id: string,
    options: {
      label?: string;
      color?: string;
      series: readonly ChartSeriesOptions<TConfig, TModel>[];
    },
  ): this {
    this.charts.push(chartGroupBinding(id, options));
    return this;
  }

  monitor(id: string, options: MonitorOptions<TConfig, TModel>): this {
    this.monitors.push(monitorBinding(id, options));
    return this;
  }

  action(id: string, options: ActionOptions<TConfig, TModel>): this {
    this.actions.push({
      metadata: {
        id,
        label: options.label ?? titleFromId(id),
        scope: options.scope,
        kwargs: options.kwargs?.map((definition) => ({ ...definition })),
        continuous: options.continuous,
      },
      sync: options.sync ?? true,
      run: options.run,
    });
    return this;
  }

  asset(id: string, options: AssetOptions<TConfig, TModel>): this {
    this.assets.push({ id, ...options });
    return this;
  }

  build(): DeclarativeExampleBinding<TConfig, TMetadata> {
    return buildBinding({
      metadata: this.metadata,
      options: this.options,
      lifecycleLabels: this.options.lifecycleLabels,
      parameters: [...this.parameters],
      environments: this.environments.map((environment) => ({
        ...environment,
        layers: [...environment.layers],
      })),
      charts: [...this.charts],
      monitors: [...this.monitors],
      actions: [...this.actions],
      assets: [...this.assets],
    });
  }
}

export function modelBuilder<
  TConfig extends object,
  TModel,
  TMetadata extends ModelMetadata = ModelMetadata,
>(
  metadata: TMetadata,
  options: ModelBuilderOptions<TConfig, TModel>,
): ModelBuilder<TConfig, TModel, TMetadata> {
  return new ModelBuilder(metadata, options);
}

export function buildBinding<
  TConfig extends object,
  TModel,
  TMetadata extends ModelMetadata,
>(
  binding: BoundModelDefinition<TConfig, TModel> & { metadata: TMetadata },
): DeclarativeExampleBinding<TConfig, TMetadata> {
  const hasRestoreCheckpoint = binding.options.restoreCheckpoint !== undefined;
  const hasCaptureCheckpoint = binding.options.captureCheckpoint !== undefined;
  const hasDeclarativeLayerRestore = binding.environments.some((environment) =>
    environment.layers.some((layer) => layer.restore !== undefined));
  if (hasRestoreCheckpoint !== hasCaptureCheckpoint) {
    throw new Error('Checkpoint support requires both restoreCheckpoint and captureCheckpoint.');
  }
  if (hasRestoreCheckpoint && !binding.metadata.stateSchemaVersion) {
    throw new Error('Checkpoint support requires a stable stateSchemaVersion.');
  }
  if (binding.options.sceneRestore?.mode === 'imperative' && hasDeclarativeLayerRestore) {
    throw new Error('Imperative sceneRestore cannot be combined with declarative layer restore. Use sceneRestore.mode "compose".');
  }

  const resolveConfig = (overrides: Partial<TConfig> = {}): TConfig => ({
    ...((binding.options.defaults ?? {}) as TConfig),
    ...overrides,
  });

  return {
    ...binding.metadata,
    createScenario(config: Partial<TConfig> = {}): ScenarioDefinition {
      const initialConfig = resolveConfig(config);
      const model = binding.options.create(initialConfig);
      const currentConfig = getCurrentConfig(binding, model, initialConfig);
      return buildScenarioDefinition(binding, model, currentConfig);
    },
    createSession(config: Partial<TConfig> = {}): SimulatorSession {
      return createBoundSession(binding, resolveConfig(config));
    },
  };
}
