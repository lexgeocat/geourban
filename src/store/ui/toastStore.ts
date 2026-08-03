import { create } from 'zustand';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  /** ms hasta auto-dismiss. 0 = persistente hasta click. Default 4000. */
  durationMs: number;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, opts?: { variant?: ToastVariant; durationMs?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],

  push: (message, opts) => {
    const id = nextId++;
    const entry: Toast = {
      id,
      message,
      variant: opts?.variant ?? 'info',
      durationMs: opts?.durationMs ?? 4000,
      createdAt: Date.now(),
    };
    set((s) => ({ toasts: [...s.toasts, entry] }));
    if (entry.durationMs > 0) {
      setTimeout(() => {
        if (get().toasts.find((t) => t.id === id)) {
          get().dismiss(id);
        }
      }, entry.durationMs);
    }
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Helper para llamar desde código no-React. */
export function toast(message: string, opts?: { variant?: ToastVariant; durationMs?: number }): number {
  return useToastStore.getState().push(message, opts);
}
