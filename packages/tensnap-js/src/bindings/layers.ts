import type { ModelBuilder } from './builder';
import type {
  EnvironmentBinding,
  ItemRecord,
  LayerOptions,
  LayerProjector,
  TrajectoryLayerOptions,
} from './types';
import { cloneItems } from './utils';
import { agentLayerOptions, mapAgentLayerOptions, matrixAgentLayerOptions } from './agent-layers';
import type { AgentLayerOptions, MapAgentLayerOptions, MatrixAgentLayerOptions } from './agent-layers';

export class EnvironmentBuilder<TConfig extends object, TModel> {
  constructor(
    private readonly parent: ModelBuilder<TConfig, TModel>,
    private readonly environment: EnvironmentBinding<TModel>,
  ) {}

  layer<TItem extends object = ItemRecord>(
    id: string,
    options: LayerOptions<TModel, TItem>,
  ): this {
    this.environment.layers.push({ id, ...options });
    return this;
  }

  agentLayer<TItem extends object = ItemRecord>(
    id: string,
    options: AgentLayerOptions<TModel, TItem> = {},
  ): this {
    return this.layer(id, agentLayerOptions(options));
  }

  mapAgentLayer<K, V>(id: string, options: MapAgentLayerOptions<TModel, K, V>): this {
    return this.layer(id, mapAgentLayerOptions(options));
  }

  matrixAgentLayer<V>(id: string, options: MatrixAgentLayerOptions<TModel, V>): this {
    return this.layer(id, matrixAgentLayerOptions(options));
  }

  gridLayer(
    id: string,
    options: Omit<LayerOptions<TModel>, 'type' | 'items' | 'updates' | 'project' | 'updateProject' | 'key' | 'updateKey'> = {},
  ): this {
    return this.layer(id, { ...options, type: 'grid' });
  }

  edgeLayer<TItem extends object = ItemRecord>(
    id: string,
    options: Omit<LayerOptions<TModel, TItem>, 'type'> = {},
  ): this {
    return this.layer(id, {
      ...options,
      type: 'edge',
      dependencyLayerIds: { agent: 'agents', ...options.dependencyLayerIds },
    });
  }

  trajectoryLayer<TItem extends object = ItemRecord>(
    id: string,
    options: TrajectoryLayerOptions<TModel, TItem> = {},
  ): this {
    const {
      metadata,
      length,
      width,
      color,
      zIndex,
      onAgentDelete,
      onStateSync,
      onReset,
      ...layerOptions
    } = options;
    return this.layer(id, {
      ...layerOptions,
      type: 'trajectory',
      dependencyLayerIds: { agent: 'agents', ...layerOptions.dependencyLayerIds },
      metadata: (model) => ({
        ...(typeof metadata === 'function' ? metadata(model) : metadata),
        ...(length === undefined ? {} : { length }),
        ...(width === undefined ? {} : { width }),
        ...(color === undefined ? {} : { color }),
        ...(zIndex === undefined ? {} : { z_index: zIndex }),
        ...(onAgentDelete === undefined ? {} : { on_agent_delete: onAgentDelete }),
        ...(onStateSync === undefined ? {} : { on_state_sync: onStateSync }),
        ...(onReset === undefined ? {} : { on_reset: onReset }),
      }),
    });
  }

  backgroundLayer(
    id: string,
    options: Omit<LayerOptions<TModel>, 'type' | 'items' | 'updates' | 'project' | 'updateProject' | 'key' | 'updateKey'> = {},
  ): this {
    return this.layer(id, { ...options, type: 'background' });
  }

  done(): ModelBuilder<TConfig, TModel> {
    return this.parent;
  }
}

export function projectLayerItems<TModel, TItem extends object>(
  model: TModel,
  items: readonly TItem[],
  projector?: LayerProjector<TModel, TItem>,
): ItemRecord[] {
  if (!projector) {
    return cloneItems(items);
  }
  return items.map((item) => projector(model, item));
}
