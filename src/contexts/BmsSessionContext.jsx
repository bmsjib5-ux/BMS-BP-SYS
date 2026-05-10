// BmsSessionContext.jsx — global session state via React Context.
import React, { createContext, useContext } from 'react';
import { useBmsSession } from '../hooks/useBmsSession';

const BmsSessionContext = createContext(null);

export function BmsSessionProvider({ children }) {
  const session = useBmsSession();
  return (
    <BmsSessionContext.Provider value={session}>
      {children}
    </BmsSessionContext.Provider>
  );
}

export function useBmsSessionContext() {
  const ctx = useContext(BmsSessionContext);
  if (!ctx) {
    throw new Error('useBmsSessionContext must be used inside <BmsSessionProvider>');
  }
  return ctx;
}
