import { describe, expect, it, vi } from 'vitest';
import { createHistoryStore, type HistoryCommand } from './undo-redo';

const command = (label: string, state: { value: number }, from: number, to: number, byteSize = 1): HistoryCommand => ({
  id: label,
  label,
  scope: 'layout',
  byteSize,
  apply: () => { state.value = to; },
  revert: () => { state.value = from; },
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
      id: 'bad', label: 'Bad command', scope: 'layout', byteSize: 1,
      apply: () => {}, revert: async () => { throw new Error('gone'); },
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
    expect(history.getState().past.map((item) => item.label)).not.toContain('too large');
  });
});
