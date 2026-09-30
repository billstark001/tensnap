import { describe, expect, it } from 'vitest';
import { resolveBrowserBenchmarkRunOptions } from './browser-options';

describe('browser benchmark run options', () => {
  it('preserves the historical rAF defaults', () => {
    expect(resolveBrowserBenchmarkRunOptions(undefined)).toEqual({
      renderTriggerMode: 'requestAnimationFrame',
      maxTps: 0,
      maxRenderFps: 0,
    });
  });

  it('accepts an uncapped timeout-throughput mode', () => {
    expect(resolveBrowserBenchmarkRunOptions({ renderTriggerMode: 'setTimeout' })).toEqual({
      renderTriggerMode: 'setTimeout',
      maxTps: 0,
      maxRenderFps: 0,
    });
  });

  it('rejects invalid scheduling settings', () => {
    expect(() => resolveBrowserBenchmarkRunOptions('setTimeout' as never)).toThrow('browserOptions must be an object');
    expect(() => resolveBrowserBenchmarkRunOptions({ renderTriggerMode: 'invalid' as never })).toThrow(
      'browserOptions.renderTriggerMode',
    );
    expect(() => resolveBrowserBenchmarkRunOptions({ maxTps: -1 })).toThrow('browserOptions.maxTps');
  });
});
