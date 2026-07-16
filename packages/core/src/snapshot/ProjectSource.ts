import { Scenario } from '../scenario';
import { SnapshotPlayer } from './SnapshotRecorder';
import type { Snapshot, SnapshotFrame } from './types';

/**
 * The source selected by a project. Snapshots are intentionally a first-class
 * source, rather than a mode layered onto a live simulator connection.
 */
export type ProjectSource =
  | { kind: 'inmemory'; model_id: string }
  | { kind: 'websocket'; url: string }
  | { kind: 'snapshot'; snapshot_id: string };

export type SnapshotPlaybackState = 'paused' | 'playing';

/** Built-in controls available to a snapshot-backed project source. */
export const SNAPSHOT_PLAYBACK_ACTIONS = ['start', 'step', 'stop', 'reset'] as const;

/**
 * Deterministic snapshot source controller. It never sends protocol actions:
 * custom simulator actions are unavailable while a snapshot is the source.
 */
export class SnapshotPlaybackSource {
  readonly player: SnapshotPlayer;
  private state: SnapshotPlaybackState = 'paused';
  /** Monotonic replay cursor; avoids scanning the full recording per tick. */
  private frameCursor = 0;

  constructor(readonly snapshot: Snapshot) {
    this.player = new SnapshotPlayer(snapshot);
    this.resetFrameCursor();
  }

  get playbackState(): SnapshotPlaybackState {
    return this.state;
  }

  get frame(): number {
    return this.player.frame;
  }

  get scenario(): Scenario {
    return this.player.scenario;
  }

  start(): Scenario {
    this.state = 'playing';
    return this.scenario;
  }

  stop(): Scenario {
    this.state = 'paused';
    return this.scenario;
  }

  /**
   * Advances to the next recorded frame and returns only the delta to apply to
   * an already-loaded renderer Scenario. Seeking/resetting remains available
   * for the explicitly non-hot paths.
   */
  stepFrame(): SnapshotFrame | null {
    // `player` is public for inspection/explicit seeking. Recompute only if a
    // caller moved it backwards; normal playback advances this cursor O(1).
    if (this.frameCursor > 0 && this.snapshot.frames[this.frameCursor - 1]!.index > this.player.frame) {
      this.resetFrameCursor();
    }
    while (this.frameCursor < this.snapshot.frames.length
      && this.snapshot.frames[this.frameCursor]!.index <= this.player.frame) {
      this.frameCursor += 1;
    }
    const next = this.snapshot.frames[this.frameCursor];
    if (!next) return null;
    this.player.seek(next.index);
    this.frameCursor += 1;
    return structuredClone(next);
  }

  step(): Scenario {
    this.stepFrame();
    return this.scenario;
  }

  reset(): Scenario {
    this.state = 'paused';
    const scenario = this.player.seek(this.snapshot.initial.frame);
    this.resetFrameCursor();
    return scenario;
  }

  seek(frame: number): Scenario {
    const scenario = this.player.seek(frame);
    this.resetFrameCursor();
    return scenario;
  }

  private resetFrameCursor(): void {
    let low = 0;
    let high = this.snapshot.frames.length;
    const frame = this.player.frame;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.snapshot.frames[middle]!.index <= frame) low = middle + 1;
      else high = middle;
    }
    this.frameCursor = low;
  }
}
