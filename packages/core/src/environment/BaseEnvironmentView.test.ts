import type { Leafer } from '@leafer-ui/core';
import { describe, expect, it, vi } from 'vitest';
import { BaseEnvironmentView } from './BaseEnvironmentView';
import type { IResizableLayer } from './host';
import type { IBoundedLayer } from './types';

class TestView extends BaseEnvironmentView {
  resize(width: number, height: number): void {
    this.updateSurfaceSize(width, height);
  }
}

function createView(width: number, height: number) {
  const leafer = { set: vi.fn(), destroy: vi.fn() } as unknown as Leafer;
  return new TestView(leafer, { width, height });
}

function boundsLayer(bounds: { minX: number; minY: number; maxX: number; maxY: number }): IResizableLayer & IBoundedLayer {
  return {
    zIndex: 0,
    defaultZIndex: 0,
    setZIndex: vi.fn(),
    getOriginMode: () => 'center',
    attachToHost: vi.fn(),
    detachFromHost: vi.fn(),
    onViewportChange: vi.fn(),
    reattachTo: vi.fn(),
    destroy: vi.fn(),
    getSceneBounds: () => bounds,
  };
}

describe('BaseEnvironmentView', () => {
  it('keeps constructor and resize dimensions finite', () => {
    const view = createView(Number.NaN, Infinity);
    expect(view.getSurfaceSize()).toEqual({ width: 1, height: 1 });
    view.resize(42.6, -100);
    expect(view.getSurfaceSize()).toEqual({ width: 43, height: 1 });
  });

  it('ignores invalid layer bounds and padding when fitting', () => {
    const view = createView(100, 100);
    view.addLayer(boundsLayer({ minX: 0, minY: 0, maxX: Infinity, maxY: 2 }));
    view.addLayer(boundsLayer({ minX: 10, minY: 20, maxX: 30, maxY: 40 }));
    expect(view.calculateSceneBounds()).toEqual({ minX: 10, minY: 20, maxX: 30, maxY: 40 });
    view.fitToScene({ padding: Number.NaN });
    expect(view.viewport).toEqual({ x: 10, y: 20, width: 20, height: 20 });
    view.fitToScene({ padding: -5 });
    expect(view.viewport).toEqual({ x: 10, y: 20, width: 20, height: 20 });
  });
});
