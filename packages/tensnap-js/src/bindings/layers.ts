import type { ModelBuilder } from './builder';
import type {
  EnvironmentBinding,
  ItemRecord,
  LayerOptions,
  LayerProjector,
} from './types';
import { cloneItems } from './utils';

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
    options: Omit<LayerOptions<TModel, TItem>, 'type'> = {},
  ): this {
    return this.layer(id, { ...options, type: 'agent' });
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
    return this.layer(id, { ...options, type: 'edge' });
  }

  trajectoryLayer<TItem extends object = ItemRecord>(
    id: string,
    options: Omit<LayerOptions<TModel, TItem>, 'type'> = {},
  ): this {
    return this.layer(id, { ...options, type: 'trajectory' });
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
