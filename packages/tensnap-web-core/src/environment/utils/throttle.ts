/**
 * environment/utils/throttle.ts
 *
 * Leading-edge throttle: fires immediately on first call, then ignores
 * subsequent calls until the delay has elapsed.
 */

export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  delayMs: number
): T {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>) {
    const now = Date.now();
    const remaining = delayMs - (now - lastCall);

    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastCall = now;
      fn.apply(this, args);
    } else if (timer === null) {
      // Schedule a trailing call so the last invocation is not lost.
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn.apply(this, args);
      }, remaining);
    }
  } as T;
}
