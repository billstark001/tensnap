import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserChartView } from './BrowserChartView';

describe('BrowserChartView', () => {
  afterEach(() => vi.restoreAllMocks());

  it('normalizes invalid dimensions and device pixel ratios', () => {
    const context = new Proxy({}, { get: () => vi.fn() }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(window, 'devicePixelRatio', 'get').mockReturnValue(Number.POSITIVE_INFINITY);
    const container = document.createElement('div');
    const view = new BrowserChartView(container, { lines: [] });

    view.resize(Number.NaN, Number.POSITIVE_INFINITY);
    const canvas = container.firstElementChild as HTMLCanvasElement;
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    const sibling = document.createElement('span');
    container.append(sibling);
    view.destroy();
    expect(container.contains(sibling)).toBe(true);
    expect(container.contains(canvas)).toBe(false);
  });
});
