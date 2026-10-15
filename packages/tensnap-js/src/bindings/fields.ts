import type { FieldSelector, ItemRecord, LayerProjector, LiteralField } from './types';
import { compilePath } from './utils';

export function literal<TValue>(value: TValue): LiteralField<TValue> {
  return { kind: 'literal', value };
}

export function assetIcon(id: string): `asset:${string}` {
  return `asset:${id}`;
}

/** Compile a fixed field declaration; callback fields still read the current item and model. */
export function projectFields<TModel, TItem extends object>(
  fields: Record<string, FieldSelector<TModel, TItem>>,
): LayerProjector<TModel, TItem> {
  const compiled = Object.entries(fields).map(([key, selector]) => {
    let get: (model: TModel, item: TItem) => unknown;
    if (typeof selector === 'function') {
      get = (model, item) => selector(item, model);
    } else if (
      typeof selector === 'object' &&
      selector !== null &&
      'kind' in selector &&
      selector.kind === 'literal' &&
      'value' in selector
    ) {
      get = () => selector.value;
    } else if (typeof selector === 'string') {
      const read = compilePath(selector);
      get = (_model, item) => read(item);
    } else if (typeof selector === 'symbol') {
      get = (_model, item) => item[selector as keyof TItem];
    } else {
      get = () => selector;
    }
    return [key, get] as const;
  });
  return (model, item) => {
    const out: ItemRecord = Object.create(null);
    for (const [key, get] of compiled) {
      out[key] = get(model, item);
    }
    return out;
  };
}
