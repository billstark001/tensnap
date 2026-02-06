/**
 * Basic tests for state manager
 */

import { createStore } from '../store/state-manager';

describe('State Manager', () => {
  it('should create a store with initial state', () => {
    const store = createStore((set, get) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 })),
    }));

    expect(store.getState().count).toBe(0);
  });

  it('should update state correctly', () => {
    const store = createStore((set, get) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 })),
    }));

    store.getState().increment();
    expect(store.getState().count).toBe(1);
  });

  it('should notify listeners on state change', () => {
    const store = createStore((set) => ({
      count: 0,
      increment: () => set((state) => ({ count: state.count + 1 })),
    }));

    let called = false;
    store.subscribe(() => {
      called = true;
    });

    store.getState().increment();
    expect(called).toBe(true);
  });
});
