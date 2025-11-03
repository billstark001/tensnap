import { App, Line, Text, Group } from 'leafer-ui';
import { ChartDataPoint, ChartConfig, LineConfig } from './types';

// Chart rendering class optimized for high-frequency updates
export class LeaferLineChart {
  private app: App | null = null;
  private container: HTMLElement;
  private config: ChartConfig;
  private data: ChartDataPoint[] = [];
  private chartGroup: Group | null = null;
  private gridGroup: Group | null = null;
  private axisGroup: Group | null = null;
  private lineGroups: Map<string, Group> = new Map();
  
  constructor(container: HTMLElement, config: ChartConfig) {
    this.container = container;
    this.config = config;
    this.initialize();
  }

  private initialize(): void {
    // Create leafer app instance
    this.app = new App({
      view: this.container,
      width: this.config.width,
      height: this.config.height,
    });

    // Create layer groups for organized rendering
    this.gridGroup = new Group();
    this.axisGroup = new Group();
    this.chartGroup = new Group();
    
    this.app.tree.add(this.gridGroup);
    this.app.tree.add(this.axisGroup);
    this.app.tree.add(this.chartGroup);

    // Initialize line groups for each configured line
    this.config.lines.forEach(line => {
      const lineGroup = new Group();
      this.chartGroup!.add(lineGroup);
      this.lineGroups.set(line.key, lineGroup);
    });
  }

  // Update chart data (optimized for high-frequency calls)
  public updateData(newData: ChartDataPoint[]): void {
    this.data = newData;
    this.render();
  }

  // Update chart configuration
  public updateConfig(newConfig: Partial<ChartConfig>): void {
    this.config = { ...this.config, ...newConfig };
    
    // Handle line config changes
    if (newConfig.lines) {
      // Remove old line groups
      this.lineGroups.forEach(group => {
        this.chartGroup?.remove(group);
      });
      this.lineGroups.clear();
      
      // Create new line groups
      this.config.lines.forEach(line => {
        const lineGroup = new Group();
        this.chartGroup?.add(lineGroup);
        this.lineGroups.set(line.key, lineGroup);
      });
    }
    
    this.render();
  }

  private render(): void {
    if (!this.app || this.data.length === 0) return;

    const { width, height, padding = {} } = this.config;
    const pad = {
      top: padding.top ?? 20,
      right: padding.right ?? 20,
      bottom: padding.bottom ?? 40,
      left: padding.left ?? 60,
    };

    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;

    // Clear previous renders
    this.clearGroups();

    // Calculate data bounds
    const { xMin, xMax, yMin, yMax } = this.calculateBounds();

    // Render grid
    if (this.config.showGrid !== false) {
      this.renderGrid(pad, chartWidth, chartHeight);
    }

    // Render axes
    if (this.config.showXAxis !== false || this.config.showYAxis !== false) {
      this.renderAxes(pad, chartWidth, chartHeight, xMin, xMax, yMin, yMax);
    }

    // Render lines
    this.renderLines(pad, chartWidth, chartHeight, xMin, xMax, yMin, yMax);
  }

  private clearGroups(): void {
    this.gridGroup?.clear();
    this.axisGroup?.clear();
    this.lineGroups.forEach(group => group.clear());
  }

  private calculateBounds(): { xMin: number; xMax: number; yMin: number; yMax: number } {
    if (this.data.length === 0) {
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;

    this.data.forEach(point => {
      xMin = Math.min(xMin, point.time);
      xMax = Math.max(xMax, point.time);

      this.config.lines.forEach(line => {
        const value = point[line.key];
        if (typeof value === 'number') {
          yMin = Math.min(yMin, value);
          yMax = Math.max(yMax, value);
        }
      });
    });

    // Add padding to y-axis bounds
    const yRange = yMax - yMin;
    const yPadding = yRange * 0.1 || 1;
    yMin -= yPadding;
    yMax += yPadding;

    return { xMin, xMax, yMin, yMax };
  }

  private renderGrid(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    chartHeight: number
  ): void {
    const gridLines = 5;
    const gridColor = '#e0e0e0';

    // Vertical grid lines
    for (let i = 0; i <= gridLines; i++) {
      const x = pad.left + (chartWidth / gridLines) * i;
      const line = new Line({
        points: [x, pad.top, x, pad.top + chartHeight],
        stroke: gridColor,
        strokeWidth: 1,
      });
      this.gridGroup?.add(line);
    }

    // Horizontal grid lines
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (chartHeight / gridLines) * i;
      const line = new Line({
        points: [pad.left, y, pad.left + chartWidth, y],
        stroke: gridColor,
        strokeWidth: 1,
      });
      this.gridGroup?.add(line);
    }
  }

  private renderAxes(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    chartHeight: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number
  ): void {
    const textColor = '#666666';
    const fontSize = 10;

    // X-axis
    if (this.config.showXAxis !== false) {
      const xAxisLine = new Line({
        points: [pad.left, pad.top + chartHeight, pad.left + chartWidth, pad.top + chartHeight],
        stroke: '#333333',
        strokeWidth: 2,
      });
      this.axisGroup?.add(xAxisLine);

      // X-axis labels
      const xLabels = 5;
      for (let i = 0; i <= xLabels; i++) {
        const value = xMin + ((xMax - xMin) / xLabels) * i;
        const x = pad.left + (chartWidth / xLabels) * i;
        const label = new Text({
          text: value.toFixed(1),
          x: x,
          y: pad.top + chartHeight + 5,
          fontSize: fontSize,
          fill: textColor,
        });
        this.axisGroup?.add(label);
      }
    }

    // Y-axis
    if (this.config.showYAxis !== false) {
      const yAxisLine = new Line({
        points: [pad.left, pad.top, pad.left, pad.top + chartHeight],
        stroke: '#333333',
        strokeWidth: 2,
      });
      this.axisGroup?.add(yAxisLine);

      // Y-axis labels
      const yLabels = 5;
      for (let i = 0; i <= yLabels; i++) {
        const value = yMax - ((yMax - yMin) / yLabels) * i;
        const y = pad.top + (chartHeight / yLabels) * i;
        const label = new Text({
          text: value.toFixed(2),
          x: pad.left - 45,
          y: y - 5,
          fontSize: fontSize,
          fill: textColor,
        });
        this.axisGroup?.add(label);
      }
    }
  }

  private renderLines(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    chartHeight: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number
  ): void {
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    this.config.lines.forEach((lineConfig) => {
      const lineGroup = this.lineGroups.get(lineConfig.key);
      if (!lineGroup) return;

      const points: number[] = [];
      
      this.data.forEach(point => {
        const value = point[lineConfig.key];
        if (typeof value === 'number') {
          const x = pad.left + ((point.time - xMin) / xRange) * chartWidth;
          const y = pad.top + chartHeight - ((value - yMin) / yRange) * chartHeight;
          points.push(x, y);
        }
      });

      if (points.length >= 4) { // At least 2 points (4 coordinates)
        const line = new Line({
          points: points,
          stroke: lineConfig.color ?? '#8884d8',
          strokeWidth: lineConfig.strokeWidth ?? 2,
        });
        lineGroup.add(line);
      }
    });
  }

  // Resize chart
  public resize(width: number, height: number): void {
    if (this.app) {
      this.config.width = width;
      this.config.height = height;
      this.app.resize({ width, height });
      this.render();
    }
  }

  // Clean up resources
  public destroy(): void {
    if (this.app) {
      this.app.destroy();
      this.app = null;
    }
    this.lineGroups.clear();
  }
}
