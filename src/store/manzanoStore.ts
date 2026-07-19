// src/store/manzanoStore.ts
//
// Estado por manzano (no global): método de lotización, dirección manual
// ("Rotar lotes"), y visibilidad del panel lateral. Se indexa por el id de
// la feature OL del manzano — ver nota de limitación en el comando
// RecomputeManzanoLotsCommand sobre qué pasa si el manzano se recalcula.

import { create } from 'zustand';
export type { ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';
import type { ManzanoLoteMethod } from '../geo/subdivisionAlgorithms';

interface RotateDir {
  ax: number;
  ay: number;
}

interface ManzanoState {
  methods: Record<string, ManzanoLoteMethod>;
  rotateDir: Record<string, RotateDir | undefined>;
  openCards: Record<string, boolean>;
  pickingId: string | number | null;
  panelVisible: boolean;
  targetAreaM2: number;
  frontMinM: number;

  setMethod: (id: string | number, method: ManzanoLoteMethod) => void;
  getMethod: (id: string | number) => ManzanoLoteMethod;
  setRotateDir: (id: string | number, dir: RotateDir | undefined) => void;
  getRotateDir: (id: string | number) => RotateDir | undefined;
  setPickingId: (id: string | number | null) => void;
  toggleCardOpen: (id: string | number) => void;
  setPanelVisible: (v: boolean) => void;
  setTargetAreaM2: (v: number) => void;
  setFrontMinM: (v: number) => void;
}

export const useManzanoStore = create<ManzanoState>()((set, get) => ({
  methods: {},
  rotateDir: {},
  openCards: {},
  pickingId: null,
  panelVisible: true,
  targetAreaM2: 250,
  frontMinM: 12,

  setMethod: (id, method) => set((s) => ({ methods: { ...s.methods, [String(id)]: method } })),
  getMethod: (id) => get().methods[String(id)] ?? 'auto',

  setRotateDir: (id, dir) => set((s) => ({ rotateDir: { ...s.rotateDir, [String(id)]: dir } })),
  getRotateDir: (id) => get().rotateDir[String(id)],

  setPickingId: (id) => set({ pickingId: id }),

  toggleCardOpen: (id) =>
    set((s) => ({ openCards: { ...s.openCards, [String(id)]: !s.openCards[String(id)] } })),

  setPanelVisible: (v) => set({ panelVisible: v }),
  setTargetAreaM2: (v) => set({ targetAreaM2: v }),
  setFrontMinM: (v) => set({ frontMinM: v }),
}));