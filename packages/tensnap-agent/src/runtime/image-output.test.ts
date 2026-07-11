import { describe, expect, it } from 'vitest';
import { buildImageOutputPath, imageMimeType } from './image-output';

describe('image output helpers', () => {
  it('adds the selected extension when an explicit path omits one', () => {
    expect(buildImageOutputPath('/captures', 'population', 'chart-population', 'jpeg', 'reports/chart', false))
      .toBe('reports/chart.jpg');
  });

  it('adds multi-artifact suffixes to the basename only', () => {
    expect(buildImageOutputPath('/captures', 'wealth / total', 'chart', 'png', 'reports/charts.png', true))
      .toBe('reports/charts-wealth-total.png');
  });

  it('maps render formats to image MIME types', () => {
    expect(imageMimeType('png')).toBe('image/png');
    expect(imageMimeType('jpeg')).toBe('image/jpeg');
  });
});
