import type { ProtocolData } from '@tensnap/protocol';

export type ValueInspectorHint = 'auto' | 'tree' | 'table' | 'text';
export type ValueInspectorMode = Exclude<ValueInspectorHint, 'auto'>;
export type ValueInspectorPath = readonly (string | number)[];

export interface ValueInspectorLimits {
  /** Maximum nested object/array depth that may be expanded. */
  maxDepth: number;
  /** Maximum rows/entries returned from any one node request. */
  maxEntries: number;
  /** Maximum columns inferred for a table. */
  maxColumns: number;
  /** Maximum characters in the safe raw/text fallback. */
  maxTextLength: number;
}

export const DEFAULT_VALUE_INSPECTOR_LIMITS: Readonly<ValueInspectorLimits> = Object.freeze({
  maxDepth: 12,
  maxEntries: 200,
  maxColumns: 64,
  maxTextLength: 16_384,
});

export interface ValueInspectorEntry {
  key: string;
  path: readonly (string | number)[];
  value: ProtocolData;
  summary: string;
  expandable: boolean;
}

export interface ValueInspectorTree {
  kind: 'tree';
  entries: readonly ValueInspectorEntry[];
  /** Known for arrays; object maps stay lazy and report an unknown total. */
  total?: number;
  hasMore: boolean;
  truncated: boolean;
}

export interface ValueInspectorTable {
  kind: 'table';
  columns: readonly string[];
  rows: readonly Readonly<Record<string, ProtocolData>>[];
  /** Known for arrays; object maps stay lazy and report an unknown total. */
  total?: number;
  hasMore: boolean;
  truncated: boolean;
}

export interface ValueInspectorText {
  kind: 'text';
  text: string;
  truncated: boolean;
  /** A hint conflict, depth limit, or malformed value caused the fallback. */
  reason?: string;
}

export type ValueInspectorContent = ValueInspectorTree | ValueInspectorTable | ValueInspectorText;

export interface ValueInspectorRequest {
  path?: ValueInspectorPath;
  offset?: number;
  limit?: number;
  hint?: ValueInspectorHint;
}

function isRecord(value: ProtocolData): value is Record<string, ProtocolData> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExpandable(value: ProtocolData): boolean {
  return Array.isArray(value) || isRecord(value);
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function normalizeLimits(limits: Partial<ValueInspectorLimits>): ValueInspectorLimits {
  return {
    maxDepth: clampInteger(limits.maxDepth, DEFAULT_VALUE_INSPECTOR_LIMITS.maxDepth, 1, 100),
    maxEntries: clampInteger(limits.maxEntries, DEFAULT_VALUE_INSPECTOR_LIMITS.maxEntries, 1, 1_000),
    maxColumns: clampInteger(limits.maxColumns, DEFAULT_VALUE_INSPECTOR_LIMITS.maxColumns, 1, 256),
    maxTextLength: clampInteger(limits.maxTextLength, DEFAULT_VALUE_INSPECTOR_LIMITS.maxTextLength, 0, 1_000_000),
  };
}

/**
 * A bounded, cycle-safe representation. The formatter stops traversing as
 * soon as it fills the output budget, so malformed or exceptionally large
 * local values cannot monopolize a render frame.
 */
export function valueInspectorText(value: unknown, maxLength = DEFAULT_VALUE_INSPECTOR_LIMITS.maxTextLength): ValueInspectorText {
  const limit = clampInteger(maxLength, DEFAULT_VALUE_INSPECTOR_LIMITS.maxTextLength, 0, 1_000_000);
  if (limit === 0) return { kind: 'text', text: '', truncated: true };

  const seen = new WeakSet<object>();
  let text = '';
  let truncated = false;
  const truncate = () => {
    if (truncated) return;
    truncated = true;
    text = `${text.slice(0, Math.max(0, limit - 1))}…`;
  };
  const append = (part: string) => {
    if (truncated) return;
    const remaining = limit - text.length;
    if (part.length <= remaining) {
      text += part;
      return;
    }
    text += part.slice(0, Math.max(0, remaining));
    truncate();
  };
  const render = (current: unknown, depth: number): void => {
    if (truncated) return;
    if (current === null) return append('null');
    if (typeof current === 'string') return append(current);
    if (typeof current === 'number' || typeof current === 'boolean') return append(String(current));
    if (typeof current === 'undefined') return append('undefined');
    if (typeof current === 'bigint') return append(`${current}n`);
    if (typeof current === 'function' || typeof current === 'symbol') return append(`[${typeof current}]`);
    if (current instanceof Uint8Array) return append(`Uint8Array(${current.byteLength})`);
    if (typeof current !== 'object') return append(String(current));
    if (seen.has(current)) return append('[Circular]');
    if (depth >= DEFAULT_VALUE_INSPECTOR_LIMITS.maxDepth) return append('[Max depth]');
    seen.add(current);
    if (Array.isArray(current)) {
      append('[');
      for (let index = 0; index < current.length && !truncated; index += 1) {
        if (index > 0) append(', ');
        try {
          render(current[index], depth + 1);
        } catch {
          append('[Unreadable]');
        }
      }
      if (!truncated) append(']');
      return;
    }
    append('{');
    try {
      const record = current as Record<string, unknown>;
      let first = true;
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
        if (!first) append(', ');
        first = false;
        append(`${JSON.stringify(key)}: `);
        try {
          render(record[key], depth + 1);
        } catch {
          append('[Unreadable]');
        }
      }
    } catch {
      append('[Unreadable]');
    }
    if (!truncated) append('}');
  };

  render(value, 0);
  return { kind: 'text', text, truncated };
}

type RecordPage = { keys: readonly string[]; hasMore: boolean; total: number };

/**
 * A framework-neutral, lazy reader for protocol values. It deliberately never
 * constructs a recursive render tree: hosts request the expanded branch and
 * virtualize the returned entries/rows themselves.
 */
export class ValueInspector {
  readonly limits: ValueInspectorLimits;
  /** Immutable protocol snapshots let a single key index serve every page. */
  private readonly recordKeys = new WeakMap<object, readonly string[]>();

  constructor(private readonly root: ProtocolData, limits: Partial<ValueInspectorLimits> = {}) {
    this.limits = normalizeLimits(limits);
  }

  valueAt(path: ValueInspectorPath = []): ProtocolData | undefined {
    try {
      let value: ProtocolData = this.root;
      for (const segment of path) {
        if (Array.isArray(value)) {
          if (typeof segment !== 'number' || segment < 0 || segment >= value.length) return undefined;
          value = value[segment]!;
        } else if (isRecord(value)) {
          if (typeof segment !== 'string' || !Object.prototype.hasOwnProperty.call(value, segment)) return undefined;
          value = value[segment]!;
        } else {
          return undefined;
        }
      }
      return value;
    } catch {
      return undefined;
    }
  }

  inspect(request: ValueInspectorRequest = {}): ValueInspectorContent {
    const path = request.path ?? [];
    const value = this.valueAt(path);
    if (value === undefined) return { kind: 'text', text: '', truncated: false, reason: 'The selected value is unavailable.' };
    if (path.length >= this.limits.maxDepth && isExpandable(value)) {
      return { ...valueInspectorText(value, this.limits.maxTextLength), reason: `Maximum inspection depth (${this.limits.maxDepth}) reached.` };
    }

    try {
      const mode = this.resolveMode(value, request.hint ?? 'auto');
      if (mode === 'text') return valueInspectorText(value, this.limits.maxTextLength);
      if (mode === 'tree') return this.inspectTree(value, path, request.offset, request.limit);
      return this.inspectTable(value, request.offset, request.limit);
    } catch {
      return {
        ...valueInspectorText(value, this.limits.maxTextLength),
        reason: 'The selected value could not be inspected safely.',
      };
    }
  }

  private resolveMode(value: ProtocolData, hint: ValueInspectorHint): ValueInspectorMode {
    if (hint !== 'auto') return hint;
    if (Array.isArray(value)) return 'table';
    if (isRecord(value)) return 'tree';
    return 'text';
  }

  private readRecordPage(value: Record<string, ProtocolData>, offset: number, limit: number): RecordPage {
    const keys = this.recordKeys.get(value) ?? Object.freeze(Object.keys(value));
    if (!this.recordKeys.has(value)) this.recordKeys.set(value, keys);
    const end = Math.min(keys.length, offset + limit);
    return {
      keys: keys.slice(offset, end),
      hasMore: end < keys.length,
      total: keys.length,
    };
  }

  private pageSize(limit: number | undefined): number {
    return clampInteger(limit, this.limits.maxEntries, 1, this.limits.maxEntries);
  }

  private pageOffset(offset: number | undefined): number {
    return clampInteger(offset, 0, 0, Number.MAX_SAFE_INTEGER);
  }

  private columnsForRecords(records: readonly Record<string, ProtocolData>[], maximum: number): string[] {
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const key in record) {
        if (!Object.prototype.hasOwnProperty.call(record, key) || seen.has(key)) continue;
        seen.add(key);
        columns.push(key);
        if (columns.length === maximum) return columns;
      }
    }
    return columns;
  }

  private inspectTree(value: ProtocolData, path: ValueInspectorPath, offset?: number, limit?: number): ValueInspectorContent {
    if (!isExpandable(value)) {
      return { ...valueInspectorText(value, this.limits.maxTextLength), reason: 'A tree requires an object or array value.' };
    }
    const start = this.pageOffset(offset);
    const pageSize = this.pageSize(limit);
    if (Array.isArray(value)) {
      const end = Math.min(value.length, start + pageSize);
      const entries: ValueInspectorEntry[] = [];
      for (let index = start; index < end; index += 1) {
        const item = value[index]!;
        entries.push({
          key: String(index),
          path: [...path, index],
          value: item,
          summary: this.summary(item),
          expandable: isExpandable(item),
        });
      }
      const hasMore = end < value.length;
      return { kind: 'tree', entries, total: value.length, hasMore, truncated: hasMore };
    }

    if (!isRecord(value)) {
      return { ...valueInspectorText(value, this.limits.maxTextLength), reason: 'A tree requires an object or array value.' };
    }
    const page = this.readRecordPage(value, start, pageSize);
    return {
      kind: 'tree',
      entries: page.keys.map((key) => {
        const item = value[key]!;
        return {
          key,
          path: [...path, key],
          value: item,
          summary: this.summary(item),
          expandable: isExpandable(item),
        };
      }),
      total: page.total,
      hasMore: page.hasMore,
      truncated: page.hasMore,
    };
  }

  private inspectTable(value: ProtocolData, offset?: number, limit?: number): ValueInspectorContent {
    const pageSize = this.pageSize(limit);
    const start = this.pageOffset(offset);
    if (Array.isArray(value)) {
      const end = Math.min(value.length, start + pageSize);
      const pageValues: ProtocolData[] = [];
      for (let index = start; index < end; index += 1) pageValues.push(value[index]!);
      const allRecords = pageValues.every(isRecord);
      const records = allRecords ? pageValues as Record<string, ProtocolData>[] : [];
      const columns = allRecords
        ? this.columnsForRecords(records, this.limits.maxColumns)
        : ['value'];
      const rows = pageValues.map((row) => {
        if (!allRecords) return { value: row };
        const record = row as Record<string, ProtocolData>;
        return Object.fromEntries(columns.map((column) => [column, record[column] ?? null])) as Record<string, ProtocolData>;
      });
      const hasMore = end < value.length;
      return { kind: 'table', columns, rows, total: value.length, hasMore, truncated: hasMore };
    }
    if (isRecord(value)) {
      const page = this.readRecordPage(value, start, pageSize);
      const records = page.keys.map((key) => value[key]!);
      const allRecords = records.every(isRecord);
      const recordValues = allRecords ? records as Record<string, ProtocolData>[] : [];
      const recordColumns = allRecords
        ? this.columnsForRecords(recordValues, Math.max(0, this.limits.maxColumns - 1))
        : ['value'];
      const columns = ['key', ...recordColumns];
      const rows = page.keys.map((key) => {
        const row = value[key]!;
        if (!allRecords) return { key, value: row };
        const record = row as Record<string, ProtocolData>;
        return Object.fromEntries([
          ['key', key],
          ...recordColumns.map((column) => [column, record[column] ?? null] as const),
        ]) as Record<string, ProtocolData>;
      });
      return { kind: 'table', columns, rows, total: page.total, hasMore: page.hasMore, truncated: page.hasMore };
    }
    return { ...valueInspectorText(value, this.limits.maxTextLength), reason: 'A table requires an array or object value.' };
  }

  private summary(value: ProtocolData): string {
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (isRecord(value)) return 'Object';
    return valueInspectorText(value, Math.min(this.limits.maxTextLength, 160)).text;
  }
}
