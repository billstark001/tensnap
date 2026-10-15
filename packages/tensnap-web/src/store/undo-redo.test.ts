import { describe, expect, it, vi } from 'vitest';
import { createHistoryStore } from './undo-redo';
import type { HistoryCommand } from './history-model';

const command = (
  label: string,
  state: { value: number },
  from: number,
  to: number,
  byteSize = 1,
): HistoryCommand => ({
  id: label,
  label,
  scope: 'layout',
  byteSize,
  apply: () => {
    state.value = to;
  },
  revert: () => {
    state.value = from;
  },
});

describe('project command history', () => {
  it('undoes and redoes domain commands without storing target store snapshots', async () => {
    const target = { value: 0 };
    const history = createHistoryStore();
    expect(await history.getState().execute(command('Move view', target, 0, 4))).toBe(true);
    expect(target.value).toBe(4);
    expect(await history.getState().undo()).toBe(true);
    expect(target.value).toBe(0);
    expect(await history.getState().redo()).toBe(true);
    expect(target.value).toBe(4);
  });

  it('keeps the stack position stable when an async revert fails', async () => {
    const onError = vi.fn();
    const history = createHistoryStore({ onError });
    history.getState().recordApplied({
      id: 'bad',
      label: 'Bad command',
      scope: 'layout',
      byteSize: 1,
      apply: () => {},
      revert: async () => {
        throw new Error('gone');
      },
    });
    expect(await history.getState().undo()).toBe(false);
    expect(history.getState().past).toHaveLength(1);
    expect(history.getState().future).toHaveLength(0);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('evicts oldest commands atomically at the count and byte budgets', () => {
    const target = { value: 0 };
    const history = createHistoryStore({ maxCommands: 2, maxBytes: 2 });
    history.getState().recordApplied(command('one', target, 0, 1));
    history.getState().recordApplied(command('two', target, 1, 2));
    history.getState().recordApplied(command('three', target, 2, 3));
    expect(history.getState().past.map((item) => item.label)).toEqual(['two', 'three']);
    expect(history.getState().retainedBytes).toBe(2);
  });

  it('tracks the clean state across undo/redo and oversized commands', async () => {
    const target = { value: 0 };
    const history = createHistoryStore({ maxBytes: 2 });
    await history.getState().execute(command('one', target, 0, 1));
    history.getState().markClean();
    expect(history.getState().isDirty()).toBe(false);

    await history.getState().execute(command('two', target, 1, 2));
    expect(history.getState().isDirty()).toBe(true);
    await history.getState().undo();
    expect(history.getState().isDirty()).toBe(false);
    await history.getState().redo();
    expect(history.getState().isDirty()).toBe(true);

    history.getState().markClean();
    history.getState().recordApplied(command('too large', target, 2, 3, 3));
    expect(history.getState().isDirty()).toBe(true);
    expect(history.getState().past).toEqual([]);
    expect(history.getState().retainedBytes).toBe(0);
    expect(await history.getState().undo()).toBe(false);
  });

  it('rejects invalid budgets and command sizes before changing the target', async () => {
    expect(() => createHistoryStore({ maxCommands: 0 })).toThrow(/maxCommands/);
    expect(() => createHistoryStore({ maxBytes: Number.POSITIVE_INFINITY })).toThrow(/maxBytes/);
    const target = { value: 0 };
    const history = createHistoryStore();
    expect(await history.getState().execute(command('invalid', target, 0, 1, Number.NaN))).toBe(
      false,
    );
    expect(target.value).toBe(0);
    expect(history.getState().past).toEqual([]);
  });

  it('keeps a saved state reachable when subsequent commands share a merge key', async () => {
    const target = { value: 0 };
    const history = createHistoryStore();
    const move = (from: number, to: number): HistoryCommand => ({
      ...command('Move', target, from, to),
      mergeKey: 'view:one',
      timestamp: to,
    });
    await history.getState().execute(move(0, 1));
    await history.getState().execute(move(1, 2));
    expect(history.getState().past).toHaveLength(1);
    history.getState().markClean();
    await history.getState().execute(move(2, 3));
    await history.getState().execute(move(3, 4));
    expect(history.getState().past).toHaveLength(2);
    await history.getState().undo();
    expect(target.value).toBe(2);
    expect(history.getState().isDirty()).toBe(false);
  });

  it('does not merge across an undo branch or between command scopes', async () => {
    const target = { value: 0 };
    const history = createHistoryStore();
    const move = (from: number, to: number, timestamp: number): HistoryCommand => ({
      ...command('Move', target, from, to),
      mergeKey: 'view:one',
      timestamp,
    });
    await history.getState().execute(move(0, 1, 0));
    await history.getState().execute(move(1, 2, 800));
    await history.getState().undo();
    await history.getState().execute(move(1, 3, 100));
    expect(history.getState().past).toHaveLength(2);
    expect(history.getState().future).toHaveLength(0);
    await history.getState().execute({ ...move(3, 4, 200), scope: 'view-config' });
    expect(history.getState().past).toHaveLength(3);
    await history.getState().undo();
    expect(target.value).toBe(3);
  });

  it('restores idle status even when the error handler throws', async () => {
    const history = createHistoryStore({
      onError: () => {
        throw new Error('logger failed');
      },
    });
    const bad = {
      ...command('Bad', { value: 0 }, 0, 1),
      apply: () => {
        throw new Error('apply failed');
      },
    };
    await expect(history.getState().execute(bad)).rejects.toThrow('logger failed');
    expect(history.getState().status).toBe('idle');
    expect(history.getState().error).toBe('apply failed');
  });

  it('ignores oversized external records while a command is in flight', async () => {
    const history = createHistoryStore({ maxBytes: 1 });
    const target = { value: 0 };
    history.getState().recordApplied(command('First', target, 0, 1));
    let finish!: () => void;
    const running = history.getState().execute({
      ...command('Second', target, 1, 2),
      apply: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    history.getState().recordApplied(command('Too large', target, 0, 3, 2));
    expect(history.getState().past.map((item) => item.label)).toEqual(['First']);
    finish();
    expect(await running).toBe(true);
  });
});
