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

  constructor(private readonly container: HTMLElement, config: ChartConfig) {
    this.scene = new ChartScene(config);
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
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
    this.container.replaceChildren();
  }

  private render(): void {
    const ratio = window.devicePixelRatio || 1;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.scene.render(this.context, this.canvas.width, this.canvas.height, { theme: this.theme, pixelRatio: ratio });
  }
}
