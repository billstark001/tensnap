import { ChartScene, type ChartTheme } from './ChartScene';
import type { ChartConfig, ChartDataPoint } from './types';

/** Browser host for the shared ChartScene. */
export class BrowserChartView {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly scene: ChartScene;
  private width = 1;
  private height = 1;
  private theme: ChartTheme = 'light';
  private hoverPosition: { x: number; y: number } | null = null;

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const bounds = this.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    this.hoverPosition = {
      x: (event.clientX - bounds.left) * (this.width / bounds.width),
      y: (event.clientY - bounds.top) * (this.height / bounds.height),
    };
    this.render();
  };

  private readonly handlePointerLeave = (): void => {
    this.hoverPosition = null;
    this.render();
  };

  constructor(private readonly container: HTMLElement, config: ChartConfig) {
    this.scene = new ChartScene(config);
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.context = this.canvas.getContext('2d')!;
    container.replaceChildren(this.canvas);
  }

  updateData(data: ChartDataPoint[]): void {
    this.scene.updateData(data);
    this.render();
  }

  updateConfig(config: ChartConfig): void {
    this.scene.updateConfig(config);
    this.render();
  }

  updateTheme(theme: ChartTheme): void {
    this.theme = theme;
    this.render();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.render();
  }

  async getCanvasBlob(type = 'image/png', quality?: number): Promise<Blob | null> {
    return await new Promise((resolve) => this.canvas.toBlob(resolve, type, quality));
  }

  destroy(): void {
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.container.replaceChildren();
  }

  private render(): void {
    const ratio = window.devicePixelRatio || 1;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.scene.render(this.context, this.canvas.width, this.canvas.height, { theme: this.theme, pixelRatio: ratio });
    this.drawTooltip();
  }

  private drawTooltip(): void {
    if (!this.hoverPosition) return;
    const tooltip = this.scene.getTooltipAt(this.hoverPosition.x, this.width);
    if (!tooltip) return;

    this.context.save();
    const colors = this.theme === 'dark'
      ? { background: 'rgba(15, 23, 42, 0.96)', border: '#334155', title: '#94a3b8', text: '#f8fafc', divider: '#334155' }
      : { background: 'rgba(255, 255, 255, 0.98)', border: '#cbd5e1', title: '#64748b', text: '#0f172a', divider: '#e2e8f0' };
    const paddingX = 10;
    const paddingY = 8;
    const rowHeight = 20;
    const headerHeight = 18;
    const markerSize = 7;

    this.context.font = '600 11px system-ui, sans-serif';
    const titleWidth = this.context.measureText('Time').width;
    const timeText = formatTooltipValue(tooltip.x);
    const timeWidth = this.context.measureText(timeText).width;
    this.context.font = '12px system-ui, sans-serif';
    const labelWidth = Math.max(...tooltip.values.map((value) => this.context.measureText(value.label).width));
    const valueWidth = Math.max(...tooltip.values.map((value) => this.context.measureText(formatTooltipValue(value.value)).width));
    const tooltipWidth = Math.max(
      titleWidth + timeWidth + paddingX * 2 + 20,
      markerSize + 7 + labelWidth + valueWidth + paddingX * 2 + 14,
    );
    const tooltipHeight = paddingY * 2 + headerHeight + 1 + tooltip.values.length * rowHeight;
    const maxLeft = Math.max(4, this.width - tooltipWidth - 4);
    const maxTop = Math.max(4, this.height - tooltipHeight - 4);
    const left = Math.min(maxLeft, Math.max(4, this.hoverPosition.x + 14));
    const top = Math.min(maxTop, Math.max(4, this.hoverPosition.y + 14));

    this.context.shadowColor = 'rgba(15, 23, 42, 0.24)';
    this.context.shadowBlur = 10;
    this.context.shadowOffsetY = 3;
    drawRoundedRect(this.context, left, top, tooltipWidth, tooltipHeight, 6);
    this.context.fillStyle = colors.background;
    this.context.fill();
    this.context.shadowColor = 'transparent';
    this.context.strokeStyle = colors.border;
    this.context.lineWidth = 1;
    this.context.stroke();

    this.context.textAlign = 'left';
    this.context.textBaseline = 'middle';
    this.context.font = '600 11px system-ui, sans-serif';
    this.context.fillStyle = colors.title;
    this.context.fillText('Time', left + paddingX, top + paddingY + headerHeight / 2);
    this.context.textAlign = 'right';
    this.context.fillStyle = colors.text;
    this.context.fillText(timeText, left + tooltipWidth - paddingX, top + paddingY + headerHeight / 2);

    this.context.fillStyle = colors.divider;
    this.context.fillRect(left + paddingX, top + paddingY + headerHeight, tooltipWidth - paddingX * 2, 1);

    this.context.font = '12px system-ui, sans-serif';
    tooltip.values.forEach((value, index) => {
      const y = top + paddingY + headerHeight + 1 + rowHeight * index + rowHeight / 2;
      this.context.fillStyle = value.color;
      this.context.fillRect(left + paddingX, y - markerSize / 2, markerSize, markerSize);
      this.context.fillStyle = colors.text;
      this.context.textAlign = 'left';
      this.context.fillText(value.label, left + paddingX + markerSize + 7, y);
      this.context.textAlign = 'right';
      this.context.fillText(formatTooltipValue(value.value), left + tooltipWidth - paddingX, y);
    });
    this.context.restore();
  }
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function formatTooltipValue(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toPrecision(6)).toString();
}
