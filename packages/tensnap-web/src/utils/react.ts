import { DialogProps } from "@radix-ui/react-dialog";
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * 返回一个始终调用最新回调的稳定函数引用
 */
export function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T | undefined | null,
  deps: React.DependencyList = []
): T {
  const ref = useRef(callback);
  ref.current = callback;

  return useCallback(
    ((...args) => ref.current?.(...args)) as T,
    deps
  );
}

export type DialogOpenProps = Pick<DialogProps, 'open' | 'onOpenChange'>;

export interface ThrottledFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

export interface DebouncedFunction<T extends (...args: any[]) => any> 
  extends ThrottledFunction<T> {
  flush(): void;
}

/**
 * 通用的延迟函数创建器
 */
function createDelayedFunction<T extends (...args: any[]) => any, R>(
  fn: T,
  _delay: number,
  createMethods: (
    timeoutRef: { current: ReturnType<typeof setTimeout> | null },
    argsRef: { current: Parameters<T> | null },
    execute: () => void
  ) => R
): R {
  const timeoutRef = { current: null as ReturnType<typeof setTimeout> | null };
  const argsRef = { current: null as Parameters<T> | null };

  const execute = () => {
    if (argsRef.current) {
      fn(...argsRef.current);
      argsRef.current = null;
    }
  };

  return createMethods(timeoutRef, argsRef, execute);
}

export const debounce = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): DebouncedFunction<T> => {
  return createDelayedFunction(fn, delay, (timeoutRef, argsRef, execute) => {
    const debounced = ((...args: Parameters<T>) => {
      argsRef.current = args;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        execute();
        timeoutRef.current = null;
      }, delay);
    }) as DebouncedFunction<T>;

    debounced.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        argsRef.current = null;
      }
    };

    debounced.flush = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        execute();
      }
    };

    return debounced;
  });
};

export const throttle = <T extends (...args: any[]) => any>(
  fn: T,
  delay: number
): ThrottledFunction<T> => {
  let lastExecTime = 0;
  
  return createDelayedFunction(fn, delay, (timeoutRef, argsRef, execute) => {
    const throttled = ((...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastExec = now - lastExecTime;

      argsRef.current = args;

      if (timeSinceLastExec >= delay) {
        execute();
        lastExecTime = now;
      } else {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          execute();
          lastExecTime = Date.now();
          timeoutRef.current = null;
        }, delay - timeSinceLastExec);
      }
    }) as ThrottledFunction<T>;

    throttled.cancel = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    return throttled;
  });
};

/**
 * 通用的延迟钩子实现
 */
function useDelayed<T extends (...args: any[]) => any, R>(
  callback: T,
  delay: number,
  createFn: (fn: T, delay: number) => R & { cancel: () => void }
): R {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  const delayed = useMemo(
    () => createFn(((...args) => callbackRef.current(...args)) as T, delay),
    [delay]
  );

  useEffect(() => () => delayed.cancel(), [delayed]);

  return delayed;
}

export function useThrottled<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): ThrottledFunction<T> {
  return useDelayed(callback, delay, throttle);
}

export function useDebounced<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): DebouncedFunction<T> {
  return useDelayed(callback, delay, debounce);
}