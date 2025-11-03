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
  width: number;
  height: number;
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
