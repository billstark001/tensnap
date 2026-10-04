/**
 * environment/utils/throttle.ts
 *
 * Leading and trailing throttle. Fires immediately, then runs once with the
 * most recent arguments at the end of a burst.
 */

export function throttle<T extends (...args: any[]) => void>(fn: T, delayMs: number): T {
  let lastCall = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { context: unknown; args: Parameters<T> } | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = delayMs - (now - lastCall);

    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      lastCall = now;
      fn.apply(this, args);
    } else {
      pending = { context: this, args };
      if (timer === null) {
        timer = setTimeout(() => {
          lastCall = Date.now();
          timer = null;
          const call = pending;
          pending = null;
          if (call !== null) fn.apply(call.context, call.args);
        }, remaining);
      }
    }
  } as T;
}
