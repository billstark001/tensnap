import { Line, Text, Group, Leafer, Rect, Ellipse } from 'leafer-ui';
import { ChartDataPoint, ChartConfig } from './types';

// Chart rendering class optimized for high-frequency updates
export class LeaferLineChart {
  private app: Leafer | null = null;
  private container: HTMLElement;
  private config: ChartConfig;
  private width: number = 600;
  private height: number = 400;

  private data: ChartDataPoint[] = [];
  private chartGroup: Group | null = null;
  private gridGroup: Group | null = null;
  private axisGroup: Group | null = null;
  private legendGroup: Group | null = null;
  private tooltipGroup: Group | null = null;
  private lineGroups: Map<string, Group> = new Map();
  private dataPointPositions: Map<string, Array<{ x: number; y: number; value: number; time: number }>> = new Map();
  private isDarkMode: boolean = false;

  constructor(container: HTMLElement, config: ChartConfig) {
    this.container = container;
    this.config = config;
    this.isDarkMode = this.detectDarkMode();
    this.initialize();
  }

  // Detect dark mode from body attribute
  private detectDarkMode(): boolean {
    return document.body.getAttribute('data-theme') === 'dark';
  }

  // Update theme and re-render
  public updateTheme(): void {
    const newIsDarkMode = this.detectDarkMode();
    if (newIsDarkMode !== this.isDarkMode) {
      this.isDarkMode = newIsDarkMode;
      this.render();
    }
  }

  // Get theme-aware colors
  private getThemeColors() {
    if (this.isDarkMode) {
      return {
        gridColor: '#404040',
        axisColor: '#cccccc',
        textColor: '#b0b0b0',
        labelColor: '#d0d0d0',
        tooltipBackground: 'rgba(40, 40, 40, 0.95)',
        tooltipBorder: '#888',
        tooltipText: '#e0e0e0',
        highlightFill: '#ff8787',
      };
    } else {
      return {
        gridColor: '#e0e0e0',
        axisColor: '#333333',
        textColor: '#666666',
        labelColor: '#333333',
        tooltipBackground: 'rgba(255, 255, 255, 0.95)',
        tooltipBorder: '#666',
        tooltipText: '#333',
        highlightFill: '#ff6b6b',
      };
    }
  }

  private initialize(): void {
    // Create leafer app instance
    this.app = new Leafer({
      view: this.container,
      width: this.width,
      height: this.height,
    });

    // Create layer groups for organized rendering
    this.gridGroup = new Group();
    this.axisGroup = new Group();
    this.chartGroup = new Group();
    this.legendGroup = new Group();
    this.tooltipGroup = new Group();

    this.app.add(this.gridGroup);
    this.app.add(this.axisGroup);
    this.app.add(this.chartGroup);
    this.app.add(this.legendGroup);
    this.app.add(this.tooltipGroup);

    // Initialize line groups for each configured line
    this.config.lines.forEach(line => {
      const lineGroup = new Group();
      this.chartGroup!.add(lineGroup);
      this.lineGroups.set(line.key, lineGroup);
    });

    // Setup mouse event handlers for tooltip
    if (this.config.showTooltip !== false) {
      this.setupTooltipHandlers();
    }
  }

  // Update chart data (optimized for high-frequency calls)
  public updateData(newData: ChartDataPoint[]): void {
    this.data = newData;
    this.render();
  }

  // Smart tick generation (matplotlib-style)
  private generateSmartTicks(min: number, max: number, maxTicks: number = 6): number[] {
    if (min === max) {
      return [min];
    }

    const range = max - min;

    // Calculate nice step size
    const roughStep = range / (maxTicks - 1);
    const magnitude = Math.floor(Math.log10(roughStep));
    const magnitudePower = Math.pow(10, magnitude);

    // Choose nice step from [1, 2, 5, 10] * 10^magnitude
    const possibleSteps = [1, 2, 5, 10].map(s => s * magnitudePower);
    const niceStep = possibleSteps.find(s => range / s <= maxTicks) || possibleSteps[possibleSteps.length - 1];

    // Generate ticks starting from a nice number
    const niceMin = Math.floor(min / niceStep) * niceStep;
    const niceMax = Math.ceil(max / niceStep) * niceStep;

    const ticks: number[] = [];
    for (let tick = niceMin; tick <= niceMax; tick += niceStep) {
      ticks.push(tick);
    }

    return ticks;
  }

  // Get smart bounds for axis
  private getSmartBounds(min: number, max: number): { min: number; max: number } {
    if (!this.config.smartAxisBounds) {
      return { min, max };
    }

    const ticks = this.generateSmartTicks(min, max);
    if (ticks.length > 0) {
      return { min: ticks[0], max: ticks[ticks.length - 1] };
    }

    return { min, max };
  }

  // Setup tooltip event handlers
  private setupTooltipHandlers(): void {
    if (!this.app) return;

    this.app.on('pointer.move', (e: any) => {
      this.handleMouseMove(e.x, e.y);
    });

    this.app.on('pointer.leave', () => {
      this.hideTooltip();
    });
  }

  // Handle mouse move for tooltip
  private handleMouseMove(mouseX: number, mouseY: number): void {
    if (!this.config.showTooltip) return;

    let closestPoint: { key: string; name: string; x: number; y: number; value: number; time: number; distance: number } | null = null;
    const threshold = 10; // pixels

    this.dataPointPositions.forEach((points, key) => {
      const lineConfig = this.config.lines.find(l => l.key === key);
      if (!lineConfig) return;

      points.forEach(point => {
        const distance = Math.sqrt(Math.pow(point.x - mouseX, 2) + Math.pow(point.y - mouseY, 2));
        if (distance < threshold && (!closestPoint || distance < closestPoint.distance)) {
          closestPoint = {
            key,
            name: lineConfig.name,
            x: point.x,
            y: point.y,
            value: point.value,
            time: point.time,
            distance,
          };
        }
      });
    });

    if (closestPoint) {
      this.showTooltip(closestPoint);
    } else {
      this.hideTooltip();
    }
  }

  // Show tooltip
  private showTooltip(point: { name: string; x: number; y: number; value: number; time: number }): void {
    if (!this.tooltipGroup) return;

    this.tooltipGroup.clear();

    const colors = this.getThemeColors();
    const text = `${point.name}\nTime: ${point.time.toFixed(2)}\nValue: ${point.value.toFixed(3)}`;
    const padding = 8;
    const lineHeight = 14;
    const lines = text.split('\n');

    // Position tooltip (avoid edges)
    let tooltipX = point.x + 15;
    let tooltipY = point.y - 10;

    if (tooltipX + 150 > this.width) {
      tooltipX = point.x - 165;
    }
    if (tooltipY < 0) {
      tooltipY = point.y + 10;
    }

    // Tooltip background
    const background = new Rect({
      x: tooltipX,
      y: tooltipY,
      width: 150,
      height: padding * 2 + lineHeight * lines.length,
      fill: colors.tooltipBackground,
      stroke: colors.tooltipBorder,
      strokeWidth: 1,
      cornerRadius: 4,
    });
    this.tooltipGroup.add(background);

    // Tooltip text
    lines.forEach((line, i) => {
      const label = new Text({
        text: line,
        x: tooltipX + padding,
        y: tooltipY + padding + i * lineHeight,
        fontSize: 11,
        fill: colors.tooltipText,
      });
      this.tooltipGroup!.add(label);
    });

    // Highlight point
    const highlight = new Ellipse({
      x: point.x,
      y: point.y,
      width: 8,
      height: 8,
      fill: colors.highlightFill,
      stroke: this.isDarkMode ? '#ddd' : '#fff',
      strokeWidth: 2,
    });
    this.tooltipGroup.add(highlight);
  }

  // Hide tooltip
  private hideTooltip(): void {
    if (this.tooltipGroup) {
      this.tooltipGroup.clear();
    }
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

    const { padding = {} } = this.config;
    const pad = {
      top: padding.top ?? 20,
      right: padding.right ?? 20,
      bottom: padding.bottom ?? 40,
      left: padding.left ?? 60,
    };

    const chartWidth = this.width - pad.left - pad.right;
    const chartHeight = this.height - pad.top - pad.bottom;

    // Clear previous renders
    this.clearGroups();

    // Calculate data bounds
    const { xMin, xMax, yMin, yMax } = this.calculateBounds();

    // Generate smart ticks for grid and axes
    const xTicks = this.generateSmartTicks(xMin, xMax);
    const yTicks = this.generateSmartTicks(yMin, yMax);

    // Render grid
    if (this.config.showGrid !== false) {
      this.renderGrid(pad, chartWidth, chartHeight, xMin, xMax, yMin, yMax, xTicks, yTicks);
    }

    // Render axes
    if (this.config.showXAxis !== false || this.config.showYAxis !== false) {
      this.renderAxes(pad, chartWidth, chartHeight, xMin, xMax, yMin, yMax, xTicks, yTicks);
    }

    // Render lines
    this.renderLines(pad, chartWidth, chartHeight, xMin, xMax, yMin, yMax);

    // Render legend
    if (this.config.showLegend !== false) {
      this.renderLegend(pad, chartWidth, chartHeight);
    }
  }

  private clearGroups(): void {
    this.gridGroup?.clear();
    this.axisGroup?.clear();
    this.legendGroup?.clear();
    this.lineGroups.forEach(group => group.clear());
    this.dataPointPositions.clear();
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

    // Use smart bounds for endpoints if enabled
    if (this.config.smartAxisBounds) {
      const smartY = this.getSmartBounds(yMin, yMax);
      yMin = smartY.min;
      yMax = smartY.max;

      const smartX = this.getSmartBounds(xMin, xMax);
      xMin = smartX.min;
      xMax = smartX.max;
    } else {
      // Add padding to y-axis bounds
      const yRange = yMax - yMin;
      const yPadding = yRange * 0.1 || 1;
      yMin -= yPadding;
      yMax += yPadding;
    }

    return { xMin, xMax, yMin, yMax };
  }

  private renderGrid(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    chartHeight: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    xTicks: number[],
    yTicks: number[]
  ): void {
    const colors = this.getThemeColors();
    const gridColor = colors.gridColor;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    // Vertical grid lines at x tick positions
    xTicks.forEach(tickValue => {
      if (tickValue >= xMin && tickValue <= xMax) {
        const x = pad.left + ((tickValue - xMin) / xRange) * chartWidth;
        const line = new Line({
          points: [x, pad.top, x, pad.top + chartHeight],
          stroke: gridColor,
          strokeWidth: 1,
        });
        this.gridGroup?.add(line);
      }
    });

    // Horizontal grid lines at y tick positions
    yTicks.forEach(tickValue => {
      if (tickValue >= yMin && tickValue <= yMax) {
        const y = pad.top + chartHeight - ((tickValue - yMin) / yRange) * chartHeight;
        const line = new Line({
          points: [pad.left, y, pad.left + chartWidth, y],
          stroke: gridColor,
          strokeWidth: 1,
        });
        this.gridGroup?.add(line);
      }
    });
  }

  private renderAxes(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    chartHeight: number,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    xTicks: number[],
    yTicks: number[]
  ): void {
    const colors = this.getThemeColors();
    const textColor = colors.textColor;
    const labelColor = colors.labelColor;
    const axisColor = colors.axisColor;
    const fontSize = 10;
    const labelFontSize = 12;
    const xRange = xMax - xMin || 1;
    const yRange = yMax - yMin || 1;

    // X-axis
    if (this.config.showXAxis !== false) {
      const xAxisLine = new Line({
        points: [pad.left, pad.top + chartHeight, pad.left + chartWidth, pad.top + chartHeight],
        stroke: axisColor,
        strokeWidth: 2,
      });
      this.axisGroup?.add(xAxisLine);

      // X-axis labels using smart ticks
      xTicks.forEach(tickValue => {
        if (tickValue >= xMin && tickValue <= xMax) {
          const x = pad.left + ((tickValue - xMin) / xRange) * chartWidth;
          // Format based on magnitude
          const decimals = tickValue === 0 ? 0 : Math.max(0, -Math.floor(Math.log10(Math.abs(tickValue))) + 1);
          const label = new Text({
            text: tickValue.toFixed(Math.min(decimals, 2)),
            x: x - 15,
            y: pad.top + chartHeight + 5,
            fontSize: fontSize,
            fill: textColor,
          });
          this.axisGroup?.add(label);
        }
      });

      // X-axis label and unit
      if (this.config.showXAxisLabel !== false && this.config.xAxisLabel) {
        const labelText = this.config.xAxisUnit
          ? `${this.config.xAxisLabel} (${this.config.xAxisUnit})`
          : this.config.xAxisLabel;
        const xLabel = new Text({
          text: labelText,
          x: pad.left + chartWidth / 2 - 30,
          y: pad.top + chartHeight + 25,
          fontSize: labelFontSize,
          fill: labelColor,
        });
        this.axisGroup?.add(xLabel);
      }
    }

    // Y-axis
    if (this.config.showYAxis !== false) {
      const yAxisLine = new Line({
        points: [pad.left, pad.top, pad.left, pad.top + chartHeight],
        stroke: axisColor,
        strokeWidth: 2,
      });
      this.axisGroup?.add(yAxisLine);

      // Y-axis labels using smart ticks
      yTicks.forEach(tickValue => {
        if (tickValue >= yMin && tickValue <= yMax) {
          const y = pad.top + chartHeight - ((tickValue - yMin) / yRange) * chartHeight;
          // Format based on magnitude
          const decimals = tickValue === 0 ? 0 : Math.max(0, -Math.floor(Math.log10(Math.abs(tickValue))) + 1);
          const label = new Text({
            text: tickValue.toFixed(Math.min(decimals, 2)),
            x: pad.left - 45,
            y: y - 5,
            fontSize: fontSize,
            fill: textColor,
          });
          this.axisGroup?.add(label);
        }
      });

      // Y-axis label and unit (rotated)
      if (this.config.showYAxisLabel !== false && this.config.yAxisLabel) {
        const labelText = this.config.yAxisUnit
          ? `${this.config.yAxisLabel} (${this.config.yAxisUnit})`
          : this.config.yAxisLabel;
        const yLabel = new Text({
          text: labelText,
          x: 10,
          y: pad.top + chartHeight / 2,
          fontSize: labelFontSize,
          fill: labelColor,
          rotation: -90,
        });
        this.axisGroup?.add(yLabel);
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
      const dataPoints: Array<{ x: number; y: number; value: number; time: number }> = [];

      this.data.forEach(point => {
        const value = point[lineConfig.key];
        if (typeof value === 'number') {
          const x = pad.left + ((point.time - xMin) / xRange) * chartWidth;
          const y = pad.top + chartHeight - ((value - yMin) / yRange) * chartHeight;
          points.push(x, y);
          dataPoints.push({ x, y, value, time: point.time });
        }
      });

      // Store data point positions for tooltip
      this.dataPointPositions.set(lineConfig.key, dataPoints);

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

  // Render legend with intelligent wrapping
  private renderLegend(
    pad: { top: number; right: number; bottom: number; left: number },
    chartWidth: number,
    _chartHeight: number
  ): void {
    if (!this.legendGroup) return;

    const colors = this.getThemeColors();
    const itemSpacing = 8;
    const itemHeight = 16;
    const colorBoxSize = 12;
    const colorBoxMargin = 4;

    // Calculate available width for legend
    const availableWidth = chartWidth;
    
    // Measure each legend item width
    const items = this.config.lines.map((lineConfig) => {
      // Approximate text width (rough estimation: char count * 6px)
      const textWidth = lineConfig.name.length * 6.5;
      const itemWidth = colorBoxSize + colorBoxMargin + textWidth + itemSpacing;
      return { lineConfig, itemWidth };
    });

    // Arrange legend items with wrapping
    let currentX = pad.left;
    let currentY = pad.top + 5;
    let currentRowWidth = 0;

    items.forEach(({ lineConfig, itemWidth }) => {
      // Check if we need to wrap to next line
      if (currentRowWidth + itemWidth > availableWidth && currentRowWidth > 0) {
        currentX = pad.left;
        currentY += itemHeight;
        currentRowWidth = 0;
      }

      // Legend color box
      const colorBox = new Rect({
        x: currentX,
        y: currentY,
        width: colorBoxSize,
        height: colorBoxSize,
        fill: lineConfig.color ?? '#8884d8',
      });
      this.legendGroup!.add(colorBox);

      // Legend text
      const text = new Text({
        text: lineConfig.name,
        x: currentX + colorBoxSize + colorBoxMargin,
        y: currentY,
        fontSize: 11,
        fill: colors.labelColor,
      });
      this.legendGroup!.add(text);

      currentX += itemWidth;
      currentRowWidth += itemWidth;
    });
  }

  // Resize chart
  public resize(width: number, height: number): void {
    if (this.app) {
      this.width = width;
      this.height = height;
      this.app.resize({ width, height });
      this.render();
    }
  }

  // Get canvas as blob for clipboard
  public async getCanvasBlob(): Promise<Blob | null> {
    if (!this.app || !this.container) return null;

    try {
      const canvas = this.container.querySelector('canvas');
      if (!canvas) return null;

      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => {
          resolve(blob);
        });
      });
    } catch (error) {
      console.error('Failed to get canvas blob:', error);
      return null;
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
