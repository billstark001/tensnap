import type {
  ItemDeleteKey,
  ItemKeySelector,
  ItemRecord,
  MaybeFactory,
  PrimitiveItemKey,
  ResolvedItemKey,
} from './types';

export function titleFromId(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function cloneItem<TItem extends object>(item: TItem): ItemRecord {
  return { ...(item as unknown as ItemRecord) };
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

function stableKeyPart(value: unknown): string {
  if (isPrimitiveKey(value)) {
    return String(value);
  }
  return JSON.stringify(value);
}

export function stableStorageKey(deleteKey: ItemDeleteKey): string {
  if (isPrimitiveKey(deleteKey)) {
    return stableKeyPart(deleteKey);
  }
  return Object.keys(deleteKey)
    .sort()
    .map((key) => `${key}:${stableKeyPart(deleteKey[key])}`)
    .join('|');
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
        storageKey: `${field}:${value}`,
        deleteKey: { [field]: value },
        keyFields: [field],
      };
    }
    const deleteKey: ItemRecord = {};
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
      storageKey: `id:${record.id}`,
      deleteKey: { id: record.id },
      keyFields: ['id'],
    };
  }

  if (isPrimitiveKey(record.source) && isPrimitiveKey(record.target)) {
    return {
      storageKey: `source:${record.source}|target:${record.target}`,
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
  const diff: ItemRecord = {};
  let changed = false;
  const keyFields = new Set(key.keyFields);
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);

  for (const field of keys) {
    if (keyFields.has(field)) {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(current, field)) {
      diff[field] = null;
      changed = true;
      continue;
    }
    if (!Object.is(previous[field], current[field])) {
      diff[field] = current[field];
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
  return `${envId}:${layerId}`;
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
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
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

export function readPath(source: unknown, path: string): unknown {
  const normalized = path.replace(/\[(\d+)\]/g, '.$1');
  return normalized.split('.').reduce<unknown>((current, part) => {
    if (current == null || part === '') {
      return current;
    }
    return (current as Record<string, unknown>)[part];
  }, source);
}

export function isChartValueEntry(value: unknown): value is { value: unknown; time?: number } {
  return (
    typeof value === 'object'
    && value !== null
    && Object.prototype.hasOwnProperty.call(value, 'value')
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
