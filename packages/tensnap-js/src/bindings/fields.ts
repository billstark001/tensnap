import type {
  FieldSelector,
  ItemRecord,
  LayerProjector,
  LiteralField,
} from './types';
import { readPath } from './utils';

export function literal<TValue>(value: TValue): LiteralField<TValue> {
  return { kind: 'literal', value };
}

export function assetIcon(id: string): `asset:${string}` {
  return `asset:${id}`;
}

export function projectFields<TModel, TItem extends object>(
  fields: Record<string, FieldSelector<TModel, TItem>>,
): LayerProjector<TModel, TItem> {
  return (model, item) => {
    const out: ItemRecord = {};
    for (const [key, selector] of Object.entries(fields)) {
      if (typeof selector === 'function') {
        out[key] = selector(item, model);
      } else if (typeof selector === 'object' && selector !== null && 'kind' in selector) {
        out[key] = selector.value;
      } else {
        out[key] = readPath(item, String(selector));
      }
    }
    return out;
  };
}
