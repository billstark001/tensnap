import { Suspense, type PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCallbackRef, useDebounced, useThrottled } from '@tensnap/web-common/react';

afterEach(() => {
  vi.useRealTimers();
});

describe('shared event callbacks', () => {
  it('keeps its identity while using the latest committed callback and return value', () => {
    const first = vi.fn((value: number) => value + 1);
    const second = vi.fn((value: number) => value + 2);
    const { result, rerender } = renderHook(({ callback }) => useCallbackRef(callback), {
      initialProps: { callback: first },
    });
    const stable = result.current;
    expect(stable(1)).toBe(2);
    rerender({ callback: second });
    expect(result.current).toBe(stable);
    expect(stable(1)).toBe(3);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not publish callbacks from a suspended render', () => {
    const first = vi.fn();
    const pending = vi.fn();
    const suspended = new Promise<void>(() => {});
    const wrapper = ({ children }: PropsWithChildren) => (
      <Suspense fallback={null}>{children}</Suspense>
    );
    const { result, rerender } = renderHook(
      ({ callback, suspend }) => {
        const event = useCallbackRef(callback);
        if (suspend) throw suspended;
        return event;
      },
      { initialProps: { callback: first, suspend: false }, wrapper },
    );
    const event = result.current;
    rerender({ callback: pending, suspend: true });
    event();
    expect(first).toHaveBeenCalledTimes(1);
    expect(pending).not.toHaveBeenCalled();
  });

  it('allows an absent callback to be replaced without changing identity', () => {
    const callback = vi.fn();
    type Callback = typeof callback;
    const { result, rerender } = renderHook(
      ({ callback }: { callback: Callback | null }) => useCallbackRef(callback),
      { initialProps: { callback: null as Callback | null } },
    );
    const stable = result.current;
    expect(stable()).toBeUndefined();
    rerender({ callback });
    stable();
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe.each([
  ['debounce', useDebounced],
  ['throttle', useThrottled],
] as const)('%s hook lifetime', (_name, useDelayed) => {
  it('retains a pending deadline across callback changes and uses the latest arguments', () => {
    vi.useFakeTimers();
    const first = vi.fn();
    const latest = vi.fn();
    const { result, rerender } = renderHook(({ callback }) => useDelayed(callback, 100), {
      initialProps: { callback: first },
    });
    act(() => {
      result.current('leading');
      result.current('trailing');
    });
    first.mockClear();
    const stable = result.current;
    act(() => vi.advanceTimersByTime(50));
    rerender({ callback: latest });
    expect(result.current).toBe(stable);
    act(() => vi.advanceTimersByTime(50));
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledExactlyOnceWith('trailing');
  });

  it('cancels pending work when the delay changes or the consumer unmounts', () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result, rerender, unmount } = renderHook(({ delay }) => useDelayed(callback, delay), {
      initialProps: { delay: 100 },
    });
    act(() => {
      result.current('leading');
      result.current('pending');
    });
    callback.mockClear();
    rerender({ delay: 200 });
    act(() => vi.advanceTimersByTime(100));
    expect(callback).not.toHaveBeenCalled();
    act(() => {
      result.current('new-leading');
      result.current('new-pending');
    });
    callback.mockClear();
    unmount();
    act(() => vi.runAllTimers());
    expect(callback).not.toHaveBeenCalled();
  });
});
