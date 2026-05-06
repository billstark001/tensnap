/**
 * scenario/browser.ts
 *
 * Browser-only exports for the scenario module.
 *
 * Consumers that do not run in a browser (headless tests, Node simulator
 * hosts) should NOT import this entry; use `@tensnap/core/scenario` instead.
 */

export { EnvironmentRendererController } from './EnvironmentRendererController';
export type { EnvironmentRendererControllerOptions } from './EnvironmentRendererController';
