import { z } from 'zod';
import { ScenarioSnapshotSchema } from '@tensnap/core/persistence';
import type { InspectionResponse } from './agent-inspection-source';
import { SimulatorInfoPayloadSchema } from '@tensnap/protocol';
import { WORKBENCH_COMMANDS } from './commands';

export const AUXILIARY_PROTOCOL_VERSION = 1;
export const AUXILIARY_WINDOW_IDS = ['AgentDetailsDialog', 'SimulatorInfoDialog'] as const;
export type AuxiliaryWindowId = (typeof AUXILIARY_WINDOW_IDS)[number];
export function isAuxiliaryWindowId(id: string): id is AuxiliaryWindowId {
  return AUXILIARY_WINDOW_IDS.some((candidate) => candidate === id);
}
const target = z
  .object({
    environmentId: z.string(),
    layerId: z.string(),
    agentId: z.union([z.string(), z.number().finite()]),
  })
  .strict();
const appearance = z
  .object({ theme: z.enum(['light', 'dark']), locale: z.enum(['en', 'zh', 'ja']) })
  .strict();
export const AuxiliaryStateSchema = z
  .object({
    version: z.literal(AUXILIARY_PROTOCOL_VERSION),
    revision: z.number().int().nonnegative(),
    projectId: z.string().nullable(),
    appearance,
    content: z.discriminatedUnion('id', [
      z
        .object({
          id: z.literal('AgentDetailsDialog'),
          target,
          agentType: z.enum(['2d', 'uniform']),
        })
        .strict(),
      z
        .object({
          id: z.literal('SimulatorInfoDialog'),
          simulatorInfo: SimulatorInfoPayloadSchema.nullable(),
          metadata: z.record(z.string(), z.unknown()),
        })
        .strict(),
    ]),
  })
  .strict();
export type AuxiliaryState = z.infer<typeof AuxiliaryStateSchema>;
const inspection = z
  .object({
    radius: z.number().finite().min(0.5),
    token: z.string().max(200).optional(),
    assets: z
      .record(z.string().max(1024), z.string().max(1024))
      .refine((value) => Object.keys(value).length <= 10000),
  })
  .strict();
/** The complete command surface. No callbacks, services, store methods or DOM events. */
export const AuxiliaryCommandSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('initialize') }).strict(),
  z.object({ method: z.literal('inspect'), request: inspection }).strict(),
  z.object({ method: z.literal('menu'), command: z.enum(WORKBENCH_COMMANDS) }).strict(),
]);
export type AuxiliaryCommand = z.infer<typeof AuxiliaryCommandSchema>;
export const AuxiliaryMessageSchema = z.discriminatedUnion('type', [
  z
    .object({
      version: z.literal(1),
      type: z.literal('request'),
      id: z.string().max(100),
      command: AuxiliaryCommandSchema,
    })
    .strict(),
  z.object({ version: z.literal(1), type: z.literal('cancel'), id: z.string().max(100) }).strict(),
  z.object({ version: z.literal(1), type: z.literal('close') }).strict(),
]);
export type AuxiliaryMessage = z.infer<typeof AuxiliaryMessageSchema>;
export const AuxiliaryResponseSchema = z.union([
  z.object({ version: z.literal(1), id: z.string().max(100), value: z.unknown() }).strict(),
  z.object({ version: z.literal(1), id: z.string().max(100), error: z.string() }).strict(),
]);

/** All objects are tagged, so user data cannot collide with the binary representation. */
export type WindowData =
  | null
  | boolean
  | number
  | string
  | WindowData[]
  | { bytes: number[] }
  | { entries: [string, WindowData][] };
const MAX_PACKET_BYTES = 8 * 1024 * 1024;
export function encodeWindowData(value: unknown): WindowData {
  const visiting = new Set<object>();
  let nodes = 0;
  const encode = (item: unknown, depth: number): WindowData => {
    if (++nodes > 500000 || depth > 100)
      throw new Error('Auxiliary window data exceeds its structural budget.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (item instanceof Uint8Array) {
      if (item.byteLength > MAX_PACKET_BYTES)
        throw new Error('Auxiliary window binary exceeds its packet budget.');
      return { bytes: Array.from(item) };
    }
    if (
      !item ||
      typeof item !== 'object' ||
      (!Array.isArray(item) &&
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null)
    )
      throw new Error('Auxiliary windows accept data only.');
    if (visiting.has(item)) throw new Error('Cyclic auxiliary window data.');
    visiting.add(item);
    try {
      return Array.isArray(item)
        ? item.map((entry) => encode(entry, depth + 1))
        : {
            entries: Object.entries(item)
              .filter(([, entry]) => entry !== undefined)
              .map(([key, entry]) => [key, encode(entry, depth + 1)]),
          };
    } finally {
      visiting.delete(item);
    }
  };
  const result = encode(value, 0);
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > MAX_PACKET_BYTES)
    throw new Error(
      'Auxiliary window data exceeds the 8 MiB packet budget. The selected inspection contains too much data.',
    );
  return result;
}
export function decodeWindowData(value: unknown): unknown {
  let nodes = 0;
  const decode = (item: unknown, depth: number): unknown => {
    if (++nodes > 500000 || depth > 100) throw new Error('Invalid auxiliary window data.');
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map((entry) => decode(entry, depth + 1));
    if (!item || typeof item !== 'object') throw new Error('Invalid auxiliary window data.');
    const object = item as Record<string, unknown>;
    if (Object.keys(object).length !== 1) throw new Error('Invalid auxiliary window data.');
    if (
      Array.isArray(object.bytes) &&
      object.bytes.length <= MAX_PACKET_BYTES &&
      object.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    )
      return new Uint8Array(object.bytes);
    if (Array.isArray(object.entries))
      return Object.fromEntries(
        object.entries.map((entry) => {
          if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string')
            throw new Error('Invalid auxiliary window data.');
          return [entry[0], decode(entry[1], depth + 1)];
        }),
      );
    throw new Error('Invalid auxiliary window data.');
  };
  return decode(value, 0);
}

export interface AuxiliaryRpc {
  request(command: AuxiliaryCommand, signal?: AbortSignal): Promise<unknown>;
  close(): void;
}

const inspectedAgent = z.object({ id: z.union([z.string(), z.number().finite()]) }).passthrough();
const inspectionBase = {
  ref: target,
  agent: inspectedAgent,
  environmentId: z.string(),
  layerId: z.string(),
  radius: z.number().finite(),
  neighbors: z.array(inspectedAgent),
  neighborCount: z.number().int().nonnegative(),
  edges: z.array(z.unknown()),
};
const viewport = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});
const inspectionResult = z.discriminatedUnion('kind', [
  z.object({ ...inspectionBase, kind: z.literal('spatial'), viewport }),
  z.object({ ...inspectionBase, kind: z.literal('graph'), viewport: viewport.optional() }),
  z.object({
    ...inspectionBase,
    kind: z.literal('none'),
    reason: z.enum(['uniform-environment', 'agent-has-no-position']),
  }),
]);
const inspectionResponse = z.union([
  z.object({ unchanged: z.literal(true) }).strict(),
  z
    .object({
      token: z.string(),
      view: z
        .object({
          inspection: inspectionResult,
          assetHashes: z.record(z.string(), z.string()),
          scene: ScenarioSnapshotSchema,
        })
        .nullable(),
    })
    .strict(),
]);
export function parseInspectionResponse(value: unknown): InspectionResponse {
  return inspectionResponse.parse(value) as InspectionResponse;
}
