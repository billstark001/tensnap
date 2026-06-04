/**
 * runtime/browser.ts
 *
 * Browser-only runtime entry point. Re-exports SimulationLoopController and
 * related types from the implementation module.
 *
 * Consumers that do not run in a browser (headless tests, Node simulator
 * hosts) should NOT import this entry; use `@tensnap/core/runtime` instead.
 */

export {
  SimulationLoopController,
  createIdleLoopState,
} from './simulation-loop';

export type {
  RenderTriggerMode,
  StateSyncPhase,
  StateSyncStatus,
  ActionStartFactory,
  MessageSender,
  ActionEventSource,
  RuntimeMetrics,
  SimulationLoopState,
  ActionTimeoutEvent,
} from './simulation-loop';
