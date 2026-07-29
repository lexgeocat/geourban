import { create } from 'zustand';

interface ConfirmRequest {
  id: number;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}

interface ConfirmDialogState {
  pending: ConfirmRequest | null;
  request: (opts: {
    message: string;
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  resolve: (value: boolean) => void;
}

let nextId = 1;

export const useConfirmDialogStore = create<ConfirmDialogState>()((set, get) => ({
  pending: null,

  request: (opts) => {
    return new Promise<boolean>((resolve) => {
      set({
        pending: {
          id: nextId++,
          message: opts.message,
          title: opts.title,
          confirmLabel: opts.confirmLabel,
          cancelLabel: opts.cancelLabel,
          danger: opts.danger,
          resolve,
        },
      });
    });
  },

  resolve: (value) => {
    const pending = get().pending;
    if (!pending) return;
    set({ pending: null });
    pending.resolve(value);
  },
}));

/** Helper para llamar desde código no-React (equivalente async a window.confirm). */
export function confirmAsync(
  message: string,
  opts?: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean },
): Promise<boolean> {
  return useConfirmDialogStore.getState().request({ message, ...opts });
}