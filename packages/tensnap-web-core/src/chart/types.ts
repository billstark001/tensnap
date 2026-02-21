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

export interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}

export interface ChartGroupMetadata extends ChartMetadata {
  dataList?: ChartMetadata[];
}

export interface NativeDataPoint {
  time: number;
  [key: string]: any;
}

export interface ChartGroup {
  id: string;
  label: string;
  metadataDict: Record<string, ChartMetadata>;
  data: NativeDataPoint[];
}
export interface ChartUpdateData {
  id: string;
  time?: number;
  value: any;
}
