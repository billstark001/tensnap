import { Scenario } from '../scenario';
import { SnapshotPlayer } from './SnapshotRecorder';
import type { Snapshot } from './types';

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

  constructor(readonly snapshot: Snapshot) {
    this.player = new SnapshotPlayer(snapshot);
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

  step(): Scenario {
    return this.player.seek(this.player.frame + 1);
  }

  reset(): Scenario {
    this.state = 'paused';
    return this.player.seek(this.snapshot.initial.frame);
  }

  seek(frame: number): Scenario {
    return this.player.seek(frame);
  }
}
