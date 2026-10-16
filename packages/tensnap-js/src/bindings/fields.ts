import type { FieldSelector, ItemRecord, LayerProjector, LiteralField } from './types';
import { compilePath, ownItemValues } from './utils';
import { registerBorrowedView } from './projection-ownership';

export function literal<TValue>(value: TValue): LiteralField<TValue> {
  return { kind: 'literal', value };
}

export function assetIcon(id: string): `asset:${string}` {
  return `asset:${id}`;
}

/**
 * Compile fixed field declarations; callbacks still read the current item and model.
 * Standalone calls detach nested values by default; deepCopy=false borrows them.
 * Choose the policy here: layer options do not reconfigure this prebuilt function.
 */
export function projectFields<TModel, TItem extends object>(
  fields: Record<string, FieldSelector<TModel, TItem>>,
  deepCopy = true,
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
  const raw = (model: TModel, item: TItem): ItemRecord => {
    const out: ItemRecord = Object.create(null);
    for (const [key, get] of compiled) {
      out[key] = get(model, item);
    }
    return out;
  };
  return registerBorrowedView(
    Object.assign(
      (model: TModel, item: TItem) =>
        deepCopy ? ownItemValues(raw(model, item)) : raw(model, item),
      { ownsValues: deepCopy },
    ),
    deepCopy ? raw : undefined,
  );
}
