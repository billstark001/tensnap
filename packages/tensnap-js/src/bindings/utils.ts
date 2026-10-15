import type {
  ItemDeleteKey,
  ItemKeySelector,
  ItemRecord,
  MaybeFactory,
  PrimitiveItemKey,
  ResolvedItemKey,
} from './types';
import { dequal } from 'dequal/lite';

export function titleFromId(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Own projected values so model mutations cannot rewrite sent snapshots.
 * A previous owned snapshot may supply equal nested fields without copying them again.
 */
export function cloneItem<TItem extends object>(item: TItem, previous?: ItemRecord): ItemRecord {
  return ownItemValues({ ...(item as unknown as ItemRecord) }, previous);
}

/** Own nested values in an already-detached outer record, reusing prior owned fields. */
export function ownItemValues(snapshot: ItemRecord, previous?: ItemRecord): ItemRecord {
  for (const key of Object.keys(snapshot)) {
    const value = snapshot[key];
    if (value !== null && typeof value === 'object') {
      snapshot[key] =
        previous && dequal(previous[key], value) ? previous[key] : structuredClone(value);
    }
  }
  return snapshot;
}

export function cloneItems<TItem extends object>(items: readonly TItem[]): ItemRecord[] {
  return items.map((item) => cloneItem(item));
}

export function isPrimitiveKey(value: unknown): value is PrimitiveItemKey {
  return typeof value === 'string' || typeof value === 'number';
}

function getRecordValue(record: ItemRecord, key: string): unknown {
  return record[key];
}

/** Internal identity encoding: preserve primitive types and escape field boundaries. */
export function stableStorageKey(deleteKey: ItemDeleteKey): string {
  if (isPrimitiveKey(deleteKey)) {
    return JSON.stringify(deleteKey);
  }
  return JSON.stringify(
    Object.keys(deleteKey)
      .sort()
      .map((key) => [key, deleteKey[key]]),
  );
}

export function resolveItemKey<TItem extends object>(
  item: TItem,
  record: ItemRecord,
  selector?: ItemKeySelector<TItem>,
): ResolvedItemKey {
  if (typeof selector === 'function') {
    const deleteKey = selector(item, record);
    return {
      storageKey: stableStorageKey(deleteKey),
      deleteKey,
      keyFields: isPrimitiveKey(deleteKey) ? [] : Object.keys(deleteKey),
    };
  }

  const selectorList = Array.isArray(selector)
    ? selector.map((key) => String(key))
    : selector
      ? [String(selector)]
      : undefined;

  if (selectorList) {
    if (selectorList.length === 1) {
      const field = selectorList[0];
      const value = getRecordValue(record, field);
      if (!isPrimitiveKey(value)) {
        throw new Error(`TenSnap item key ${field} must be a string or number.`);
      }
      return {
        storageKey: stableStorageKey({ [field]: value }),
        deleteKey: { [field]: value },
        keyFields: [field],
      };
    }
    const deleteKey: ItemRecord = Object.create(null);
    for (const field of selectorList) {
      deleteKey[field] = getRecordValue(record, field);
    }
    return {
      storageKey: stableStorageKey(deleteKey),
      deleteKey,
      keyFields: selectorList,
    };
  }

  if (isPrimitiveKey(record.id)) {
    return {
      storageKey: `id:${typeof record.id}:${record.id}`,
      deleteKey: { id: record.id },
      keyFields: ['id'],
    };
  }

  if (isPrimitiveKey(record.source) && isPrimitiveKey(record.target)) {
    return {
      storageKey: stableStorageKey({ source: record.source, target: record.target }),
      deleteKey: { source: record.source, target: record.target },
      keyFields: ['source', 'target'],
    };
  }

  throw new Error('TenSnap items must declare an id, source/target, or an explicit key selector.');
}

export function diffItem(
  previous: ItemRecord,
  current: ItemRecord,
  key: ResolvedItemKey,
): ItemRecord | undefined {
  const diff: ItemRecord = Object.create(null);
  let changed = false;
  // Most layers have one or two key fields. Avoid allocating a union Set and
  // two spread arrays for every agent, while bounding lookup cost for custom keys.
  const largeKeyFields = key.keyFields.length > 4 ? new Set(key.keyFields) : undefined;
  const isKeyField = (field: string) => largeKeyFields?.has(field) ?? key.keyFields.includes(field);
  for (const field of Object.keys(current)) {
    if (isKeyField(field)) continue;
    const before = previous[field];
    const after = current[field];
    const same =
      Object.is(before, after) ||
      (before !== null &&
        typeof before === 'object' &&
        after !== null &&
        typeof after === 'object' &&
        dequal(before, after));
    if (!same) {
      diff[field] = current[field];
      changed = true;
    }
  }

  for (const field of Object.keys(previous)) {
    if (!isKeyField(field) && !Object.prototype.hasOwnProperty.call(current, field)) {
      diff[field] = null;
      changed = true;
    }
  }

  if (!changed) {
    return undefined;
  }

  if (isPrimitiveKey(key.deleteKey)) {
    diff.id = key.deleteKey;
  } else {
    Object.assign(diff, key.deleteKey);
  }
  return diff;
}

export function getLayerKey(envId: string, layerId: string): string {
  return JSON.stringify([envId, layerId]);
}

export function normalizeNumber(
  rawValue: unknown,
  options: {
    min?: number;
    max?: number;
    step?: number;
    integer?: boolean;
    normalize?: (value: number) => number;
  },
): number | undefined {
  const parsed = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  let value = options.normalize ? options.normalize(parsed) : parsed;
  if (options.integer) {
    value = Math.round(value);
  }
  if (typeof options.step === 'number' && options.step > 0) {
    const min = options.min ?? 0;
    value = Math.round((value - min) / options.step) * options.step + min;
  }
  if (typeof options.min === 'number') {
    value = Math.max(options.min, value);
  }
  if (typeof options.max === 'number') {
    value = Math.min(options.max, value);
  }
  return Number(value.toFixed(12));
}

export function withDefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

export function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export async function hashAssetData(data: Uint8Array): Promise<string> {
  const buffer = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Compile dotted/indexed access once while preserving null-safe path semantics. */
export function compilePath(path: string): (source: unknown) => unknown {
  const parts = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  return (source) => {
    let current = source;
    for (const part of parts) {
      if (current == null) return current;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  };
}

export function isChartValueEntry(value: unknown): value is { value: unknown; time?: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'value')
  );
}

export function resolveMaybeFactory<TModel, TValue>(
  value: MaybeFactory<TModel, TValue> | undefined,
  model: TModel,
): TValue | undefined {
  if (typeof value === 'function') {
    return (value as (model: TModel) => TValue)(model);
  }
  return value;
}
