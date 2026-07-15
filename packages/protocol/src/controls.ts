import { z } from 'zod';

/** Canonical v0.3 parameter definitions. */
export const ParameterTypeSchema = z.enum(['number', 'enum', 'boolean', 'string']);
export type ParameterType = z.infer<typeof ParameterTypeSchema>;

/** Simulator-owned parameter definition shared by every parameter kind. */
export const ParameterBaseSchema = z.object({
  /** Stable parameter identity; create duplicates and missing updates are errors. */
  id: z.string().min(1),
  /** Discriminator for the value and constraint fields. */
  type: ParameterTypeSchema,
  /** Simulator-provided display label. */
  label: z.string(),
  /** Whether the renderer may issue `param_change` while the model is running. */
  allow_runtime_change: z.boolean().optional(),
}).strict();

/** Numeric parameter with optional inclusive bounds and a positive UI step. */
export const NumberParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('number'),
  value: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
}).strict();

/** String-valued parameter restricted to its declared option set. */
export const EnumParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('enum'),
  value: z.string(),
  options: z.array(z.string()),
  labels: z.record(z.string(), z.string()).optional(),
}).strict();

/** Boolean parameter definition. */
export const BooleanParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('boolean'),
  value: z.boolean(),
}).strict();

/** Free-form string parameter definition. */
export const StringParameterSchema = ParameterBaseSchema.extend({
  type: z.literal('string'),
  value: z.string(),
}).strict();

/** Canonical discriminated union used by `param_create` and `param_update`. */
export const ParameterSchema = z.discriminatedUnion('type', [
  NumberParameterSchema,
  EnumParameterSchema,
  BooleanParameterSchema,
  StringParameterSchema,
]);

export type Parameter = z.infer<typeof ParameterSchema>;
export type ParameterBase = z.infer<typeof ParameterBaseSchema>;
export type NumberParameter = z.infer<typeof NumberParameterSchema>;
export type EnumParameter = z.infer<typeof EnumParameterSchema>;
export type BooleanParameter = z.infer<typeof BooleanParameterSchema>;
export type StringParameter = z.infer<typeof StringParameterSchema>;

/** The most-specific object level an action accepts; omitted action scope is `model`. */
export const ActionScopeSchema = z.enum(['model', 'env', 'layer', 'agent']);
export type ActionScope = z.infer<typeof ActionScopeSchema>;

/** One ordered action argument definition used for renderer UX and binding validation. */
export const ActionKwargDefinitionSchema = z.object({
  /** Key used in `action_invoke.kwargs`. */
  name: z.string().min(1),
  /** Optional renderer-facing label. */
  label: z.string().optional(),
  /** Declared argument kind; `json` is the complex-value escape hatch. */
  type: z.enum(['number', 'integer', 'string', 'boolean', 'enum', 'json']),
  /** Required arguments cannot declare a default. */
  required: z.boolean().optional(),
  /** Simulator-applied value when an optional argument is absent. */
  default: z.unknown().optional(),
  /** Optional numeric lower bound. */
  min: z.number().optional(),
  /** Optional numeric upper bound. */
  max: z.number().optional(),
  /** Optional positive numeric UI increment. */
  step: z.number().positive().optional(),
  /** Required non-empty choice list when `type` is `enum`. */
  options: z.array(z.string()).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.required === true && Object.prototype.hasOwnProperty.call(value, 'default')) {
    ctx.addIssue({ code: 'custom', message: 'A required action kwarg cannot have a default value.', path: ['default'] });
  }
  if (value.type === 'enum' && (!value.options || value.options.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Enum action kwargs require a non-empty options list.', path: ['options'] });
  }
});
export type ActionKwargDefinition = z.infer<typeof ActionKwargDefinitionSchema>;

/** A simulator-owned action definition. Renderer view choices never mutate it. */
export const ActionSchema = z.object({
  /** Stable action identity used by `action_invoke`. */
  id: z.string().min(1),
  /** Simulator-provided display label. */
  label: z.string(),
  /** Most specific target scope this action accepts; omission means model scope. */
  scope: ActionScopeSchema.optional(),
  /** Typed simulator-owned arguments accepted by the action. */
  kwargs: z.array(ActionKwargDefinitionSchema).optional(),
  /** Enables renderer-driven repeated invocation after `should_continue: true`. */
  continuous: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const names = new Set<string>();
  value.kwargs?.forEach((definition, index) => {
    if (names.has(definition.name)) {
      ctx.addIssue({ code: 'custom', message: `Duplicate action kwarg name: ${definition.name}`, path: ['kwargs', index, 'name'] });
    }
    names.add(definition.name);
  });
});

export type Action = z.infer<typeof ActionSchema>;
