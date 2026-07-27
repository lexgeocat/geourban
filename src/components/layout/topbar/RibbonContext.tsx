import React from 'react';
import type { DrawMode } from '../../../store/map/drawStore';

export const RibbonContext = React.createContext<{
  currentMode: DrawMode;
  setMode: (m: DrawMode) => void;
} | null>(null);

export function useRibbonCtx() {
  const ctx = React.useContext(RibbonContext);
  if (!ctx) throw new Error('RibbonContext missing');
  return ctx;
}
