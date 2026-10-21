import { expect, it, vi } from 'vitest';
import { RendererSession } from '@tensnap/core/runtime';
import type { BenchmarkCase } from './browser-types';
import { runBrowserBenchmark } from './browser-executor';

it.each([false, true])(
  'retains correlated diagnostic boundaries only when enabled (%s)',
  async (diagnostics) => {
    const raf = vi.fn(() => 123);
    const cancel = vi.fn();
    let clock = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => ++clock);
    const acceptedResultTimes: number[] = [];
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const session = new RendererSession({ run: { renderBarrier: { wait() {} } } });
    session.attachTransport({
      connectionId: 'test://benchmark',
      transportKind: 'test',
      encoding: 'json',
      connectionState: 'open',
      isConnected: true,
      async connect() {},
      disconnect() {},
      destroy() {},
      on() {},
      off() {},
      send(message) {
        if (message.type !== 'action_invoke') return;
        // A stale result must not become the active action's result timestamp.
        queueMicrotask(() => {
          session.handleIncoming({
            type: 'action_result',
            payload: { id: 'step', request_id: 'unrelated' },
          });
          session.dispatchEvent(
            new CustomEvent('message', {
              detail: {
                message: {
                  type: 'action_result',
                  payload: { ...message.payload, id: 'other-action' },
                },
              },
            }),
          );
          clock += 100;
          acceptedResultTimes.push(clock + 1);
          session.dispatchEvent(
            new CustomEvent('message', {
              detail: { message: { type: 'action_result', payload: message.payload } },
            }),
          );
          session.handleIncoming({ type: 'action_result', payload: message.payload });
          session.dispatchEvent(
            new CustomEvent('message', {
              detail: { message: { type: 'action_result', payload: message.payload } },
            }),
          );
        });
      },
    });
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'fixture', version: '0.3.0' },
        model: { id: 'fixture' },
        instance_id: 'fixture',
        capabilities: [],
      },
    });
    session.scenario.apply({ type: 'action_create', payload: { id: 'step', label: 'Step' } });
    const benchmark: BenchmarkCase = {
      name: 'fixture',
      category: 'tensnap',
      config: {},
      actionId: 'step',
      async mount() {
        return { kind: 'model', session, snapshot: () => ({}), destroy: () => session.destroy() };
      },
    };
    try {
      const result = await runBrowserBenchmark(benchmark, document.createElement('div'), 2, 1, {
        diagnostics,
      });
      expect(result.measuredFrames).toBe(2);
      expect(result.completedFrames).toBe(3);
      if (diagnostics) {
        expect(result.diagnostics!.actions).toHaveLength(3);
        for (const action of result.diagnostics!.actions) {
          expect(action.requestId).not.toBe('unrelated');
          expect(action.resultAppliedMs).toBeGreaterThanOrEqual(action.dispatchMs);
          expect(action.completedMs).toBeGreaterThanOrEqual(action.resultAppliedMs!);
        }
        expect(result.diagnostics!.actions.map((action) => action.resultAppliedMs)).toEqual(
          acceptedResultTimes,
        );
        expect(cancel).toHaveBeenCalledWith(123);
      } else {
        expect(result.diagnostics).toBeUndefined();
        expect(raf).not.toHaveBeenCalled();
      }
    } finally {
      session.destroy();
      now.mockRestore();
      vi.unstubAllGlobals();
    }
  },
);
