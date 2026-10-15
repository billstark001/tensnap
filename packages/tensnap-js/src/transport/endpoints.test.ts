import { describe, expect, it, vi } from 'vitest';
import { adaptMessagePort, adaptWorker } from './endpoints';

describe.each([
  ['MessagePort', adaptMessagePort],
  ['Worker', adaptWorker],
] as const)('%s endpoint', (_name, adapt) => {
  it('deduplicates listeners and removes the entire registration', () => {
    const target = new EventTarget();
    const endpoint = adapt(target as unknown as MessagePort & Worker);
    const listener = vi.fn();
    endpoint.addMessageListener(listener);
    endpoint.addMessageListener(listener);

    target.dispatchEvent(new MessageEvent('message', { data: 'first' }));
    expect(listener).toHaveBeenCalledExactlyOnceWith('first');

    endpoint.removeMessageListener(listener);
    target.dispatchEvent(new MessageEvent('message', { data: 'second' }));
    expect(listener).toHaveBeenCalledTimes(1);

    endpoint.addMessageListener(listener);
    target.dispatchEvent(new MessageEvent('message', { data: 'third' }));
    expect(listener).toHaveBeenLastCalledWith('third');
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
