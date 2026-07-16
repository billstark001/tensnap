/**
 * runtime/SyncBoundary.ts
 *
 *
 * Tracks the state_sync protocol handshake: requestId, phase
 * (idle | requested | receiving), and begin/end boundary recording.
 * Contains no task-queue or metrics logic.
 */

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

  /**
   * Starts one state-sync handshake. A pending or receiving handshake is
   * deliberately left untouched: v0.3 transactions are non-nestable.
   */
  requestSync(requestId: string): boolean {
    if (!requestId || !this.isIdle) return false;
    this.sync = {
      requestId,
      phase: 'requested',
    };
    return true;
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
    payload: { request_id: string },
    onEndIdle?: () => void,
  ): boolean {
    if (!this.matchesRequest(payload.request_id)) {
      return false;
    }

    if (phase === 'begin') {
      if (this.sync.phase !== 'requested') return false;
      this.sync = { ...this.sync, phase: 'receiving' };
      return true;
    }

    if (this.sync.phase !== 'receiving') return false;
    this.sync = createIdleSyncState();
    onEndIdle?.();
    return true;
  }

  /** Abort a requested or receiving sync after a correlated simulator error. */
  abort(requestId: string, onIdle?: () => void): boolean {
    if (!this.matchesRequest(requestId)) return false;
    this.sync = createIdleSyncState();
    onIdle?.();
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

  private matchesRequest(requestId: string): boolean {
    if (this.sync.requestId === null) {
      return false;
    }
    return requestId === this.sync.requestId;
  }
}
