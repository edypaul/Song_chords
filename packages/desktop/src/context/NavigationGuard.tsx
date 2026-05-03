import React, { createContext, useContext, useMemo, useRef } from 'react';

/**
 * A guard receives a `run` callback. The guard is responsible for either
 * calling `run()` to proceed with navigation, or holding onto it (e.g.
 * showing a confirm dialog) and calling it later — or never.
 */
export type NavigationGuardFn = (run: () => void) => void;

interface NavigationGuardContextValue {
  /** Register (or clear) the active guard. Most recent wins. */
  registerGuard: (g: NavigationGuardFn | null) => void;
  /** Route a navigation intent through the active guard, if any. */
  tryNavigate: (run: () => void) => void;
}

const NavigationGuardContext = createContext<NavigationGuardContextValue>({
  registerGuard: () => {},
  tryNavigate: (run) => run(),
});

export function NavigationGuardProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const guardRef = useRef<NavigationGuardFn | null>(null);
  const value = useMemo<NavigationGuardContextValue>(() => ({
    registerGuard: (g) => { guardRef.current = g; },
    tryNavigate: (run) => {
      const g = guardRef.current;
      if (g) g(run);
      else run();
    },
  }), []);
  return (
    <NavigationGuardContext.Provider value={value}>
      {children}
    </NavigationGuardContext.Provider>
  );
}

export function useNavigationGuard(): NavigationGuardContextValue {
  return useContext(NavigationGuardContext);
}
