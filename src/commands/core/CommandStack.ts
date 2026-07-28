import { create } from 'zustand';
import { Command, type CommandContext, getCommandContext } from './Command';
import { useSelectionStore } from '../../store/map/selectionStore';

type RunResult =
  | { ok: true; command: Command }
  | { ok: false; error: string };

const COALESCE_WINDOW_MS = 250;
const MAX_STACK = 100;
const MAX_STACK_BYTES = 24 * 1024 * 1024;


let executed: Command[] = [];
let pointer = -1; // índice del último comando ejecutado; -1 = nada ejecutado
let lastCoalesceKey: string | null = null;
let lastCommandAt = 0;

type CommandStackState = {
  canUndo: boolean;
  canRedo: boolean;
  run: (command: Command) => Promise<RunResult>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clear: () => void;
  refresh: () => void;
};

function syncFlags(set: (partial: Partial<CommandStackState>) => void) {
  set({ canUndo: pointer >= 0, canRedo: pointer < executed.length - 1 });
}

function pruneStack(): void {
  if (executed.length > MAX_STACK) {
    const drop = executed.length - MAX_STACK;
    executed.splice(0, drop);
    pointer -= drop;
  }

  let total = 0;
  for (const cmd of executed) total += cmd.approxMemoryBytes();
  while (total > MAX_STACK_BYTES && executed.length > 1) {
    const removed = executed.shift();
    if (removed) total -= removed.approxMemoryBytes();
    pointer -= 1;
  }
  if (pointer < -1) pointer = -1;
}

export const useCommandStack = create<CommandStackState>()((set) => ({
  canUndo: false,
  canRedo: false,

  run: async (command) => {
    const ctx = getCommandContext();
    if (!ctx) return { ok: false, error: 'drawSource no inicializado' };

    try {
      await command.execute(ctx);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    if (pointer < executed.length - 1) {
      executed.splice(pointer + 1);
    }

    const now = Date.now();
    const key = command.coalesceKey ?? null;
    const withinWindow = now - lastCommandAt < COALESCE_WINDOW_MS;
    const top = pointer >= 0 ? executed[pointer] : null;
    const coalesced =
      withinWindow &&
      top != null &&
      key != null &&
      lastCoalesceKey === key &&
      command.coalesceInto?.(top) === true;

    if (!coalesced) {
      executed.push(command);
      pointer = executed.length - 1;
      pruneStack();
    }

    lastCoalesceKey = key;
    lastCommandAt = now;
    syncFlags(set);
    return { ok: true, command };
  },

  undo: async () => {
    if (pointer < 0) {
      syncFlags(set);
      return false;
    }
    const ctx = getCommandContext();
    if (!ctx) return false;

    const command = executed[pointer];
    try {
      if (command.undo) {
        await command.undo(ctx);
      } else {
        console.warn(`CommandStack: "${command.label}" no implementa undo() — se ignora.`);
      }
    } catch (err) {
      console.error(`CommandStack: error al deshacer "${command.label}"`, err);
    }
    pointer -= 1;
    lastCoalesceKey = null;
    lastCommandAt = 0;
    useSelectionStore.getState().clear();
    ctx.drawSource.changed();
    syncFlags(set);
    return true;
  },

  redo: async () => {
    if (pointer >= executed.length - 1) {
      syncFlags(set);
      return false;
    }
    const ctx = getCommandContext();
    if (!ctx) return false;

    const command = executed[pointer + 1];
    try {
      if (command.redo) {
        await command.redo(ctx);
      } else {
        await command.execute(ctx);
      }
    } catch (err) {
      console.error(`CommandStack: error al rehacer "${command.label}"`, err);
    }
    pointer += 1;
    lastCoalesceKey = null;
    lastCommandAt = 0;
    useSelectionStore.getState().clear();
    ctx.drawSource.changed();
    syncFlags(set);
    return true;
  },

  clear: () => {
    executed = [];
    pointer = -1;
    lastCoalesceKey = null;
    lastCommandAt = 0;
    set({ canUndo: false, canRedo: false });
  },

  refresh: () => {
    syncFlags(set);
  },
}));

// ─── Helpers exportados ─────────────────────────────────────────────────

export async function runCommand(command: Command): Promise<RunResult> {
  return useCommandStack.getState().run(command);
}

export async function undo(): Promise<boolean> {
  return useCommandStack.getState().undo();
}

export async function redo(): Promise<boolean> {
  return useCommandStack.getState().redo();
}

export { type CommandContext };