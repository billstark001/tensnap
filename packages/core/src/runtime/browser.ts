/**
 * runtime/browser.ts
 *
 * Browser-only runtime entry point.
 *
 * Consumers that do not run in a browser (headless tests, Node simulator
 * hosts) should NOT import this entry; use `@tensnap/core/runtime` instead.
 */

export {
  BrowserRunRenderBarrier,
} from './BrowserRunRenderBarrier';

export type {
  BrowserRunRenderOptions,
  BrowserRunTimingHost,
  RenderTriggerMode,
} from './BrowserRunRenderBarrier';
