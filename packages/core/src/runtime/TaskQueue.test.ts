/**
 * runtime/TaskQueue.test.ts
 *
 * Unit tests for the TaskQueue sub-component.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TaskQueue } from './TaskQueue';

let idCounter = 0;
const makeQueue = () =>
  new TaskQueue(
    () => performance.now(),
    () => `t${++idCounter}`,
  );

beforeEach(() => {
  idCounter = 0;
});

describe('TaskQueue – basic enqueue / dispatch', () => {
  it('enqueues a task and immediately provides a dispatch command', () => {
    const q = makeQueue();
    const id = q.enqueue('start');
    q.maybeDispatchNext();
    const task = q.takeNextDispatchTask();
    expect(task).not.toBeNull();
    expect(task!.id).toBe(id);
    expect(task!.stage).toBe('dispatched');
    expect(q.hasActiveTask).toBe(true);
  });

  it('does not dispatch when a task is already active', () => {
    const q = makeQueue();
    q.enqueue('a');
    q.maybeDispatchNext();
    q.takeNextDispatchTask(); // consume first dispatch
    q.enqueue('b');
    q.maybeDispatchNext(); // should be a no-op — activeTask exists
    expect(q.takeNextDispatchTask()).toBeNull();
  });

  it('dispatches next queued task after markTaskRendered', () => {
    const q = makeQueue();
    const id1 = q.enqueue('a');
    q.enqueue('b');
    q.maybeDispatchNext();
    q.takeNextDispatchTask();
    q.completeTask(id1, { should_continue: false });
    q.markTaskApplied(id1);

    let reEnqueueCalled = false;
    let advanceCalled = false;
    q.markTaskRendered(
      id1,
      () => { reEnqueueCalled = true; },
      () => { advanceCalled = true; q.maybeDispatchNext(); },
    );
    expect(advanceCalled).toBe(true);
    expect(reEnqueueCalled).toBe(false);

    const next = q.takeNextDispatchTask();
    expect(next).not.toBeNull();
    expect(next!.key).toBe('b');
  });
});

describe('TaskQueue – continuous task deduplication', () => {
  it('returns existing id for duplicate continuous key', () => {
    const q = makeQueue();
    const id1 = q.enqueue('run', { continuous: true });
    const id2 = q.enqueue('run', { continuous: true });
    expect(id1).toBe(id2);
    expect(q.getContinuousKeyCount()).toBe(1);
  });

  it('re-enqueues continuous task when onReEnqueue is called', () => {
    const q = makeQueue();
    const id = q.enqueue('run', { continuous: true });
    q.maybeDispatchNext();
    q.takeNextDispatchTask();
    q.completeTask(id, { should_continue: true });
    q.markTaskApplied(id);

    let reEnqueueKey: string | null = null;
    q.markTaskRendered(
      id,
      (key) => {
        reEnqueueKey = key;
        q.enqueue(key, { continuous: true });
        q.maybeDispatchNext();
      },
      () => {},
    );
    expect(reEnqueueKey).toBe('run');
    expect(q.hasContinuousKey('run')).toBe(true);
    const next = q.takeNextDispatchTask();
    expect(next).not.toBeNull();
  });
});

describe('TaskQueue – cancel', () => {
  it('removes queued task by key', () => {
    const q = makeQueue();
    const id = q.enqueue('a', { continuous: true });
    q.enqueue('b', { continuous: true });
    expect(q.cancel('a')).toEqual([id]);
    q.maybeDispatchNext();
    const task = q.takeNextDispatchTask();
    expect(task!.key).toBe('b');
  });

  it('cancels all queued tasks', () => {
    const q = makeQueue();
    const first = q.enqueue('a');
    const second = q.enqueue('b');
    expect(q.cancel()).toEqual([first, second]);
    q.maybeDispatchNext();
    expect(q.takeNextDispatchTask()).toBeNull();
  });
});

describe('TaskQueue – cancelPendingDispatch', () => {
  it('cancels a dispatched active task cleanly', () => {
    const q = makeQueue();
    const id = q.enqueue('action');
    q.maybeDispatchNext();
    q.takeNextDispatchTask();

    const result = q.cancelPendingDispatch(id);
    expect(result).toBe(true);
    expect(q.hasActiveTask).toBe(false);
    expect(q.takeNextDispatchTask()).toBeNull();
  });

  it('returns false if task is not the active task', () => {
    const q = makeQueue();
    q.enqueue('a');
    const id2 = q.enqueue('b');
    q.maybeDispatchNext();
    q.takeNextDispatchTask(); // 'a' is now active
    expect(q.cancelPendingDispatch(id2)).toBe(false);
  });
});
