import { z } from 'zod';
import type { AgentRef } from './ScenarioInspector';

const id = z.string().min(1);
const agentId = z.union([id, z.number()]);
export const AgentRefSchema = z.object({ environmentId: id, layerId: id, agentId }).strict();
export const AgentInspectionRequestSchema = z
  .object({
    ref: AgentRefSchema,
    radius: z.number().positive().finite().optional(),
    render: z.boolean().optional(),
  })
  .strict();
const pathPart = z.union([z.string().max(256), z.number().int().nonnegative()]);
export const FieldPathSchema = z
  .union([z.string().max(2048), z.array(pathPart).max(32)])
  .superRefine((value, context) => {
    try {
      compileFieldPath(value);
    } catch (error) {
      context.addIssue({ code: 'custom', message: String(error) });
    }
  });
export type FieldPath = z.infer<typeof FieldPathSchema>;

/** Bounded own-property paths. JSON Pointer escaping follows RFC 6901. */
export function compileFieldPath(input: FieldPath): string[] {
  if (typeof input === 'string' && input !== '' && !input.startsWith('/'))
    throw new Error('Fields must be path arrays or JSON Pointers.');
  if (typeof input === 'string' && /~(?:[^01]|$)/.test(input))
    throw new Error('Invalid JSON Pointer escape.');
  const parts =
    typeof input === 'string'
      ? input === ''
        ? []
        : input
            .slice(1)
            .split('/')
            .map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
      : input.map(String);
  if (parts.length > 32 || parts.some((p) => ['__proto__', 'prototype', 'constructor'].includes(p)))
    throw new Error('Unsafe or excessively deep field path.');
  return parts;
}
export function readField(
  value: unknown,
  path: readonly string[],
): { found: boolean; value?: unknown } {
  let current = value;
  for (const part of path) {
    if (
      !current ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, part)
    )
      return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}
const selector = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('agent'), ref: AgentRefSchema }).strict(),
  z
    .object({
      kind: z.literal('neighbors'),
      ref: AgentRefSchema,
      radius: z.number().positive().finite(),
    })
    .strict(),
  z.object({ kind: z.literal('monitor'), id: id.optional() }).strict(),
  z.object({ kind: z.literal('parameter'), id: id.optional() }).strict(),
  z.object({ kind: z.literal('chart'), id: id.optional() }).strict(),
  z.object({ kind: z.literal('layer'), environmentId: id, layerId: id.optional() }).strict(),
  z.object({ kind: z.literal('metadata') }).strict(),
  z
    .object({
      kind: z.literal('cell'),
      environmentId: id,
      layerId: id,
      x: z.number(),
      y: z.number(),
    })
    .strict(),
]);
export const ScenarioQuerySchema = z
  .object({
    selector,
    fields: z.array(FieldPathSchema).min(1).max(64).optional(),
    limit: z.number().int().min(1).max(1000).default(100),
    cursor: z.string().max(16384).optional(),
  })
  .strict();
export type ScenarioQuery = z.input<typeof ScenarioQuerySchema>;
export interface QueryLocation {
  sourceId: string;
  revision: string | number;
  kind: 'live' | 'recording';
  frame?: number;
  modelTime?: number;
  actionRequestId?: string;
  generation?: number;
}
export interface QueryItem {
  ref:
    | { kind: string; id?: string }
    | ({ kind: 'agent' } & AgentRef)
    | { kind: 'layer'; environmentId: string; layerId: string };
  value?: unknown;
  fields?: Array<{ path: string[]; found: boolean; value?: unknown }>;
}
export interface ScenarioQueryResult {
  version: 1;
  location: QueryLocation;
  found: boolean;
  count: number;
  items: QueryItem[];
  truncated: boolean;
  cursor?: string;
}
