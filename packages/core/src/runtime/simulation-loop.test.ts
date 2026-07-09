import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererToSimulatorMessage } from '@tensnap/protocol';
import { SimulationLoopController } from './simulation-loop';

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

  it('times out an in-flight action and ignores its late action_end', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const onActionTimeout = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      actionTimeoutMs: 1000,
      maxTps: 0,
      mode: 'setTimeout',
      onActionTimeout,
    });

    controller.requestAction('step');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const firstMessage = sendMessage.mock.calls[0]?.[0] as RendererToSimulatorMessage;
    const firstTickId = typeof firstMessage.payload === 'object' && firstMessage.payload && 'tick_id' in firstMessage.payload
      ? firstMessage.payload.tick_id as string
      : undefined;

    await vi.advanceTimersByTimeAsync(999);
    expect(onActionTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(onActionTimeout).toHaveBeenCalledWith(expect.objectContaining({
      actionId: 'step',
      tickId: firstTickId,
      timeoutMs: 1000,
    }));

    controller.requestAction('step');
    expect(sendMessage).toHaveBeenCalledTimes(2);

    scenario.dispatchEvent(new CustomEvent('action:end', {
      detail: {
        id: 'step',
        tick_id: firstTickId,
        continue: true,
      },
    }));

    await vi.runAllTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(2);

    release();
  });

  it('stops a continuous action after timeout instead of redispatching', async () => {
    const scenario = new EventTarget();
    const sendMessage = vi.fn();
    const onActionTimeout = vi.fn();
    const controller = new SimulationLoopController(scenario);

    const release = controller.retain();
    controller.updateOptions({
      sendMessage,
      createActionStartMessage: createMessage,
      actionTimeoutMs: 1000,
      maxTps: 0,
      mode: 'setTimeout',
      onActionTimeout,
    });

    controller.requestAction('start', true);
    expect(controller.getState().runningActions.has('start')).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(onActionTimeout).toHaveBeenCalledTimes(1);
    expect(controller.getState().runningActions.has('start')).toBe(false);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    release();
  });
});
