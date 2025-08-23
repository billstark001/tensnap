import { useCallback, useRef } from "react";

/**
 * useCallbackRef overloads:
 * 1. When callback is defined, returns a memoized function that calls the latest callback.
 * 2. When callback is undefined or null, returns a memoized no-op function with the same signature.
 */

// Overload 1: callback is defined
export function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T,
  deps?: React.DependencyList
): T;

// Overload 2: callback is possibly undefined/null
export function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T | undefined | null,
  deps?: React.DependencyList
): ((...args: Parameters<T>) => ReturnType<T> | undefined);

/**
 * Implementation of useCallbackRef with overloads for handling optional callback.
 * 
 * @param callback - The callback function to memoize, possibly undefined or null.
 * @param deps - Dependencies array for the callback.
 * @returns A memoized function that calls the latest callback, or a no-op if callback is not provided.
 */
export function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T | undefined | null,
  deps: React.DependencyList = []
): ((...args: Parameters<T>) => ReturnType<T> | undefined) {
  const callbackRef = useRef<T | undefined | null>(callback);

  // Always keep ref up-to-date with latest callback
  callbackRef.current = callback;

  // Return a memoized function.
  // If callback is missing, return a no-op function with matching signature.
  return useCallback(
    ((...args: Parameters<T>): ReturnType<T> => {
      if (callbackRef.current) {
        return callbackRef.current(...args);
      }
      // Return undefined or default for missing callback.
      // Cast to ReturnType<T> for type consistency.
      return undefined as ReturnType<T>;
    }) as T,
    deps
  );
}