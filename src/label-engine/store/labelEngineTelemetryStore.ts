import { create } from 'zustand';

interface LabelEngineTelemetryState {
  hiddenCount: number;
  droppedByReason: { collision: number; zoom: number; noAnchor: number };
  lastUpdateMs: number;
  setHidden: (
    hiddenCount: number,
    dropped: { collision: number; zoom: number; noAnchor: number }
  ) => void;
  reset: () => void;
}

export const useLabelEngineTelemetryStore = create<LabelEngineTelemetryState>()((set) => ({
  hiddenCount: 0,
  droppedByReason: { collision: 0, zoom: 0, noAnchor: 0 },
  lastUpdateMs: 0,
  setHidden: (hiddenCount, dropped) =>
    set({ hiddenCount, droppedByReason: dropped, lastUpdateMs: Date.now() }),
  reset: () =>
    set({ hiddenCount: 0, droppedByReason: { collision: 0, zoom: 0, noAnchor: 0 }, lastUpdateMs: 0 }),
}));
