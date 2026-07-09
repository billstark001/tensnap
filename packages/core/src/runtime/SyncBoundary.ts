/**
 * runtime/SyncBoundary.ts
 *
 *
 * Tracks the state_sync protocol handshake: requestId, phase
 * (idle | requested | receiving), and begin/end boundary recording.
 * Contains no task-queue or metrics logic.
 */

import type { StateSyncBoundaryPayload } from '@tensnap/protocol';

export type RuntimeSyncPhase = 'idle' | 'requested' | 'receiving';

export interface RuntimeSyncSnapshot {
  requestId: string | null;
  phase: RuntimeSyncPhase;
}

const createIdleSyncState = (): RuntimeSyncSnapshot => ({
  requestId: null,
  phase: 'idle',
});

export class SyncBoundary {
  private sync: RuntimeSyncSnapshot = createIdleSyncState();

  reset(): void {
    this.sync = createIdleSyncState();
  }

  requestSync(requestId?: string): void {
    this.sync = {
      requestId: requestId ?? null,
      phase: 'requested',
    };
  }

  /**
   * Record a state_sync begin or end boundary.
   * Returns `true` if the boundary matched the current request and was applied;
   * `false` if the request_id didn't match (boundary discarded).
   *
   * @param onEndIdle - Callback invoked when the 'end' boundary transitions
   *   sync back to idle. The caller (PipelineRuntime) can then trigger
   *   maybeDispatchNext.
   */
  recordBoundary(
    phase: 'begin' | 'end',
    payload: StateSyncBoundaryPayload = {},
    onEndIdle?: () => void,
  ): boolean {
    if (!this.matchesRequest(payload.request_id)) {
      return false;
    }

    if (phase === 'begin') {
      this.sync = { ...this.sync, phase: 'receiving' };
      return true;
    }

    this.sync = createIdleSyncState();
    onEndIdle?.();
    return true;
  }

  // #region Lightweight accessors

  get phase(): RuntimeSyncPhase {
    return this.sync.phase;
  }

  get requestId(): string | null {
    return this.sync.requestId;
  }

  get isIdle(): boolean {
    return this.sync.phase === 'idle';
  }

  getSnapshot(): RuntimeSyncSnapshot {
    return { ...this.sync };
  }

  // #endregion

  private matchesRequest(requestId?: string): boolean {
    if (this.sync.requestId === null) {
      return false;
    }
    return requestId === undefined || requestId === this.sync.requestId;
  }
}
