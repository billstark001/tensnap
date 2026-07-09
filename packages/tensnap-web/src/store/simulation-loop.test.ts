import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererToSimulatorMessage } from '@tensnap/protocol';
import { SimulationLoopController } from '@tensnap/core/runtime/browser';

const createMessage = (id: string, continuous?: boolean, tickId?: string): RendererToSimulatorMessage => ({
  type: 'action_start',
  payload: {
    id,
    continuous,
    tick_id: tickId,
  },
});

describe('SimulationLoopController', () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    vi.useFakeTimers();
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 0);
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((handle: number) => {
      window.clearTimeout(handle);
    }) as typeof window.cancelAnimationFrame;
  });

  afterEach(() => {
    vi.useRealTimers();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it('does not double-dispatch when retained by multiple hooks', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const releaseA = controller.retain();
    const releaseB = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'setTimeout',
    });

    controller.requestAction('start', true);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstMessage = sendMessage.mock.calls[0]?.[0] as RendererToSimulatorMessage;
    const tickId = typeof firstMessage.payload === 'object' && firstMessage.payload && 'tick_id' in firstMessage.payload
      ? firstMessage.payload.tick_id as string
      : undefined;

    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: {
        id: 'start',
        tick_id: tickId,
        continue: true,
      },
    }));

    await vi.runAllTimersAsync();

    expect(sendMessage).toHaveBeenCalledTimes(2);

    releaseA();
    releaseB();
  });

  it('re-dispatches without waiting for the next animation frame', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'setTimeout',
    });

    controller.requestAction('start', true);

    const firstMessage = sendMessage.mock.calls[0]?.[0] as RendererToSimulatorMessage;
    const tickId = typeof firstMessage.payload === 'object' && firstMessage.payload && 'tick_id' in firstMessage.payload
      ? firstMessage.payload.tick_id as string
      : undefined;

    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: {
        id: 'start',
        tick_id: tickId,
        continue: true,
      },
    }));

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);

    expect(sendMessage).toHaveBeenCalledTimes(2);

    release();
  });

  it('blocks redispatch until state sync completes', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'setTimeout',
    });

    controller.requestAction('start', true);

    const firstMessage = sendMessage.mock.calls[0]?.[0] as RendererToSimulatorMessage;
    const tickId = typeof firstMessage.payload === 'object' && firstMessage.payload && 'tick_id' in firstMessage.payload
      ? firstMessage.payload.tick_id as string
      : undefined;

    controller.syncStateSync({
      requestId: 'sync-1',
      phase: 'requested',
      // autoLayoutOnComplete: false,
    });
    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: {
        id: 'start',
        tick_id: tickId,
        continue: true,
      },
    }));

    await vi.runAllTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    controller.syncStateSync({
      requestId: null,
      phase: 'idle',
      // autoLayoutOnComplete: false,
    });

    await vi.runAllTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(2);

    release();
  });

  it('resets in-flight runtime state so reconnect can dispatch again', () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'setTimeout',
    });

    controller.requestAction('start', true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    controller.reset();
    controller.requestAction('start', true);

    expect(sendMessage).toHaveBeenCalledTimes(2);

    release();
  });

  // ─── rAF deadlock regression tests ────────────────────────────────────────

  it('rAF mode: continuous action dispatches across multiple cycles', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'requestAnimationFrame',
    });

    // Cycle 0: first dispatch is immediate (no timing yet)
    controller.requestAction('start', true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const getTickId = (callIndex: number): string | undefined => {
      const msg = sendMessage.mock.calls[callIndex]?.[0] as RendererToSimulatorMessage;
      const p = msg?.payload;
      return (p && typeof p === 'object' && 'tick_id' in p) ? (p as Record<string, unknown>).tick_id as string : undefined;
    };

    // Cycle 0 → continue, should arm rAF for cycle 1
    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: { id: 'start', tick_id: getTickId(0), continue: true },
    }));
    await Promise.resolve(); // flush render-commit microtask
    await vi.advanceTimersByTimeAsync(0); // fire rAF (fake setTimeout(0))

    expect(sendMessage).toHaveBeenCalledTimes(2);

    // Cycle 1 → continue, should arm rAF for cycle 2
    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: { id: 'start', tick_id: getTickId(1), continue: true },
    }));
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);

    expect(sendMessage).toHaveBeenCalledTimes(3);

    release();
  });

  it('rAF mode: cancel while rAF is armed, then restart dispatches again', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      maxTps: 0,
      mode: 'requestAnimationFrame',
    });

    controller.requestAction('start', true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const getTickId = (callIndex: number): string | undefined => {
      const msg = sendMessage.mock.calls[callIndex]?.[0] as RendererToSimulatorMessage;
      const p = msg?.payload;
      return (p && typeof p === 'object' && 'tick_id' in p) ? (p as Record<string, unknown>).tick_id as string : undefined;
    };

    // action_end → rAF gets armed (but NOT yet fired)
    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: { id: 'start', tick_id: getTickId(0), continue: true },
    }));
    await Promise.resolve(); // flush microtask — rAF is now armed

    // Cancel while rAF is armed
    controller.cancel('start');

    // Restart — should arm a fresh rAF and dispatch
    controller.requestAction('start', true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0); // fire rAF

    // Should have dispatched once (first) + once (restart); the rAF for the
    // cancelled cycle must not block the new arm.
    expect(sendMessage).toHaveBeenCalledTimes(2);

    release();
  });
});
