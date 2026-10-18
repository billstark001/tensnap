import { z } from 'zod';
import { AgentRefSchema, FieldPathSchema, compileFieldPath } from '../../scenario/query';

const comparison = z.enum(['identity', 'exact']);
const keyFields = z.array(z.string().min(1).max(256)).min(1).max(16);

export const ComparisonPolicySchema = z
  .object({
    comparison: comparison.default('identity'),
    layerComparisons: z
      .array(
        z
          .object({
            environmentId: z.string(),
            layerId: z.string(),
            comparison,
          })
          .strict(),
      )
      .max(256)
      .default([]),
    itemCollections: z
      .array(
        z
          .object({
            layerType: z
              .string()
              .min(1)
              .refine(
                (type) => !['agent', 'edge', 'trajectory', 'grid', 'background'].includes(type),
                'Built-in item identities cannot be redefined.',
              ),
            path: FieldPathSchema,
            keyFields,
          })
          .strict(),
      )
      .max(256)
      .default([]),
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
  .strict()
  .superRefine((policy, context) => {
    const layers = new Set<string>();
    for (const layer of policy.layerComparisons) {
      const key = JSON.stringify([layer.environmentId, layer.layerId]);
      if (layers.has(key))
        context.addIssue({ code: 'custom', message: `Duplicate layer comparison: ${key}` });
      layers.add(key);
    }
    const paths = new Map<string, string[][]>();
    for (const collection of policy.itemCollections) {
      const path = compileFieldPath(collection.path);
      const previous = paths.get(collection.layerType) ?? [];
      if (previous.some((other) => isPrefix(other, path) || isPrefix(path, other)))
        context.addIssue({ code: 'custom', message: 'Item collection paths must not overlap.' });
      if (new Set(collection.keyFields).size !== collection.keyFields.length)
        context.addIssue({ code: 'custom', message: 'Item identity fields must be unique.' });
      previous.push(path);
      paths.set(collection.layerType, previous);
    }
  });

export function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((part, index) => path[index] === part);
}

export type ComparisonPolicy = z.input<typeof ComparisonPolicySchema>;
export type ResolvedComparisonPolicy = z.output<typeof ComparisonPolicySchema>;
export type ComparisonStrategy = ResolvedComparisonPolicy['comparison'];
