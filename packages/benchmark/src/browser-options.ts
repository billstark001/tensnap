import type {
  BrowserBenchmarkRunOptions,
  ResolvedBrowserBenchmarkRunOptions,
} from './browser-types';

const RENDER_TRIGGER_MODES = new Set(['auto', 'setTimeout', 'requestAnimationFrame']);

function nonNegativeInteger(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

/**
 * Resolve profile-level browser scheduling options once, before a replicate
 * starts. The rAF default preserves the historical action-to-frame metric.
 */
export function resolveBrowserBenchmarkRunOptions(
  options: BrowserBenchmarkRunOptions | undefined,
): ResolvedBrowserBenchmarkRunOptions {
  if (options !== undefined && (typeof options !== 'object' || options === null || Array.isArray(options))) {
    throw new Error('browserOptions must be an object.');
  }
  const renderTriggerMode = options?.renderTriggerMode ?? 'requestAnimationFrame';
  if (!RENDER_TRIGGER_MODES.has(renderTriggerMode)) {
    throw new Error('browserOptions.renderTriggerMode must be auto, setTimeout, or requestAnimationFrame.');
  }
  return {
    renderTriggerMode,
    maxTps: nonNegativeInteger(options?.maxTps, 'browserOptions.maxTps', 0),
    maxRenderFps: nonNegativeInteger(options?.maxRenderFps, 'browserOptions.maxRenderFps', 0),
  };
}
