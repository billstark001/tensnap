import { useCallback, useRef } from "react";

/**
 * A custom hook that returns a memoized callback ref function.
 * This is useful when you need a stable callback function that doesn't change
 * between renders, but you want to access the latest value of dependencies.
 * 
 * @param callback - The callback function to memoize
 * @param deps - Dependencies array for the callback
 * @returns A memoized callback function
 */
export function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T | undefined,
  deps: React.DependencyList = []
): T {
  const callbackRef = useRef(callback);
  
  // Update the ref with the latest callback
  callbackRef.current = callback;
  
  // Return a memoized function that calls the latest callback
  return useCallback(
    ((...args) => callbackRef.current?.(...args)) as T,
    deps
  );
}