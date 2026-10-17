import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '../transport';
import {
  ProtocolValidationError,
  type ProtocolEncoding,
  type RendererToSimulatorMessage,
} from '@tensnap/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeSnapshot, type Snapshot } from '../snapshot';
import { RendererSession } from './RendererSession';
import { compileRunCondition, createRunConditionScope } from './ScenarioConditionScope';

function createTransport(sent: RendererToSimulatorMessage[]): ISimulatorTransport {
  return {
    connectionId: 'test://run-controller',
    transportKind: 'test',
    encoding: 'json' as ProtocolEncoding,
    connectionState: 'open' as TransportConnectionState,
    isConnected: true,
    connect: async () => {},
    disconnect: () => {},
    destroy: () => {},
    on: <K extends keyof TransportEventMap>(
      _type: K,
      _handler: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    off: <K extends keyof TransportEventMap>(
      _type: K,
      _handler?: TransportEventHandler<TransportEventMap[K]>,
    ) => {},
    send: (message) => sent.push(message),
  };
}

function tickId(message: RendererToSimulatorMessage): string {
  const payload = message.payload as { request_id?: string };
  if (!payload.request_id) throw new Error('Expected dispatched action to have a tick id.');
  return payload.request_id;
}

function announce(session: RendererSession): void {
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'test-binding', version: '0.3.0' },
      model: { id: 'test-model' },
      instance_id: 'test-instance',
      capabilities: [],
    },
  });
}

describe('RunController', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects requests without an explicit run mode', () => {
    const session = new RendererSession();
    expect(() => session.run.start({ actionId: 'step', maxSteps: 2 } as never)).toThrow(/mode/);
  });

  it('leaves an active run intact when a replacement request is invalid or premature', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    const original = session.run.start({ mode: 'manual', actionId: 'step' });

    expect(() => session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 0 })).toThrow(
      /positive integer/,
    );
    expect(() => session.run.start({ mode: 'manual', actionId: 'step' })).toThrow(
      /current action tick/,
    );
    expect(session.run.status).toMatchObject({ id: original.id, state: 'running' });
    expect(session.run.status?.stopReason).toBeUndefined();
    expect(sent).toHaveLength(1);
    session.run.reset();
  });

  it('requires request_id to correlate an action result', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.requestAction('step');
    const requestId = tickId(sent[0]!);

    expect(session.run.observeActionResult({ id: 'step' } as never)).toBe(false);
    expect(session.run.observeActionResult({ id: 'step', request_id: 'other' } as never)).toBe(
      false,
    );
    expect(session.run.observeActionResult({ id: 'other', request_id: requestId })).toBe(false);
    expect(session.run.observeActionResult({ id: 'step', request_id: requestId })).toBe(true);
  });

  it('runs at most maxSteps and waits for the host render barrier between steps', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: first, should_continue: true },
    });

    expect(sent).toHaveLength(1);
    expect(session.run.status).toMatchObject({ state: 'running', completedSteps: 1 });

    session.run.markActionRendered({ id: 'step', request_id: first });
    expect(sent).toHaveLength(2);

    const second = tickId(sent[1]!);
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: second, should_continue: true },
    });
    session.run.markActionRendered({ id: 'step', request_id: second });

    expect(sent).toHaveLength(2);
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      completedSteps: 2,
      stopReason: 'max-steps',
    });
  });

  it('stops a continuous run immediately when outgoing validation fails', () => {
    const session = new RendererSession();
    const transport = createTransport([]);
    transport.send = () => {
      throw new ProtocolValidationError('renderer-to-simulator', 'invalid action message', []);
    };
    session.attachTransport(transport);
    announce(session);

    expect(() => session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 10 })).toThrow(
      ProtocolValidationError,
    );
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      stopReason: 'validation-error',
      inFlight: false,
    });
  });

  it('stops a continuous run immediately when inbound validation fails', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const handlers = new Map<keyof TransportEventMap, TransportEventHandler<any>>();
    const transport: ISimulatorTransport = {
      ...createTransport(sent),
      on: (type, handler) => handlers.set(type, handler),
      off: (type) => {
        handlers.delete(type);
      },
    };
    const session = new RendererSession();
    session.attachTransport(transport);
    announce(session);
    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 10 });

    handlers.get('error')?.(
      new ProtocolValidationError('simulator-to-renderer', 'invalid action result', []),
    );

    expect(session.run.status).toMatchObject({
      state: 'stopped',
      stopReason: 'validation-error',
    });
  });

  it('publishes one continuing status update per completed render', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    const onStatus = vi.fn();
    session.addEventListener('run:status', onStatus);
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 3 });
    expect(onStatus).toHaveBeenCalledTimes(1);

    const first = tickId(sent[0]!);
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: first, should_continue: true },
    });
    expect(onStatus).toHaveBeenCalledTimes(1);

    session.run.markActionRendered({ id: 'step', request_id: first });
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it('runs in manual mode without a fake maximum and pauses after the in-flight tick', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    expect(session.run.status).toMatchObject({
      state: 'running',
      spec: { mode: 'manual', actionId: 'start' },
      inFlight: true,
    });

    session.run.pause();
    expect(session.run.status).toMatchObject({
      state: 'running',
      pauseRequested: true,
      inFlight: true,
    });
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'start', request_id: first, should_continue: true },
    });
    expect(session.run.status).toMatchObject({
      state: 'paused',
      stopReason: 'paused',
      completedSteps: 1,
    });
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(sent).toHaveLength(1);
  });

  it('queues one step behind a manual run tick without duplicate dispatch', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    session.run.requestStep('step');
    expect(sent).toHaveLength(1);

    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'start', request_id: first, should_continue: true },
    });
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      type: 'action_invoke',
      payload: { id: 'step', continuous: false },
    });
  });

  it('does not start a second continuous generation before the prior tick renders', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    session.run.pause();
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'start', request_id: first, should_continue: true },
    });

    expect(session.run.status).toMatchObject({ state: 'paused', inFlight: true });
    expect(() => session.run.start({ mode: 'manual', actionId: 'start' })).toThrow(
      /current action tick/,
    );
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(session.run.status).toMatchObject({ state: 'paused', inFlight: false });
    expect(() => session.run.start({ mode: 'manual', actionId: 'start' })).not.toThrow();
    expect(sent).toHaveLength(2);
  });

  it('evaluates a compiled condition against incremental scenario state after action_result', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({
      mode: 'bounded',
      actionId: 'step',
      maxSteps: 9,
      stopWhen: 'steps >= 1 && metadata.population === 3',
    });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'metadata_update', payload: { population: 3 } });
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: first, should_continue: true },
    });

    expect(session.run.status).toMatchObject({
      state: 'stopped',
      completedSteps: 1,
      conditionValue: true,
      stopReason: 'condition',
    });
  });

  it('stops an active bounded run before dispatching an ordinary action', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'start', maxSteps: 10 });
    const pendingRunAction = tickId(sent[0]!);
    session.run.requestAction('step');

    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'stopped' });
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'start', request_id: pendingRunAction, should_continue: true },
    });
    session.run.markActionRendered({ id: 'start', request_id: pendingRunAction });
    expect(sent[sent.length - 1]).toMatchObject({
      type: 'action_invoke',
      payload: { id: 'step', continuous: false },
    });
  });

  it('invokes a declared stop hook after the current action renders', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.scenario.apply({ type: 'action_create', payload: { id: 'stop', label: 'Stop' } });

    session.run.start({ mode: 'manual', actionId: 'step' });
    const stepId = tickId(sent[0]!);
    session.run.stop();
    expect(sent).toHaveLength(1);

    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: stepId, should_continue: true },
    });
    session.run.markActionRendered({ id: 'step', request_id: stepId });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      type: 'action_invoke',
      payload: { id: 'stop', continuous: false },
    });
    const stopId = tickId(sent[1]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'stop', request_id: stopId } });
    session.run.markActionRendered({ id: 'stop', request_id: stopId });
    expect(session.run.status).toMatchObject({ state: 'stopped', inFlight: false });
  });

  it('allows only the documented agent capabilities in stop expressions', () => {
    const session = new RendererSession();
    session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    session.scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', metadata: {} },
    });
    session.scenario.apply({
      type: 'item_create',
      payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 2, y: 4 }] },
    });

    const condition = compileRunCondition(
      'agentCount("main", "agents") === 1 && agent("main", "agents", "a").x === 2',
    );
    expect(condition.evaluate(createRunConditionScope(session.scenario, 7))).toBe(true);
    expect(() => compileRunCondition('metadata.toString()')).toThrow(/Only agent/);
    expect(() => compileRunCondition('metadata.count = 1')).toThrow(/Assignment/);
    expect(() => compileRunCondition('/x/.test("x")')).toThrow();
  });

  it('keeps callable permissions intact after a nested evaluation', () => {
    const condition = compileRunCondition(
      'agentCount("e", "l") === 1 && agentCount("e", "l") === 1',
    );
    const base = createRunConditionScope(new RendererSession().scenario, 0);
    const nested = { ...base, agentCount: () => 1 };
    let calls = 0;
    const outer = {
      ...base,
      agentCount: () => {
        calls += 1;
        if (calls === 1) expect(condition.evaluate(nested)).toBe(true);
        return 1;
      },
    };

    expect(condition.evaluate(outer)).toBe(true);
    expect(calls).toBe(2);
  });

  it('reuses read-only condition views until their source revisions change', () => {
    const session = new RendererSession();
    session.scenario.apply({
      type: 'param_create',
      payload: { id: 'speed', type: 'number', label: 'Speed', value: 2 },
    });
    session.scenario.apply({
      type: 'chart_create',
      payload: { id: 'population', label: 'Population' },
    });
    session.scenario.apply({
      type: 'chart_update',
      payload: { updates: [{ id: 'population', time: 1, value: 10 }] },
    });
    const getData = vi.spyOn(session.scenario.charts, 'getData');

    const first = createRunConditionScope(session.scenario, 1);
    const second = createRunConditionScope(session.scenario, 2);
    expect(second.metadata).toBe(first.metadata);
    expect(second.parameters).toBe(first.parameters);
    expect(second.charts).toBe(first.charts);
    expect(second.charts.population).toBe(10);
    expect(getData).not.toHaveBeenCalled();

    session.scenario.apply({ type: 'metadata_update', payload: { phase: 'next' } });
    session.scenario.apply({
      type: 'chart_update',
      payload: { updates: [{ id: 'population', time: 2, value: 11 }] },
    });
    const updated = createRunConditionScope(session.scenario, 3);
    expect(updated.metadata).not.toBe(first.metadata);
    expect(updated.parameters).toBe(first.parameters);
    expect(updated.charts).not.toBe(first.charts);
    expect(updated.charts.population).toBe(11);
  });

  it('stops a bounded run when its in-flight action times out', async () => {
    vi.useFakeTimers();
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession({ run: { actionTimeoutMs: 10 } });
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);

    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'action-timeout' });
  });

  it('reuses a watchdog during rapid ticks while preserving each tick deadline', async () => {
    vi.useFakeTimers();
    const sent: RendererToSimulatorMessage[] = [];
    const setWatchdog = vi.fn((callback: () => void, delayMs: number) =>
      setTimeout(callback, delayMs),
    );
    const clearWatchdog = vi.fn((handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
    );
    const session = new RendererSession({
      run: {
        actionTimeoutMs: 100,
        scheduler: { now: () => Date.now(), setTimeout: setWatchdog, clearTimeout: clearWatchdog },
      },
    });
    session.attachTransport(createTransport(sent));
    announce(session);
    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 4 });

    for (let index = 0; index < 3; index += 1) {
      await vi.advanceTimersByTimeAsync(5);
      const requestId = tickId(sent[index]!);
      session.handleIncoming({
        type: 'action_result',
        payload: {
          id: 'step',
          request_id: requestId,
          should_continue: true,
        },
      });
      session.run.markActionRendered({ id: 'step', request_id: requestId });
    }

    expect(sent).toHaveLength(4);
    expect(setWatchdog).toHaveBeenCalledTimes(1);
    expect(clearWatchdog).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(85); // The first tick's former deadline.
    expect(session.run.status).toMatchObject({ state: 'running', completedSteps: 3 });
    expect(setWatchdog).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(15); // The fourth tick's own deadline.
    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'action-timeout' });
  });

  it('moves the watchdog earlier when the action timeout is shortened', async () => {
    vi.useFakeTimers();
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession({ run: { actionTimeoutMs: 100 } });
    session.attachTransport(createTransport(sent));
    announce(session);
    session.run.start({ mode: 'manual', actionId: 'step' });

    await vi.advanceTimersByTimeAsync(10);
    session.run.setActionTimeoutMs(20);
    await vi.advanceTimersByTimeAsync(19);
    expect(session.run.status?.state).toBe('running');
    await vi.advanceTimersByTimeAsync(1);
    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'action-timeout' });
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('canvas lost'))],
    [
      'throws',
      () => {
        throw new Error('canvas lost');
      },
    ],
  ])('records a render barrier that %s and stops the affected run', async (_mode, wait) => {
    const sent: RendererToSimulatorMessage[] = [];
    const onRenderBarrierError = vi.fn();
    const session = new RendererSession({
      run: {
        renderBarrier: { wait },
        onRenderBarrierError,
      },
    });
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: first, should_continue: true },
    });
    await vi.waitFor(() => {
      expect(onRenderBarrierError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ id: first }),
        expect.anything(),
      );
    });
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      stopReason: 'render-error',
      renderError: 'canvas lost',
    });
    expect(sent).toHaveLength(1);
  });
});

describe('run outcomes and settlement', () => {
  function setup() {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.handleIncoming({ type: 'metadata_update', payload: { time: 7 } });
    return { session, sent };
  }

  it('keeps failure, quota and pause reasons and counts only matched results once', () => {
    const { session, sent } = setup();
    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    const request_id = tickId(sent[0]!);
    session.run.pause();
    expect(session.run.observeActionResult({ id: 'wrong', request_id })).toBe(false);
    expect(session.run.observeActionResult({ id: 'step', request_id: 'wrong' })).toBe(false);
    const payload = { id: 'step', request_id, error: { code: 'broken', message: 'failed' } };
    expect(session.run.observeActionResult(payload)).toBe(true);
    expect(session.run.observeActionResult(payload)).toBe(false);
    expect(session.run.status).toMatchObject({
      dispatchedActions: 1,
      completedActions: 1,
      completedSteps: 1,
      succeededActions: 0,
      failedActions: 1,
      primaryFailure: 'action-error',
      stopReason: 'action-error',
      settled: false,
      stopReasons: ['action-error', 'paused', 'max-steps'],
      lastAction: { timeBefore: 7, timeAfter: 7, requestId: request_id },
    });
    session.run.markActionRendered(payload);
    expect(session.run.status?.settled).toBe(true);
  });

  it('counts successful actions without a model time advance and preserves summary by ID', async () => {
    const { session, sent } = setup();
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    const waiting = session.run.waitForSettled(run.id);
    const payload = { id: 'step', request_id: tickId(sent[0]!) };
    session.run.observeActionResult(payload);
    session.run.markActionRendered(payload);
    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    expect(await waiting).toMatchObject({
      id: run.id,
      succeededActions: 1,
      failedActions: 0,
      settled: true,
    });
    expect(await session.run.waitForSettled(run.id)).toMatchObject({
      id: run.id,
      lastAction: { timeBefore: 7, timeAfter: 7 },
    });
    session.run.reset();
  });

  it('records the stop lifecycle and waits for both host barriers', async () => {
    const { session, sent } = setup();
    session.scenario.apply({ type: 'action_create', payload: { id: 'stop', label: 'Stop' } });
    const recordings: Snapshot[] = [];
    session.addEventListener('recording:complete', (event) =>
      recordings.push((event as CustomEvent).detail.snapshot),
    );
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} });
    const waiting = session.run.waitForSettled(run.id);
    const step = { id: 'step', request_id: tickId(sent[0]!) };
    session.handleIncoming({ type: 'action_result', payload: step });
    expect(session.run.status?.settled).toBe(false);
    expect(recordings).toHaveLength(0);
    session.run.markActionRendered(step);
    expect(session.run.status?.settled).toBe(false);
    const stop = { id: 'stop', request_id: tickId(sent[1]!) };
    session.handleIncoming({ type: 'metadata_update', payload: { time: 8, stopped: true } });
    session.handleIncoming({ type: 'action_result', payload: stop });
    expect(recordings).toHaveLength(0);
    session.run.markActionRendered(stop);
    expect(await waiting).toMatchObject({
      settled: true,
      completedActions: 1,
      dispatchedActions: 1,
      lastLifecycleAction: { source: 'lifecycle', id: 'stop' },
    });
    expect(recordings).toHaveLength(1);
    expect(recordings[0]!.frames.find((frame) => frame.action?.id === 'stop')?.source).toBe(
      'lifecycle',
    );
    expect(materializeSnapshot(recordings[0]!).metadata).toMatchObject({ time: 8, stopped: true });
    expect(recordings[0]!.frames.flatMap((frame) => frame.controls)).toContainEqual(
      expect.objectContaining({ payload: expect.objectContaining({ id: 'stop' }) }),
    );
  });

  it('reports a final barrier rejection after hitting the quota', async () => {
    const sent: RendererToSimulatorMessage[] = [];
    let rejectBarrier!: (error: Error) => void;
    const barrier = new Promise<void>((_resolve, reject) => {
      rejectBarrier = reject;
    });
    const session = new RendererSession({ run: { renderBarrier: { wait: () => barrier } } });
    session.attachTransport(createTransport(sent));
    announce(session);
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    const waiting = session.run.waitForSettled(run.id);
    session.handleIncoming({
      type: 'action_result',
      payload: { id: 'step', request_id: tickId(sent[0]!) },
    });
    expect(session.run.status).toMatchObject({ stopReason: 'max-steps', settled: false });
    rejectBarrier(new Error('disk/render failed'));
    expect(await waiting).toMatchObject({
      primaryFailure: 'render-error',
      stopReason: 'render-error',
      renderError: 'disk/render failed',
      settled: true,
    });
  });

  it('does not replace condition errors with a simultaneous quota or action result', () => {
    const { session, sent } = setup();
    session.run.start({
      mode: 'bounded',
      actionId: 'step',
      maxSteps: 1,
      stopWhen: 'time > 7 && missing.value',
    });
    session.handleIncoming({ type: 'metadata_update', payload: { time: 8 } });
    const payload = { id: 'step', request_id: tickId(sent[0]!) };
    session.run.observeActionResult(payload);
    expect(session.run.status).toMatchObject({
      stopReason: 'condition-error',
      stopReasons: ['condition-error', 'max-steps'],
    });
    session.run.markActionRendered(payload);
  });

  it('leaves unknown actions uncounted on disconnect and timeout and cleans wait timers', async () => {
    vi.useFakeTimers();
    const { session } = setup();
    const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
    const expired = session.run.waitForSettled(run.id, 5);
    const assertion = expect(expired).rejects.toThrow(/not cancelled/);
    await vi.advanceTimersByTimeAsync(5);
    await assertion;
    expect(session.run.status?.state).toBe('running');
    const waiting = session.run.waitForSettled(run.id);
    session.run.reset('disconnected');
    expect(await waiting).toMatchObject({
      stateKnown: false,
      completedActions: 0,
      failedActions: 0,
      settled: true,
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

it('does not dispatch queued cleanup after an action becomes unknown', async () => {
  vi.useFakeTimers();
  try {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession({ run: { actionTimeoutMs: 10 } });
    session.attachTransport(createTransport(sent));
    announce(session);
    session.scenario.apply({ type: 'action_create', payload: { id: 'stop', label: 'Stop' } });
    const run = session.run.start({ mode: 'manual', actionId: 'step' });
    session.run.stop();
    const waiting = session.run.waitForSettled(run.id);
    await vi.advanceTimersByTimeAsync(10);
    expect(await waiting).toMatchObject({
      settled: true,
      stateKnown: false,
      stopReason: 'action-timeout',
    });
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('closes the old recording before a settled-status listener starts a new run', async () => {
  const sent: RendererToSimulatorMessage[] = [];
  const session = new RendererSession();
  const recordings: Snapshot[] = [];
  session.attachTransport(createTransport(sent));
  announce(session);
  session.addEventListener('recording:complete', (event) =>
    recordings.push((event as CustomEvent).detail.snapshot),
  );
  const first = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} });
  const step = { id: 'step', request_id: tickId(sent[0]!) };
  session.handleIncoming({ type: 'action_result', payload: step });
  session.addEventListener(
    'run:status',
    (event) => {
      const status = (event as CustomEvent).detail;
      if (status.id === first.id && status.settled)
        session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1, record: {} });
    },
    { once: true },
  );
  session.run.markActionRendered(step);
  expect(recordings).toHaveLength(1);
  expect(session.run.status?.id).not.toBe(first.id);
  expect(session.recorder.active).toBe(true);
  const second = { id: 'step', request_id: tickId(sent[1]!) };
  session.handleIncoming({ type: 'action_result', payload: second });
  session.run.markActionRendered(second);
  expect(recordings).toHaveLength(2);
  expect(recordings[0]!.frames[0]!.action?.request_id).toBe(step.request_id);
  expect(recordings[1]!.frames[0]!.action?.request_id).toBe(second.request_id);
});

it('aborts only a run waiter and removes its timer', async () => {
  vi.useFakeTimers();
  try {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    const run = session.run.start({ mode: 'manual', actionId: 'step' });
    const abort = new AbortController();
    const waiting = session.run.waitForSettled(run.id, 30_000, abort.signal);
    const assertion = expect(waiting).rejects.toThrow(/not cancelled/);
    abort.abort();
    await assertion;
    expect(session.run.status?.state).toBe('running');
    expect(sent).toHaveLength(1);
    session.run.reset();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it('finishes a reset before a settled listener can start the next run', () => {
  const sent: RendererToSimulatorMessage[] = [];
  const session = new RendererSession();
  session.attachTransport(createTransport(sent));
  announce(session);
  session.run.requestStateSync('blocked');
  const first = session.run.start({ mode: 'manual', actionId: 'step' });
  expect(sent).toHaveLength(0);
  session.addEventListener(
    'run:settled',
    () => session.run.start({ mode: 'manual', actionId: 'step' }),
    { once: true },
  );
  session.run.reset();
  expect(session.run.status?.id).not.toBe(first.id);
  expect(session.run.status?.state).toBe('running');
  expect(sent).toHaveLength(1);
  expect(session.run.hasInFlightAction).toBe(true);
  session.run.reset();
});

it('keeps status snapshots and simulator results independently owned', () => {
  const sent: RendererToSimulatorMessage[] = [];
  const session = new RendererSession();
  session.attachTransport(createTransport(sent));
  announce(session);
  const run = session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 1 });
  const payload = {
    id: 'step',
    request_id: tickId(sent[0]!),
    timings: { simulate_ms: 2 },
    error: { code: 'failure', message: 'failed', data: { nested: [1, 2] } },
  };
  session.run.observeActionResult(payload);
  payload.timings.simulate_ms = 999;
  payload.error.data.nested[0] = 999;
  const first = session.run.status!;
  first.spec.actionId = 'mutated';
  first.stopReasons.length = 0;
  first.lastAction!.result.timings!.simulate_ms = 500;
  (first.lastAction!.result.error!.data as { nested: number[] }).nested[0] = 500;
  session.run.markActionRendered({ id: 'step', request_id: payload.request_id });
  const retained = session.run.getRun(run.id)!;
  expect(retained.spec.actionId).toBe('step');
  expect(retained.stopReasons).toContain('action-error');
  expect(retained.lastAction?.result).toMatchObject({
    timings: { simulate_ms: 2 },
    error: { data: { nested: [1, 2] } },
  });
});
