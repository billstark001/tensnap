/**
 * runtime/PipelineRuntime.ts
 *
 * Coordinates task scheduling and sync-boundary state through focused
 * sub-components.
 */

import type { StateSyncBoundaryPayload } from '@tensnap/protocol';
import {
  TaskQueue,
  type RuntimeTaskCompletion,
  type RuntimeTaskSnapshot,
  type RuntimeDispatchCommand,
} from './TaskQueue';
import { SyncBoundary, type RuntimeSyncPhase, type RuntimeSyncSnapshot } from './SyncBoundary';

export type RuntimePhase =
  | 'idle'
  | 'syncing'
  | 'queued'
  | 'awaiting-completion'
  | 'awaiting-apply'
  | 'awaiting-render';

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  sync: RuntimeSyncSnapshot;
  queueDepth: number;
  activeTask: RuntimeTaskSnapshot | null;
  queuedTasks: RuntimeTaskSnapshot[];
  continuousKeys: string[];
  pendingCommands: RuntimeDispatchCommand[];
}

export interface PipelineRuntimeOptions {
  now?: () => number;
  idFactory?: () => string;
}

export class PipelineRuntime {
  private readonly q: TaskQueue;
  private readonly syncBoundary: SyncBoundary;

  constructor(options: PipelineRuntimeOptions = {}) {
    const now = options.now ?? (() => performance.now());
    const idFactory = options.idFactory ?? (() => crypto.randomUUID());

    this.q = new TaskQueue(now, idFactory);
    this.syncBoundary = new SyncBoundary();
  }

  // #region Sync boundary

  requestStateSync(requestId?: string): void {
    this.syncBoundary.requestSync(requestId);
  }

  recordStateSyncBoundary(
    phase: 'begin' | 'end',
    payload: StateSyncBoundaryPayload = {},
  ): boolean {
    return this.syncBoundary.recordBoundary(phase, payload, () => {
      this.q.maybeDispatchNext();
    });
  }

  // #endregion

  // #region Task lifecycle

  enqueue(key: string, options: { continuous?: boolean } = {}): string {
    const id = this.q.enqueue(key, options);
    if (this.syncBoundary.isIdle) {
      this.q.maybeDispatchNext();
    }
    return id;
  }

  cancel(key?: string): void {
    this.q.cancel(key);
  }

  reset(): void {
    this.q.reset();
    this.syncBoundary.reset();
  }

  completeTask(taskId: string, completion: RuntimeTaskCompletion = {}): boolean {
    return this.q.completeTask(taskId, completion);
  }

  markTaskApplied(taskId: string): boolean {
    return this.q.markTaskApplied(taskId);
  }

  markTaskRendered(taskId: string): boolean {
    return this.q.markTaskRendered(
      taskId,
      (key) => {
        this.q.enqueue(key, { continuous: true });
        if (this.syncBoundary.isIdle) {
          this.q.maybeDispatchNext();
        }
      },
      () => {
        if (this.syncBoundary.isIdle) {
          this.q.maybeDispatchNext();
        }
      },
    );
  }

  /**
   * Cancel a 'dispatched' active task whose action_start has NOT been sent.
   */
  cancelPendingDispatch(taskId: string): boolean {
    const cancelled = this.q.cancelPendingDispatch(taskId);
    if (cancelled && this.syncBoundary.isIdle) {
      this.q.maybeDispatchNext();
    }
    return cancelled;
  }

  // #endregion

  // #region Command access

  consumeCommands(): RuntimeDispatchCommand[] {
    return this.q.consumeCommands();
  }

  takeNextDispatchTask(): RuntimeTaskSnapshot | null {
    return this.q.takeNextDispatchTask();
  }

  // #endregion

  // #region Snapshot / Query

  getSnapshot(): RuntimeSnapshot {
    const queueSnap = this.q.getSnapshot();
    return {
      phase: this.getPhase(),
      sync: this.syncBoundary.getSnapshot(),
      queueDepth: queueSnap.queueDepth,
      activeTask: queueSnap.activeTask,
      queuedTasks: queueSnap.queuedTasks,
      continuousKeys: queueSnap.continuousKeys,
      pendingCommands: queueSnap.pendingCommands,
    };
  }

  hasContinuousKey(key: string): boolean {
    return this.q.hasContinuousKey(key);
  }

  getContinuousKeys(): string[] {
    return this.q.getContinuousKeys();
  }

  getContinuousKeyCount(): number {
    return this.q.getContinuousKeyCount();
  }

  peekActiveTaskRef(): RuntimeTaskSnapshot | null {
    return this.q.peekActiveTaskRef();
  }

  peekActiveTask(): RuntimeTaskSnapshot | null {
    return this.q.peekActiveTask();
  }

  /** Lightweight accessor — avoids the full-snapshot clone in hot paths. */
  getSyncPhase(): RuntimeSyncPhase {
    return this.syncBoundary.phase;
  }

  /** Lightweight accessor — avoids the full-snapshot clone in hot paths. */
  getSyncRequestId(): string | null {
    return this.syncBoundary.requestId;
  }

  // #endregion

  private getPhase(): RuntimePhase {
    if (!this.syncBoundary.isIdle) {
      return 'syncing';
    }

    const activeTask = this.q.peekActiveTaskRef();
    if (activeTask !== null) {
      const { stage } = activeTask;
      if (stage === 'dispatched') return 'awaiting-completion';
      if (stage === 'completed') return 'awaiting-apply';
      return 'awaiting-render';
    }

    if (this.q.queueLength > 0) {
      return 'queued';
    }

    return 'idle';
  }
}
