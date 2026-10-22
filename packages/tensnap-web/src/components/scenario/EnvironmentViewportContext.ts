import { createContext, useCallback, useRef } from 'react';

/** The enclosing view menu owns the reset command for its mounted renderer. */
export const EnvironmentViewportContext = createContext<((reset: () => void) => () => void) | null>(
  null,
);

export function useEnvironmentViewportReset() {
  const command = useRef<(() => void) | null>(null);
  const register = useCallback((reset: () => void) => {
    command.current = reset;
    return () => {
      if (command.current === reset) command.current = null;
    };
  }, []);
  const reset = useCallback(() => command.current?.(), []);
  return { register, reset };
}
