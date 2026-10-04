import type {
  LayerOptions,
  ItemRecord,
  LayerChangeBatch,
  LiteralField,
  FieldSelector,
} from './types';
import { literal, projectFields } from './fields';
import { readPath } from './utils';

export type AgentLayerOptions<M, I extends object> = Omit<LayerOptions<M, I>, 'type'> & {
  fields?: Readonly<Record<string, FieldSelector<M, I>>>;
  color?: string | ((item: I, model: M) => string);
  icon?: string | ((item: I, model: M) => string);
  size?: number | ((item: I, model: M) => number);
};

export function agentLayerOptions<M, I extends object>(
  options: AgentLayerOptions<M, I>,
): LayerOptions<M, I> {
  const { fields, color, icon, size, ...layerOptions } = options;
  const shortcuts = Object.fromEntries(
    (
      [
        ['color', color],
        ['icon', icon],
        ['size', size],
      ] as const
    ).filter(([, value]) => value !== undefined),
  );
  if (layerOptions.project && (fields !== undefined || Object.keys(shortcuts).length > 0)) {
    throw new Error('use project or fields and visual shortcuts, not both');
  }
  for (const name of Object.keys(shortcuts)) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      throw new Error(`visual field declared twice: ${name}`);
    }
  }
  const configured = { ...fields } as Record<string, FieldSelector<M, I>>;
  if (color !== undefined) configured.color = typeof color === 'function' ? color : literal(color);
  if (icon !== undefined) configured.icon = typeof icon === 'function' ? icon : literal(icon);
  if (size !== undefined) configured.size = typeof size === 'function' ? size : literal(size);
  return {
    ...layerOptions,
    type: 'agent',
    ...(fields !== undefined || Object.keys(shortcuts).length > 0
      ? { project: projectFields(configured) }
      : {}),
  };
}

type SourceId = string | number;
type EntrySource<K, V> = ReadonlyMap<K, V> | Readonly<Record<string, V>>;
type FieldConstant =
  | number
  | boolean
  | null
  | Readonly<Record<string, unknown>>
  | LiteralField<unknown>;
export type MapAgentField<M, K, V> =
  | string
  | FieldConstant
  | ((model: M, key: K, value: V) => unknown);
export type MatrixAgentField<M, V> =
  | string
  | FieldConstant
  | ((model: M, row: number, col: number, value: V) => unknown);

function sourceFields(
  fields: Readonly<Record<string, unknown>> | undefined,
  shortcuts: Readonly<Record<string, unknown>>,
  project: unknown,
  roots: readonly string[],
): (context: Record<string, unknown>, args: readonly unknown[]) => ItemRecord {
  if (project !== undefined && (fields !== undefined || Object.keys(shortcuts).length > 0)) {
    throw new Error('use project or fields and visual shortcuts, not both');
  }
  for (const name of Object.keys(shortcuts)) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      throw new Error(`visual field declared twice: ${name}`);
    }
  }
  const allowed = new Set(roots);
  const compiled = [
    ...Object.entries(fields ?? {}).map(([name, spec]) => {
      if (typeof spec === 'string') {
        const hasRoot = /^(?:model|key|value|row|col)(?=\.|\[|$)/.test(spec);
        const selector = hasRoot ? spec : `value.${spec}`;
        const match =
          /^(model|key|value|row|col)((?:\.[A-Za-z_$][\w$]*|\[(?:0|[1-9]\d*)\])*)$/.exec(selector);
        if (!match || !allowed.has(match[1]!))
          throw new Error(`unsupported source selector: ${spec}`);
        const root = match[1]!;
        const path = match[2]!.replace(/^\./, '');
        return [
          name,
          (context: Record<string, unknown>) =>
            path ? readPath(context[root], path) : context[root],
        ] as const;
      }
      if (typeof spec === 'function') {
        return [
          name,
          (_context: Record<string, unknown>, args: readonly unknown[]) => spec(...args),
        ] as const;
      }
      const constant =
        typeof spec === 'object' && spec !== null && 'kind' in spec && spec.kind === 'literal'
          ? (spec as LiteralField<unknown>).value
          : spec;
      return [name, () => constant] as const;
    }),
    ...Object.entries(shortcuts).map(
      ([name, spec]) =>
        [
          name,
          (_context: Record<string, unknown>, args: readonly unknown[]) =>
            typeof spec === 'function' ? spec(...args) : spec,
        ] as const,
    ),
  ];
  return (context, args) =>
    Object.fromEntries(compiled.map(([name, get]) => [name, get(context, args)]));
}

export interface MapAgentLayerOptions<M, K, V> {
  source(model: M): EntrySource<K, V>;
  project?(model: M, key: K, value: V): ItemRecord;
  fields?: Readonly<Record<string, MapAgentField<M, K, V>>>;
  color?: string | ((model: M, key: K, value: V) => string);
  icon?: string | ((model: M, key: K, value: V) => string);
  size?: number | ((model: M, key: K, value: V) => number);
  encodeKey?(key: K): SourceId;
  decodeKey?(id: SourceId): K;
  decodeValue?(value: unknown): V;
  replace?(model: M, values: Map<K, V>): void;
  metadata?: LayerOptions<M>['metadata'];
  revision?(model: M): unknown;
  changes?(
    model: M,
    previousRevision: unknown,
  ): {
    revision: unknown;
    changes: readonly { operation: 'create' | 'update' | 'delete'; key: K }[];
  } | null;
}

const stableId = (id: SourceId): string => {
  if (typeof id === 'string') return `s:${id}`;
  if (!Number.isSafeInteger(id)) throw new Error('map agent IDs must be safe integers or strings');
  return `n:${id}`;
};

export function mapAgentLayerOptions<M, K, V>(
  options: MapAgentLayerOptions<M, K, V>,
): LayerOptions<M> {
  if (Boolean(options.revision) !== Boolean(options.changes)) {
    throw new Error('map source revision and changes must be declared together');
  }
  const encode = options.encodeKey ?? ((key: K) => key as SourceId);
  const decode = options.decodeKey ?? ((id: SourceId) => id as K);
  const decodeValue = options.decodeValue ?? ((value: unknown) => value as V);
  const shortcuts = Object.fromEntries(
    (['color', 'icon', 'size'] as const)
      .filter((name) => options[name] !== undefined)
      .map((name) => [name, options[name]]),
  );
  const configured = sourceFields(options.fields, shortcuts, options.project, [
    'model',
    'key',
    'value',
  ]);
  const entries = (model: M): [K, V][] => {
    const source = options.source(model);
    const pairs =
      source instanceof Map
        ? ([...source.entries()] as [K, V][])
        : (Object.entries(source) as [K, V][]);
    pairs.sort((a, b) => stableId(encode(a[0])).localeCompare(stableId(encode(b[0]))));
    for (let index = 1; index < pairs.length; index++) {
      if (stableId(encode(pairs[index - 1]![0])) === stableId(encode(pairs[index]![0]))) {
        throw new Error('map source has duplicate encoded IDs');
      }
    }
    return pairs;
  };
  const read = (layer: { items?: readonly Record<string, unknown>[] }): Map<K, V> => {
    const result = new Map<K, V>();
    const ids = new Set<string>();
    for (const item of layer.items ?? []) {
      const id = item.id as SourceId;
      const marker = stableId(id);
      if (ids.has(marker)) throw new Error(`duplicate map ID: ${String(id)}`);
      ids.add(marker);
      const key = decode(id);
      if (encode(key) !== id) throw new Error(`noncanonical map ID: ${String(id)}`);
      if (result.has(key)) throw new Error(`duplicate decoded map key: ${String(id)}`);
      const data = item.data;
      if (!data || typeof data !== 'object' || !('value' in data)) {
        throw new Error(`map item ${String(id)} is missing data.value`);
      }
      result.set(key, decodeValue((data as { value: unknown }).value));
    }
    return result;
  };
  const projectEntry = (model: M, key: K, value: V): ItemRecord => {
    const record =
      options.project?.(model, key, value) ??
      configured({ model, key, value }, [model, key, value]);
    const data = record.data;
    if (data !== undefined && (typeof data !== 'object' || data === null || Array.isArray(data))) {
      throw new Error('map agent data must be an object');
    }
    return { ...record, id: encode(key), data: { ...(data as object | undefined), value } };
  };
  return {
    type: 'agent',
    metadata: options.metadata,
    items(model) {
      return entries(model).map(([key, value]) => projectEntry(model, key, value));
    },
    revision: options.revision,
    changes:
      options.changes &&
      ((model, previousRevision): LayerChangeBatch | null => {
        const batch = options.changes!(model, previousRevision);
        if (!batch) return null;
        return {
          revision: batch.revision,
          changes: batch.changes.map((change) => {
            const id = encode(change.key);
            stableId(id);
            if (change.operation === 'delete') return { operation: 'delete', key: id };
            const source = options.source(model);
            const present =
              source instanceof Map
                ? source.has(change.key)
                : Object.prototype.hasOwnProperty.call(source, String(change.key));
            if (!present) throw new Error(`changed map key is absent: ${String(change.key)}`);
            const value =
              source instanceof Map
                ? (source.get(change.key) as V)
                : (source as Record<string, V>)[String(change.key)]!;
            return {
              operation: change.operation,
              key: id,
              record: projectEntry(model, change.key, value),
            };
          }),
        };
      }),
    restore: {
      validate(_model, layer) {
        read(layer);
      },
      replace(model, items) {
        const values = read({ items });
        if (options.replace) {
          options.replace(model, values);
          return;
        }
        const source = options.source(model);
        if (source instanceof Map) {
          source.clear();
          for (const [key, value] of values) source.set(key, value);
        } else {
          const target = source as Record<string, V>;
          for (const key of Object.keys(target)) delete target[key];
          for (const [key, value] of values) target[String(key)] = value;
        }
      },
      restoreMetadata() {},
    },
  };
}

export interface MatrixAgentLayerOptions<M, V> {
  source(model: M): readonly (readonly V[])[] | ArrayLike<V>;
  /** shape is [height, width], with row zero at the top. Required for flat storage. */
  shape?(model: M): readonly [number, number];
  at?(model: M, row: number, col: number): V;
  project?(model: M, row: number, col: number, value: V): ItemRecord;
  fields?: Readonly<Record<string, MatrixAgentField<M, V>>>;
  color?: string | ((model: M, row: number, col: number, value: V) => string);
  icon?: string | ((model: M, row: number, col: number, value: V) => string);
  size?: number | ((model: M, row: number, col: number, value: V) => number);
  decodeValue?(value: unknown): V;
  replace?(model: M, values: V[][]): void;
  restoreMetadata?(model: M, metadata: Record<string, unknown>): void;
  validate?(
    model: M,
    layer: {
      metadata?: Record<string, unknown>;
      items?: Array<Record<string, unknown>>;
    },
  ): void;
  sparseDefault?: V;
  metadata?: LayerOptions<M>['metadata'];
  revision?(model: M): unknown;
  changes?(
    model: M,
    previousRevision: unknown,
  ): {
    revision: unknown;
    changes: readonly { operation: 'create' | 'update' | 'delete'; row: number; col: number }[];
  } | null;
}

export function matrixAgentLayerOptions<M, V>(
  options: MatrixAgentLayerOptions<M, V>,
): LayerOptions<M> {
  if (Boolean(options.revision) !== Boolean(options.changes)) {
    throw new Error('matrix source revision and changes must be declared together');
  }
  const previousShapes = new WeakMap<object, readonly [number, number]>();
  const dimensions = (model: M): readonly [number, number] => {
    const source = options.source(model);
    const shape =
      options.shape?.(model) ??
      (Array.isArray(source) ? ([source.length, source[0]?.length ?? 0] as const) : undefined);
    if (!shape || shape.some((n) => !Number.isSafeInteger(n) || n < 0)) {
      throw new Error('matrix source requires a nonnegative [height, width] shape');
    }
    if (Array.isArray(source) && source.some((row) => row.length !== shape[1])) {
      throw new Error('matrix source must be rectangular');
    }
    return shape;
  };
  const at = (model: M, row: number, col: number): V => {
    if (options.at) return options.at(model, row, col);
    const source = options.source(model);
    if (Array.isArray(source)) return source[row]![col]!;
    const [, width] = dimensions(model);
    return source[row * width + col] as V;
  };
  const decode = options.decodeValue ?? ((value: unknown) => value as V);
  const shortcuts = Object.fromEntries(
    (['color', 'icon', 'size'] as const)
      .filter((name) => options[name] !== undefined)
      .map((name) => [name, options[name]]),
  );
  const configured = sourceFields(options.fields, shortcuts, options.project, [
    'model',
    'key',
    'value',
    'row',
    'col',
  ]);
  const sparse = Object.prototype.hasOwnProperty.call(options, 'sparseDefault');
  const projectCell = (
    model: M,
    row: number,
    col: number,
    value: V,
    height: number,
  ): ItemRecord => {
    const record =
      options.project?.(model, row, col, value) ??
      configured({ model, key: [row, col], row, col, value }, [model, row, col, value]);
    const data = record.data;
    if (data !== undefined && (typeof data !== 'object' || data === null || Array.isArray(data))) {
      throw new Error('matrix agent data must be an object');
    }
    return {
      ...record,
      id: `cell:${row}:${col}`,
      x: col,
      y: height - 1 - row,
      icon: record.icon ?? 'square',
      size: record.size ?? 1,
      data: { ...(data as object | undefined), value },
    };
  };
  const incomingShapes = new WeakMap<object, readonly [number, number]>();
  const read = (
    items: readonly Record<string, unknown>[],
    height: number,
    width: number,
  ): V[][] => {
    const values = Array.from({ length: height }, () =>
      Array<V>(width).fill(options.sparseDefault as V),
    );
    const seen = new Set<string>();
    for (const item of items) {
      const matched = /^cell:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(String(item.id));
      if (!matched) throw new Error('invalid matrix cell ID');
      const row = Number(matched[1]);
      const col = Number(matched[2]);
      const id = `${row}:${col}`;
      if (row >= height || col >= width || seen.has(id))
        throw new Error('duplicate or out-of-bounds matrix cell');
      if (item.x !== col || item.y !== height - 1 - row)
        throw new Error('matrix cell coordinates do not match ID');
      const data = item.data;
      if (!data || typeof data !== 'object' || !('value' in data))
        throw new Error('matrix cell is missing data.value');
      const value = decode((data as { value: unknown }).value);
      if (sparse && Object.is(value, options.sparseDefault))
        throw new Error('sparse default cell must be omitted');
      values[row]![col] = value;
      seen.add(id);
    }
    if (!sparse && seen.size !== height * width) throw new Error('dense matrix is missing cells');
    return values;
  };
  return {
    type: 'agent',
    revision: options.revision,
    changes:
      options.changes &&
      ((model, previousRevision): LayerChangeBatch | null => {
        const [height, width] = dimensions(model);
        const oldShape = previousShapes.get(model as object);
        if (!oldShape || oldShape[0] !== height || oldShape[1] !== width) return null;
        const batch = options.changes!(model, previousRevision);
        if (!batch) return null;
        return {
          revision: batch.revision,
          changes: batch.changes.map((change) => {
            const { row, col } = change;
            if (
              !Number.isSafeInteger(row) ||
              !Number.isSafeInteger(col) ||
              row < 0 ||
              col < 0 ||
              row >= height ||
              col >= width
            )
              throw new Error('changed matrix cell is out of bounds');
            const id = `cell:${row}:${col}`;
            if (change.operation === 'delete') return { operation: 'delete', key: id };
            const value = at(model, row, col);
            if (sparse && Object.is(value, options.sparseDefault))
              return { operation: 'delete', key: id };
            return {
              operation: change.operation,
              key: id,
              record: projectCell(model, row, col, value, height),
            };
          }),
        };
      }),
    metadata(model) {
      const [height, width] = dimensions(model);
      const extra =
        typeof options.metadata === 'function' ? options.metadata(model) : options.metadata;
      return { ...extra, width, height, coord_offset: 'int' };
    },
    items(model) {
      const [height, width] = dimensions(model);
      previousShapes.set(model as object, [height, width]);
      const items: ItemRecord[] = [];
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++) {
          const value = at(model, row, col);
          if (sparse && Object.is(value, options.sparseDefault)) continue;
          items.push(projectCell(model, row, col, value, height));
        }
      return items;
    },
    restore: {
      validate(model, layer) {
        const metadata = layer.metadata;
        const width = metadata?.width;
        const height = metadata?.height;
        if (
          !Number.isSafeInteger(width) ||
          !Number.isSafeInteger(height) ||
          (width as number) < 0 ||
          (height as number) < 0 ||
          metadata?.coord_offset !== 'int'
        ) {
          throw new Error('matrix restore requires width, height, and integer coordinates');
        }
        read(layer.items ?? [], height as number, width as number);
        options.validate?.(model, layer);
        incomingShapes.set(model as object, [height as number, width as number]);
      },
      restoreMetadata(model, metadata) {
        options.restoreMetadata?.(model, metadata);
      },
      replace(model, items) {
        const incomingShape = incomingShapes.get(model as object);
        if (!incomingShape) throw new Error('matrix restore was not validated');
        const [height, width] = incomingShape;
        const values = read(items, height, width);
        if (options.replace) {
          options.replace(model, values);
          return;
        }
        const source = options.source(model);
        const [currentHeight, currentWidth] = dimensions(model);
        if (currentHeight !== height || currentWidth !== width) {
          throw new Error('matrix shape changed; provide replace');
        }
        if (Array.isArray(source)) {
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++) {
              (source as V[][])[row]![col] = values[row]![col]!;
            }
        } else if ('set' in source && typeof source.set === 'function') {
          (source as { set(values: V[]): void }).set(values.flat());
        } else {
          for (let row = 0; row < height; row++)
            for (let col = 0; col < width; col++) {
              (source as { [index: number]: V })[row * width + col] = values[row]![col]!;
            }
        }
      },
    },
  };
}
