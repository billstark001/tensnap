import { describe, expect, it, vi } from 'vitest';
import type { RuntimeTaskSnapshot } from './PipelineRuntime';
import {
  BrowserRunRenderBarrier,
  type BrowserRunRenderOptions,
  type BrowserRunTimingHost,
} from './BrowserRunRenderBarrier';

const taskAt = (dispatchedAt: number): RuntimeTaskSnapshot => ({
  id: 'tick-1',
  key: 'step',
  continuous: true,
  stage: 'applied',
  enqueuedAt: dispatchedAt,
  dispatchedAt,
  completedAt: dispatchedAt,
  appliedAt: dispatchedAt,
  renderedAt: null,
  continueRequested: true,
});

class FakeTimingHost implements BrowserRunTimingHost {
  nowValue = 0;
  readonly timeoutDelays: number[] = [];
  readonly timeoutCallbacks: Array<() => void> = [];
  readonly rafCallbacks: Array<(timestamp: number) => void> = [];

  now(): number {
    return this.nowValue;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    this.timeoutDelays.push(delayMs);
    this.timeoutCallbacks.push(callback);
    return this.timeoutCallbacks.length;
  }

  requestAnimationFrame(callback: (timestamp: number) => void): unknown {
    this.rafCallbacks.push(callback);
    return this.rafCallbacks.length;
  }

  fireTimeout(): void {
    const callback = this.timeoutCallbacks.shift();
    const delay = this.timeoutDelays.shift();
    if (!callback || delay === undefined) throw new Error('No timeout is pending.');
    this.nowValue += delay;
    callback();
  }

  fireAnimationFrame(timestamp: number): void {
    const callback = this.rafCallbacks.shift();
    if (!callback) throw new Error('No animation frame is pending.');
    this.nowValue = timestamp;
    callback(timestamp);
  }
}

describe('BrowserRunRenderBarrier', () => {
  it('uses timeout scheduling and enforces Max TPS', async () => {
    const host = new FakeTimingHost();
    host.nowValue = 102;
    const barrier = new BrowserRunRenderBarrier(() => ({
      mode: 'setTimeout',
      maxTps: 100,
      maxRenderFps: 120,
    }), host);
    const resolved = vi.fn();

    void barrier.wait(taskAt(100)).then(resolved);

    expect(host.timeoutDelays).toEqual([8]);
    expect(host.rafCallbacks).toHaveLength(0);
    expect(resolved).not.toHaveBeenCalled();
    host.fireTimeout();
    await Promise.resolve();
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('only frame-locks when requestAnimationFrame is selected', async () => {
    const host = new FakeTimingHost();
    const barrier = new BrowserRunRenderBarrier(() => ({
      mode: 'requestAnimationFrame',
      maxTps: 100,
      maxRenderFps: 120,
    }), host);
    const resolved = vi.fn();

    void barrier.wait(taskAt(0)).then(resolved);
    expect(host.timeoutCallbacks).toHaveLength(0);

    host.fireAnimationFrame(5);
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();

    host.fireAnimationFrame(10);
    await Promise.resolve();
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('auto mode switches from timeout to rAF after measuring a suitable cadence', async () => {
    const host = new FakeTimingHost();
    let options: BrowserRunRenderOptions = {
      mode: 'auto',
      maxTps: 300,
      maxRenderFps: 120,
    };
    const barrier = new BrowserRunRenderBarrier(() => options, host);

    const first = barrier.wait(taskAt(0));
    expect(host.timeoutCallbacks).toHaveLength(1);
    host.fireTimeout();
    await first;

    // The first callback starts calibration; six intervals produce a stable
    // 60 Hz estimate without placing the high-TPS run on rAF.
    for (let frame = 1; frame <= 7; frame += 1) {
      host.fireAnimationFrame(frame * 16);
    }

    options = { ...options, maxTps: 30 };
    const timeoutCount = host.timeoutCallbacks.length;
    const secondResolved = vi.fn();
    void barrier.wait(taskAt(host.nowValue)).then(secondResolved);

    expect(host.timeoutCallbacks).toHaveLength(timeoutCount);
    host.fireAnimationFrame(host.nowValue + 16);
    await Promise.resolve();
    expect(secondResolved).not.toHaveBeenCalled();
    host.fireAnimationFrame(host.nowValue + 17.5);
    await Promise.resolve();
    expect(secondResolved).toHaveBeenCalledOnce();
  });

  it('reads updated settings for every completed tick', () => {
    const host = new FakeTimingHost();
    let options: BrowserRunRenderOptions = {
      mode: 'setTimeout',
      maxTps: 0,
      maxRenderFps: 0,
    };
    const barrier = new BrowserRunRenderBarrier(() => options, host);

    void barrier.wait(taskAt(0));
    expect(host.timeoutCallbacks).toHaveLength(1);

    options = { ...options, mode: 'requestAnimationFrame' };
    void barrier.wait(taskAt(0));
    expect(host.rafCallbacks).toHaveLength(1);
  });
});
