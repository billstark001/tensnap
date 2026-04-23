import { describe, expect, it } from 'vitest';
import { PipelineRuntime } from './PipelineRuntime';

describe('PipelineRuntime', () => {
  it('holds queued work until a matching state sync completes', () => {
    let now = 0;
    const runtime = new PipelineRuntime({
      now: () => {
        now += 1;
        return now;
      },
      idFactory: () => 'tick-1',
    });

    runtime.requestStateSync('sync-1');
    runtime.enqueue('start', { continuous: true });

    expect(runtime.consumeCommands()).toHaveLength(0);
    expect(runtime.recordStateSyncBoundary('end', { request_id: 'other-sync' })).toBe(false);
    expect(runtime.consumeCommands()).toHaveLength(0);

    expect(runtime.recordStateSyncBoundary('begin', { request_id: 'sync-1' })).toBe(true);
    expect(runtime.consumeCommands()).toHaveLength(0);

    expect(runtime.recordStateSyncBoundary('end', { request_id: 'sync-1' })).toBe(true);
    expect(runtime.consumeCommands()).toEqual([
      expect.objectContaining({
        type: 'dispatch',
        task: expect.objectContaining({ id: 'tick-1', key: 'start', stage: 'dispatched' }),
      }),
    ]);
  });

  it('waits for render completion before dispatching the next continuous tick', () => {
    let now = 0;
    let nextId = 0;
    const runtime = new PipelineRuntime({
      now: () => {
        now += 1;
        return now;
      },
      idFactory: () => `tick-${++nextId}`,
    });

    runtime.enqueue('start', { continuous: true });
    const [firstCommand] = runtime.consumeCommands();
    expect(firstCommand.task.id).toBe('tick-1');

    expect(runtime.completeTask('tick-1', { continue: true, timings: { simulate_ms: 5 } })).toBe(true);
    expect(runtime.consumeCommands()).toHaveLength(0);

    expect(runtime.markTaskApplied('tick-1')).toBe(true);
    expect(runtime.consumeCommands()).toHaveLength(0);

    expect(runtime.markTaskRendered('tick-1')).toBe(true);

    const [secondCommand] = runtime.consumeCommands();
    expect(secondCommand.task.id).toBe('tick-2');
    expect(secondCommand.task.key).toBe('start');
  });

  it('stops a continuous task from re-queueing after cancel', () => {
    let nextId = 0;
    const runtime = new PipelineRuntime({
      now: () => 1,
      idFactory: () => `tick-${++nextId}`,
    });

    runtime.enqueue('start', { continuous: true });
    runtime.consumeCommands();

    runtime.cancel('start');
    expect(runtime.completeTask('tick-1', { continue: true })).toBe(true);
    expect(runtime.markTaskRendered('tick-1')).toBe(true);

    expect(runtime.consumeCommands()).toHaveLength(0);
    expect(runtime.getSnapshot().continuousKeys).toEqual([]);
  });

  it('removes queued work when cancelling all pending tasks', () => {
    let nextId = 0;
    const runtime = new PipelineRuntime({
      now: () => 1,
      idFactory: () => `tick-${++nextId}`,
    });

    runtime.requestStateSync('sync-1');
    runtime.enqueue('start', { continuous: true });
    runtime.enqueue('step');

    runtime.cancel();

    expect(runtime.getSnapshot().queuedTasks).toEqual([]);
    expect(runtime.getSnapshot().continuousKeys).toEqual([]);
  });
});