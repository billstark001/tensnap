import { afterEach, describe, expect, it, vi } from 'vitest';
import { throttle } from './throttle';

afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('runs immediately and delivers the latest call in a burst', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const calls: Array<[string, number]> = [];
    const receiver = {
      id: 'first',
      call: throttle(function (this: { id: string }, value: number) {
        calls.push([this.id, value]);
      }, 100),
    };

    receiver.call(1);
    vi.advanceTimersByTime(20);
    receiver.call(2);
    receiver.call.call({ id: 'latest' }, 3);
    expect(calls).toEqual([['first', 1]]);
    vi.advanceTimersByTime(80);
    expect(calls).toEqual([['first', 1], ['latest', 3]]);
  });
});
