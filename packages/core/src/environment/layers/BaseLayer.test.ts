import { describe, expect, it } from 'vitest';
import { BaseLayer } from './BaseLayer';
import type { EnvironmentLayerHost, EnvironmentViewFitMode } from '../host';
import type { Viewport } from '../types';

class CoverageProbeLayer extends BaseLayer {
  readonly defaultZIndex = 1;

  onViewportChange(): void {}

  getCoverage(viewport: Viewport, fitMode: EnvironmentViewFitMode): Viewport {
    return this.getCanvasSceneCoverage(viewport, fitMode);
  }
}

function createHost(width: number, height: number): EnvironmentLayerHost {
  return {
    leafer: { add() {}, remove() {} } as never,
    viewport: { x: 0, y: 0, width: 4, height: 4 },
    fitMode: 'contain',
    interactionEnabled: false,
    getSurfaceSize: () => ({ width, height }),
  };
}

describe('BaseLayer canvas scene coverage', () => {
  it('extends the scene rectangle through contain letterboxing', () => {
    const layer = new CoverageProbeLayer();
    layer.attachToHost(createHost(8, 4));

    expect(layer.getCoverage({ x: 0, y: 0, width: 4, height: 4 }, 'contain'))
      .toEqual({ x: -2, y: 0, width: 8, height: 4 });

    layer.destroy();
  });

  it('leaves a stretch viewport unchanged', () => {
    const layer = new CoverageProbeLayer();
    layer.attachToHost(createHost(8, 4));

    expect(layer.getCoverage({ x: 1, y: 2, width: 4, height: 4 }, 'stretch'))
      .toEqual({ x: 1, y: 2, width: 4, height: 4 });

    layer.destroy();
  });
});
