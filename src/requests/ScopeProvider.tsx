import { useMemo, useState, type ReactNode } from 'react';

import { ALL_SCOPES, ScopeContext } from './scope';

/** Holds the scope filter for the session, in memory only. */
export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState(ALL_SCOPES);
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
