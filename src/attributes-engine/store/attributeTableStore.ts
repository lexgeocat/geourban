import { create } from 'zustand';

interface AttributeTableState {
  open: boolean;
  layerId: string | null;
  search: string;
  sortKey: string | null;
  sortDir: 'asc' | 'desc';
  onlySelected: boolean;
  openForLayer: (layerId: string) => void;
  close: () => void;
  setSearch: (v: string) => void;
  toggleSort: (key: string) => void;
  setOnlySelected: (v: boolean) => void;
}

export const useAttributeTableStore = create<AttributeTableState>()((set, get) => ({
  open: false,
  layerId: null,
  search: '',
  sortKey: null,
  sortDir: 'asc',
  onlySelected: false,

  openForLayer: (layerId) =>
    set({ open: true, layerId, search: '', sortKey: null, sortDir: 'asc', onlySelected: false }),
  close: () => set({ open: false }),
  setSearch: (v) => set({ search: v }),
  toggleSort: (key) => {
    const { sortKey, sortDir } = get();
    if (sortKey !== key) set({ sortKey: key, sortDir: 'asc' });
    else if (sortDir === 'asc') set({ sortDir: 'desc' });
    else set({ sortKey: null, sortDir: 'asc' });
  },
  setOnlySelected: (v) => set({ onlySelected: v }),
}));
