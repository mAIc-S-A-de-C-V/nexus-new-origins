import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { AppVariable } from '../../types/app';

// ── Context shape ────────────────────────────────────────────────────────────

interface AppVariableCtx {
  variables: Map<string, any>;
  setVariable: (id: string, value: any) => void;
  getVariable: (id: string) => any;
}

const AppVariableContext = createContext<AppVariableCtx>({
  variables: new Map(),
  setVariable: () => {},
  getVariable: () => undefined,
});

// ── Provider ─────────────────────────────────────────────────────────────────

export const AppVariableProvider: React.FC<{
  definitions: AppVariable[];
  children: React.ReactNode;
}> = ({ definitions, children }) => {
  const [variables, setVariables] = useState<Map<string, any>>(() => {
    const m = new Map<string, any>();
    for (const v of definitions) {
      m.set(v.id, v.defaultValue ?? null);
    }
    return m;
  });

  const setVariable = useCallback((id: string, value: any) => {
    setVariables((prev) => {
      const next = new Map(prev);
      next.set(id, value);
      return next;
    });
  }, []);

  const getVariable = useCallback(
    (id: string) => variables.get(id),
    [variables],
  );

  const ctx = useMemo<AppVariableCtx>(
    () => ({ variables, setVariable, getVariable }),
    [variables, setVariable, getVariable],
  );

  return (
    <AppVariableContext.Provider value={ctx}>
      {children}
    </AppVariableContext.Provider>
  );
};

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useAppVariables() {
  return useContext(AppVariableContext);
}

export function useVariableValue(variableId: string | undefined): [any, (v: any) => void] {
  const { variables, setVariable } = useContext(AppVariableContext);
  const value = variableId ? variables.get(variableId) : undefined;
  const setter = useCallback(
    (v: any) => { if (variableId) setVariable(variableId, v); },
    [variableId, setVariable],
  );
  return [value, setter];
}
