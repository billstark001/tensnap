/**
 * Lightweight state management for tensnap-web-core
 * Provides a simple observer pattern for state updates without external dependencies
 */

export type Listener<T> = (state: T, prevState: T) => void;
export type StateSelector<T, U> = (state: T) => U;
export type StateCreator<T> = (set: SetState<T>, get: GetState<T>, api: StoreApi<T>) => T;
export type SetState<T> = (partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => void;
export type GetState<T> = () => T;

export interface StoreApi<T> {
  setState: SetState<T>;
  getState: GetState<T>;
  subscribe: (listener: Listener<T>) => () => void;
  destroy: () => void;
}

/**
 * Create a simple state store
 */
export function createStore<T>(createState: StateCreator<T>): StoreApi<T> {
  let state: T;
  const listeners = new Set<Listener<T>>();

  const setState: SetState<T> = (partial, replace) => {
    const nextState = typeof partial === 'function' 
      ? (partial as (state: T) => T | Partial<T>)(state)
      : partial;
    
    if (nextState !== state) {
      const prevState = state;
      state = replace 
        ? nextState as T
        : Object.assign({}, state, nextState);
      
      listeners.forEach(listener => listener(state, prevState));
    }
  };

  const getState: GetState<T> = () => state;

  const subscribe = (listener: Listener<T>) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const destroy = () => {
    listeners.clear();
  };

  const api: StoreApi<T> = { setState, getState, subscribe, destroy };
  state = createState(setState, getState, api);

  return api;
}

/**
 * Helper type for create function signature (matches Zustand's API)
 */
export type CreateStoreFunction<T, StoreType = T> = (
  set: SetState<StoreType>,
  get: GetState<StoreType>,
  api: StoreApi<StoreType>
) => T;
