import { z } from 'zod';
import { decodeBinaryString } from '@tensnap/protocol';
import {
  AgentRefSchema,
  FieldPathSchema,
  compileFieldPath,
  type QueryItem,
} from '../scenario/query';
import type { CapturedFrame } from './CapturedFrame';

export const ComparisonPolicySchema = z
  .object({
    objects: z
      .array(
        z.discriminatedUnion('kind', [
          AgentRefSchema.extend({ kind: z.literal('agent') }).strict(),
          z
            .object({ kind: z.literal('layer'), environmentId: z.string(), layerId: z.string() })
            .strict(),
          z
            .object({ kind: z.enum(['monitor', 'parameter', 'chart', 'action']), id: z.string() })
            .strict(),
          z.object({ kind: z.literal('metadata') }).strict(),
        ]),
      )
      .max(256)
      .optional(),
    fields: z.array(FieldPathSchema).max(64).optional(),
    ignore: z.array(FieldPathSchema).max(64).default([]),
    absoluteTolerance: z.number().nonnegative().default(0),
    relativeTolerance: z.number().nonnegative().default(0),
  })
  .strict();
export type ComparisonPolicy = z.input<typeof ComparisonPolicySchema>;
export interface SceneChange {
  ref?: QueryItem['ref'];
  path: string[];
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
  selected: boolean;
  ignored: boolean;
  withinTolerance: boolean;
}
function binaryEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function prefix(prefix: string[], path: string[]): boolean {
  return prefix.length <= path.length && prefix.every((part, i) => path[i] === part);
}
/** Exact type-aware equality, including ordered arrays and binary values. */
export function exactValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Uint8Array || b instanceof Uint8Array)
    return a instanceof Uint8Array && b instanceof Uint8Array && binaryEqual(a, b);
  if (
    !a ||
    !b ||
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        exactValueEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    )
  );
}
export function diffCapturedFrames(
  left: CapturedFrame,
  right: CapturedFrame,
  input: ComparisonPolicy = {},
  options: { limit?: number; offset?: number } = {},
) {
  const policy = ComparisonPolicySchema.parse(input);
  const limit = options.limit ?? 1000;
  const offset = options.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 10000 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error('Invalid diff page.');
  const fields = policy.fields?.map(compileFieldPath);
  const ignored = policy.ignore.map(compileFieldPath);
  const changes: SceneChange[] = [];
  let changeCount = 0;
  let selectedChangeCount = 0;
  const visit = (
    a: unknown,
    b: unknown,
    path: string[],
    ref?: QueryItem['ref'],
    hasA = true,
    hasB = true,
  ): void => {
    if (hasA === hasB && exactValueEqual(a, b)) return;
    if (
      hasA &&
      hasB &&
      a &&
      b &&
      typeof a === 'object' &&
      typeof b === 'object' &&
      !(a instanceof Uint8Array) &&
      !(b instanceof Uint8Array) &&
      Array.isArray(a) === Array.isArray(b)
    ) {
      if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length)
        visit(a.length, b.length, [...path, 'length'], ref);
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
        visit(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
          [...path, key],
          ref,
          Object.prototype.hasOwnProperty.call(a, key),
          Object.prototype.hasOwnProperty.call(b, key),
        );
      return;
    }
    const objectSelected =
      policy.objects === undefined ||
      policy.objects.some((object) =>
        object.kind === 'metadata'
          ? path[0] === 'metadata'
          : ref &&
            Object.entries(object).every(
              ([key, value]) => (ref as Record<string, unknown>)[key] === value,
            ),
      );
    const selected =
      objectSelected &&
      (fields === undefined || fields.some((p) => prefix(p, path) || prefix(path, p)));
    const ignore = ignored.some((p) => prefix(p, path));
    const magnitude =
      typeof a === 'number' && typeof b === 'number' ? Math.max(Math.abs(a), Math.abs(b)) : 0;
    const tolerance =
      hasA &&
      hasB &&
      typeof a === 'number' &&
      typeof b === 'number' &&
      Number.isFinite(a) &&
      Number.isFinite(b) &&
      // Normalize before subtraction/multiplication so finite extremes cannot become Infinity <= Infinity.
      (magnitude === 0 ||
        Math.abs(a / magnitude - b / magnitude) <=
          policy.absoluteTolerance / magnitude + policy.relativeTolerance);
    if (selected && !ignore && !tolerance) selectedChangeCount++;
    if (changeCount >= offset && changes.length < limit)
      changes.push({
        ref,
        path,
        kind: !hasA ? 'added' : !hasB ? 'removed' : 'changed',
        ...(hasA ? { before: structuredClone(a) } : {}),
        ...(hasB ? { after: structuredClone(b) } : {}),
        selected,
        ignored: ignore,
        withinTolerance: tolerance,
      });
    changeCount++;
  };
  const entities = <T>(
    a: readonly T[],
    b: readonly T[],
    path: string[],
    key: (value: T) => string,
    reference?: (value: T) => QueryItem['ref'],
  ) => {
    const before = new Map(a.map((value) => [key(value), value]));
    const after = new Map(b.map((value) => [key(value), value]));
    for (const id of new Set([...before.keys(), ...after.keys()])) {
      const old = before.get(id),
        next = after.get(id);
      visit(old, next, [...path, id], reference?.((next ?? old)!), before.has(id), after.has(id));
    }
  };
  visit(left.scene.metadata, right.scene.metadata, ['metadata']);
  for (const kind of ['monitors', 'parameters', 'charts', 'actions'] as const)
    entities(
      left.scene[kind] as Array<{ id: string }>,
      right.scene[kind] as Array<{ id: string }>,
      [kind],
      (v) => v.id,
      (v) => ({
        kind:
          kind === 'monitors'
            ? 'monitor'
            : kind === 'parameters'
              ? 'parameter'
              : kind === 'charts'
                ? 'chart'
                : 'action',
        id: v.id,
      }),
    );
  // Environment/layer collections and agent identity are typed sets. Arrays inside an entity stay ordered.
  const envs = new Map(left.scene.environments.map((e) => [e.id, e]));
  const rightEnvs = new Map(right.scene.environments.map((e) => [e.id, e]));
  for (const id of new Set([...envs.keys(), ...rightEnvs.keys()])) {
    const a = envs.get(id),
      b = rightEnvs.get(id);
    if (!a || !b) {
      visit(a, b, ['environments', id], undefined, !!a, !!b);
      continue;
    }
    visit(a.type, b.type, ['environments', id, 'type']);
    const layers = new Map(a.layers.map((l) => [l.id, l]));
    const rightLayers = new Map(b.layers.map((l) => [l.id, l]));
    for (const layerId of new Set([...layers.keys(), ...rightLayers.keys()])) {
      const old = layers.get(layerId),
        next = rightLayers.get(layerId);
      const path = ['environments', id, 'layers', layerId];
      const ref = { kind: 'layer' as const, environmentId: id, layerId };
      if (!old || !next) {
        visit(old, next, path, ref, !!old, !!next);
        continue;
      }
      visit(old.layerType, next.layerType, [...path, 'layerType'], ref);
      visit(old.metadata, next.metadata, [...path, 'metadata'], ref);
      visit(old.dependencyLayerIds, next.dependencyLayerIds, [...path, 'dependencyLayerIds'], ref);
      if (old.layerType === 'agent' && next.layerType === 'agent') {
        const agents = (value: unknown) =>
          (value as { agents: Array<{ id: string | number }> }).agents;
        entities(
          agents(old.storageSnapshot),
          agents(next.storageSnapshot),
          [...path, 'agents'],
          (v) => JSON.stringify([typeof v.id, v.id]),
          (v) => ({ kind: 'agent', environmentId: id, layerId, agentId: v.id }),
        );
      } else visit(old.storageSnapshot, next.storageSnapshot, [...path, 'storageSnapshot'], ref);
    }
  }
  visit(left.scene.logs, right.scene.logs, ['logs']);
  visit(left.scene.assets, right.scene.assets, ['assets']);
  const identityCompatible =
    left.modelIdentity?.model_id === right.modelIdentity?.model_id &&
    left.modelIdentity?.state_schema_version === right.modelIdentity?.state_schema_version;
  const checkpointEqual =
    left.checkpoint && right.checkpoint
      ? left.checkpoint.encoding === right.checkpoint.encoding &&
        binaryEqual(
          typeof left.checkpoint.data === 'string'
            ? decodeBinaryString(left.checkpoint.data).bytes
            : left.checkpoint.data,
          typeof right.checkpoint.data === 'string'
            ? decodeBinaryString(right.checkpoint.data).bytes
            : right.checkpoint.data,
        )
      : undefined;
  return {
    version: 1 as const,
    left: structuredClone(left.source),
    right: structuredClone(right.source),
    exactSceneEqual: exactValueEqual(left.scene, right.scene),
    selectedEqual:
      identityCompatible &&
      checkpointEqual !== false &&
      !!left.checkpoint === !!right.checkpoint &&
      selectedChangeCount === 0,
    identityCompatible,
    checkpointEqual,
    policy,
    changes,
    changeCount,
    selectedChangeCount,
    complete: offset === 0 && changeCount <= limit,
    ...(offset + changes.length < changeCount ? { continuation: offset + changes.length } : {}),
  };
}
