import { Scenario } from '../scenario/Scenario';
import type { RecordingStoreReader } from './recording-store';

/** Asynchronous offline playback. One reader/generation belongs to exactly one tab. */
export class RecordingPlayback {
  readonly scenario = new Scenario();
  private selection = 0;
  private controller?: AbortController;
  private frameValue: number;
  private closed = false;
  constructor(
    readonly reader: RecordingStoreReader,
    private readonly dispose?: () => void | Promise<void>,
  ) {
    this.frameValue = reader.root.firstFrame;
  }
  get frame() {
    return this.frameValue;
  }
  get activeHistoryRange() {
    return { from: this.frameValue, to: this.frameValue };
  }
  async seek(frame: number, signal?: AbortSignal): Promise<Scenario> {
    if (this.closed) throw new Error('Recording playback is closed.');
    const selection = ++this.selection;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const captured = await this.reader.readFrame(frame, {
        history: 'active',
        signal: controller.signal,
      });
      if (controller.signal.aborted || this.closed || selection !== this.selection)
        throw new Error('Recording seek cancelled.');
      this.scenario.load(captured.scene);
      this.frameValue = frame;
      return this.scenario;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  async step(signal?: AbortSignal): Promise<Scenario | undefined> {
    const location = await this.reader.nextLocation(this.frameValue);
    return location ? this.seek(location.frame!, signal) : undefined;
  }
  reset(signal?: AbortSignal) {
    return this.seek(this.reader.root.firstFrame, signal);
  }
  async close() {
    if (!this.closed) {
      this.closed = true;
      this.selection++;
      this.controller?.abort();
      try {
        await this.reader.close();
      } finally {
        await this.dispose?.();
      }
    }
  }
}
