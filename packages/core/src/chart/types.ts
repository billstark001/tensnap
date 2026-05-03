import { z } from 'zod';

// Data types compatible with recharts format
export interface ChartDataPoint {
  time: number;
  [key: string]: number | string;
}

export interface LineConfig {
  key: string;
  name: string;
  color?: string;
  strokeWidth?: number;
}

export interface ChartConfig {
  lines: LineConfig[];
  showGrid?: boolean;
  showXAxis?: boolean;
  showYAxis?: boolean;
  showLegend?: boolean;
  showTooltip?: boolean;
  smartAxisBounds?: boolean; // Enable smart endpoint selection
  xAxisLabel?: string;
  yAxisLabel?: string;
  xAxisUnit?: string;
  yAxisUnit?: string;
  showXAxisLabel?: boolean;
  showYAxisLabel?: boolean;
  padding?: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  };
}

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

export interface ChartSeriesPoint {
  time: number;
  [key: string]: any;
}

export interface ChartGroup {
  id: string;
  label: string;
  metadataDict: Record<string, ChartMetadata>;
  data: ChartSeriesPoint[];
}

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
