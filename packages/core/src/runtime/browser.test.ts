import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererToSimulatorMessage } from '../protocol';
import { SimulationLoopController } from './browser';

const createMessage = (id: string, continuous?: boolean, tickId?: string): RendererToSimulatorMessage => ({
  type: 'action_start',
  payload: {
    id,
    continue: continuous,
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

    controller.syncStateSync({ requestId: 'sync-1', phase: 'requested' });
    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: {
        id: 'start',
        tick_id: tickId,
        continue: true,
      },
    }));

    await vi.runAllTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    controller.syncStateSync({ requestId: null, phase: 'idle' });

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
});
