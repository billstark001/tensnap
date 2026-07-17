import { z } from 'zod';

/** Protocol-level chart metadata. Layout and painting remain renderer-local. */
export const ChartMetadataSchema = z.object({
  /** Stable group or series identity. */
  id: z.string().min(1),
  /** Display label; renderer layout remains local state. */
  label: z.string(),
  color: z.string().optional(),
}).strict();
export type ChartMetadata = z.infer<typeof ChartMetadataSchema>;

/** A chart group and its optional named series. */
export const ChartGroupMetadataSchema = ChartMetadataSchema.extend({
  /** Series defined by this group. Omission denotes a single-series group. */
  data_list: z.array(ChartMetadataSchema).optional(),
}).strict();
export type ChartGroupMetadata = z.infer<typeof ChartGroupMetadataSchema>;

/** One incremental point for a chart group or series. */
export const ChartUpdateDataSchema = z.object({
  /** Group or series identity. */
  id: z.string().min(1),
  /** Series time; omitted values use the renderer's current scenario time. */
  time: z.number().optional(),
  /** Chart-domain value appended or merged at `time`; same-time writes are last-write-wins. */
  value: z.unknown(),
}).strict();
export type ChartUpdateData = z.infer<typeof ChartUpdateDataSchema>;

const ClearAllChartOperationSchema = z.object({
  operation: z.literal('clear'),
  kind: z.literal('all'),
}).strict();
const ClearSelectedChartOperationSchema = z.object({
  operation: z.literal('clear'),
  kind: z.enum(['group', 'series']),
  id: z.string().min(1),
}).strict();
const TruncateAllChartOperationSchema = z.object({
  operation: z.literal('truncate'),
  kind: z.literal('all'),
  time: z.number(),
  inclusive: z.boolean(),
}).strict();
const TruncateSelectedChartOperationSchema = z.object({
  operation: z.literal('truncate'),
  kind: z.enum(['group', 'series']),
  id: z.string().min(1),
  time: z.number(),
  inclusive: z.boolean(),
}).strict();

/**
 * An explicit clear or truncate operation; bare IDs never imply a target kind.
 * Inclusive truncation removes points whose time is at least the boundary;
 * exclusive truncation removes only points after it.
 */
export const ChartUpdateOperationSchema = z.union([
  ClearAllChartOperationSchema,
  ClearSelectedChartOperationSchema,
  TruncateAllChartOperationSchema,
  TruncateSelectedChartOperationSchema,
]);
export type ChartUpdateOperation = z.infer<typeof ChartUpdateOperationSchema>;
