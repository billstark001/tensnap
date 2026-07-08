import { z } from 'zod';

/**
 * Parameters describe mutable simulator configuration exposed to the renderer.
 * Actions are intentionally separate in protocol v0.2: they have their own
 * lifecycle and renderer-driven continuous loop semantics.
 */
export const ParameterTypeSchema = z.enum(['number', 'enum', 'boolean', 'string']);

export type ParameterType = z.infer<typeof ParameterTypeSchema>;

export const ParameterBaseSchema = z.object({
  id: z.string(),
  type: ParameterTypeSchema,
  label: z.string(),
  allowRuntimeChange: z.boolean().optional(),
});

export type ParameterBase = z.infer<typeof ParameterBaseSchema>;

export const NumberParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('number'),
  value: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
});

export type NumberParameter = z.infer<typeof NumberParameterSchema>;

export const EnumParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('enum'),
  value: z.string(),
  options: z.array(z.string()),
  labels: z.record(z.string(), z.string()).optional(),
});

export type EnumParameter = z.infer<typeof EnumParameterSchema>;

export const BooleanParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('boolean'),
  value: z.boolean(),
});

export type BooleanParameter = z.infer<typeof BooleanParameterSchema>;

export const StringParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('string'),
  value: z.string(),
});

export type StringParameter = z.infer<typeof StringParameterSchema>;

export const ParameterSchema = z.union([
  NumberParameterSchema,
  EnumParameterSchema,
  BooleanParameterSchema,
  StringParameterSchema,
]);

export type Parameter = z.infer<typeof ParameterSchema>;

export const ActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  continuous: z.boolean().optional(),
  allowRuntimeChange: z.boolean().optional(),
});

/** A renderer-visible command exposed by the simulator. */
export type Action = z.infer<typeof ActionSchema>;
