import { z } from 'zod';

/**
 * Protocol-level chart types describe series identity and updates only. Chart
 * rendering config, layouts, and UI-specific storage live in renderer packages.
 */
export const ChartMetadataSchema = z.object({
  id: z.string(),
  label: z.string(),
  color: z.string().optional(),
});

export type ChartMetadata = z.infer<typeof ChartMetadataSchema>;

export const ChartGroupMetadataSchema = ChartMetadataSchema.extend({
  dataList: z.array(ChartMetadataSchema).optional(),
});

export type ChartGroupMetadata = z.infer<typeof ChartGroupMetadataSchema>;

export const ChartUpdateDataSchema = z.object({
  id: z.string(),
  time: z.number().optional(),
  value: z.unknown(),
});

export type ChartUpdateData = z.infer<typeof ChartUpdateDataSchema>;

export const ChartUpdateOperationSchema = z.object({
  id: z.string(),
  operation: z.literal('clear'),
});

export type ChartUpdateOperation = z.infer<typeof ChartUpdateOperationSchema>;
