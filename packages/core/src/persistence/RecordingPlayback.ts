import { Scenario } from '../scenario/Scenario';
import type { RecordingStoreReader } from './recording-store';

/** Asynchronous offline playback. One reader/generation belongs to exactly one tab. */
export class RecordingPlayback {
  readonly scenario = new Scenario();
  private selection = 0;
  private controller?: AbortController;
  private frameValue: number;
  private closed = false;
  private closePromise?: Promise<void>;
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
    return (await this.navigate(frame, signal))!;
  }
  private async navigate(
    target: number | (() => Promise<number | undefined>),
    signal?: AbortSignal,
  ): Promise<Scenario | undefined> {
    if (this.closed) throw new Error('Recording playback is closed.');
    const selection = ++this.selection;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abort, { once: true });
    try {
      const assertCurrent = () => {
        if (controller.signal.aborted || this.closed || selection !== this.selection)
          throw new Error('Recording seek cancelled.');
      };
      const frame = typeof target === 'number' ? target : await target();
      assertCurrent();
      if (frame === undefined) return undefined;
      const captured = await this.reader.readFrame(frame, {
        history: 'active',
        signal: controller.signal,
      });
      assertCurrent();
      this.scenario.load(captured.scene);
      this.frameValue = frame;
      return this.scenario;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }
  step(signal?: AbortSignal): Promise<Scenario | undefined> {
    // The index lookup belongs to the same cancellable selection as its frame read.
    return this.navigate(
      async () => (await this.reader.nextLocation(this.frameValue))?.frame,
      signal,
    );
  }
  reset(signal?: AbortSignal) {
    return this.seek(this.reader.root.firstFrame, signal);
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.selection++;
    this.controller?.abort();
    // Release owned URLs synchronously, even when the reader takes time to close.
    const errors: unknown[] = [];
    try {
      this.scenario.reset({ preserveTrajectoryLayers: false });
    } catch (error) {
      errors.push(error);
    }
    this.closePromise = Promise.resolve().then(async () => {
      try {
        await this.reader.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.dispose?.();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw Object.assign(new Error('Recording playback cleanup failed.'), { errors });
    });
    return this.closePromise;
  }
}
