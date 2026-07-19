import { create } from 'zustand';
export type { ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';
import type { ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';

export interface RotateDir {
  ax: number;
  ay: number;
}

export interface GeomSnapshot {
  area: number;
  perimeter: number;
}

interface ManzanoState {
  methods: Record<string, ManzanoLoteMethod>;
  rotateDir: Record<string, RotateDir | undefined>;
  geomSnapshots: Record<string, GeomSnapshot | undefined>;
  openCards: Record<string, boolean>;
  rotatingId: string | number | null;
  rotateAnchor: [number, number] | null;
  rotateHandle: [number, number] | null;
  panelVisible: boolean;
  targetAreaM2: number;
  frontMinM: number;
  setMethod: (id: string | number, method: ManzanoLoteMethod) => void;
  getMethod: (id: string | number) => ManzanoLoteMethod;
  setRotateDir: (id: string | number, dir: RotateDir | undefined) => void;
  getRotateDir: (id: string | number) => RotateDir | undefined;
  setGeomSnapshot: (id: string | number, snap: GeomSnapshot) => void;
  hasGeomChanged: (id: string | number, snap: GeomSnapshot) => boolean;
  clearGeomSnapshot: (id: string | number) => void;
  startRotateLots: (id: string | number, anchor: [number, number], handle: [number, number]) => void;
  updateRotateHandle: (handle: [number, number]) => void;
  finishRotateLots: () => { id: string | number; dir: RotateDir } | null;
  cancelRotateLots: () => void;
  toggleCardOpen: (id: string | number) => void;
  setPanelVisible: (v: boolean) => void;
  setTargetAreaM2: (v: number) => void;
  setFrontMinM: (v: number) => void;
}

const MIN_DRAG_LEN = 0.5;

export const useManzanoStore = create<ManzanoState>()((set, get) => ({
  methods: {},
  rotateDir: {},
  geomSnapshots: {},
  openCards: {},
  rotatingId: null,
  rotateAnchor: null,
  rotateHandle: null,
  panelVisible: true,
  targetAreaM2: 250,
  frontMinM: 12,
  setMethod: (id, method) => set((s) => ({ methods: { ...s.methods, [String(id)]: method } })),
  getMethod: (id) => get().methods[String(id)] ?? 'auto',
  setRotateDir: (id, dir) => set((s) => ({ rotateDir: { ...s.rotateDir, [String(id)]: dir } })),
  getRotateDir: (id) => get().rotateDir[String(id)],
  setGeomSnapshot: (id, snap) => set((s) => ({ geomSnapshots: { ...s.geomSnapshots, [String(id)]: snap } })),
  hasGeomChanged: (id, snap) => {
    const prev = get().geomSnapshots[String(id)];
    if (!prev) return false;
    const areaTol = Math.max(0.05, prev.area * 5e-4);
    const perimTol = Math.max(0.01, prev.perimeter * 5e-4);
    return (
      Math.abs(snap.area - prev.area) > areaTol ||
      Math.abs(snap.perimeter - prev.perimeter) > perimTol
    );
  },
  clearGeomSnapshot: (id) =>
    set((s) => {
      const next = { ...s.geomSnapshots };
      delete next[String(id)];
      return { geomSnapshots: next };
    }),
  startRotateLots: (id, anchor, handle) => set({ rotatingId: id, rotateAnchor: anchor, rotateHandle: handle }),
  updateRotateHandle: (handle) => set({ rotateHandle: handle }),
  finishRotateLots: () => {
    const { rotatingId, rotateAnchor, rotateHandle } = get();
    set({ rotatingId: null, rotateAnchor: null, rotateHandle: null });
    if (rotatingId == null || !rotateAnchor || !rotateHandle) return null;
    const dx = rotateHandle[0] - rotateAnchor[0];
    const dy = rotateHandle[1] - rotateAnchor[1];
    const len = Math.hypot(dx, dy);
    if (len < MIN_DRAG_LEN) return null;
    const dir: RotateDir = { ax: dx / len, ay: dy / len };
    set((s) => ({ rotateDir: { ...s.rotateDir, [String(rotatingId)]: dir } }));
    return { id: rotatingId, dir };
  },
  cancelRotateLots: () => set({ rotatingId: null, rotateAnchor: null, rotateHandle: null }),
  toggleCardOpen: (id) =>
    set((s) => ({ openCards: { ...s.openCards, [String(id)]: !s.openCards[String(id)] } })),
  setPanelVisible: (v) => set({ panelVisible: v }),
  setTargetAreaM2: (v) => set({ targetAreaM2: v }),
  setFrontMinM: (v) => set({ frontMinM: v }),
}));
