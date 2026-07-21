// src/commands/CommandStack.ts
import { create } from 'zustand';
import { Command, type CommandContext, getCommandContext } from './Command';
import { useSelectionStore } from '../store/selectionStore';

type RunResult =
  | { ok: true; command: Command }
  | { ok: false; error: string };

const COALESCE_WINDOW_MS = 250;
/** Tope de profundidad del historial. A diferencia del viejo `historyStore`
 *  (que guardaba snapshots GeoJSON completos, caros de mantener en
 *  memoria), acá cada entrada es un Command — mucho más liviano — así que
 *  el tope puede ser generoso. */
const MAX_STACK = 100;

// Pila de comandos ejecutados. Vive fuera del store de Zustand (ver nota
// arriba). El store solo sincroniza banderas derivadas vía syncFlags().
let executed: Command[] = [];
let pointer = -1; // índice del último comando ejecutado; -1 = nada ejecutado
let lastCoalesceKey: string | null = null;
let lastCommandAt = 0;

type CommandStackState = {
  canUndo: boolean;
  canRedo: boolean;
  /** Ejecuta un comando. Único punto de entrada para mutar drawSource. */
  run: (command: Command) => Promise<RunResult>;
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  clear: () => void;
  /** Re-sincroniza canUndo/canRedo desde el estado interno de la pila. */
  refresh: () => void;
};

function syncFlags(set: (partial: Partial<CommandStackState>) => void) {
  set({ canUndo: pointer >= 0, canRedo: pointer < executed.length - 1 });
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

    // Cualquier comando nuevo invalida el "futuro" (redo) pendiente.
    if (pointer < executed.length - 1) {
      executed.splice(pointer + 1);
    }

    const now = Date.now();
    const key = command.coalesceKey ?? null;
    const withinWindow = now - lastCommandAt < COALESCE_WINDOW_MS;
    const top = pointer >= 0 ? executed[pointer] : null;

    // Solo coalescen comandos que EXPLÍCITAMENTE lo soportan (coalesceKey +
    // coalesceInto). A diferencia del viejo esquema (que "saltaba" el
    // snapshot solo por coincidir el label dentro de la ventana, sin fusión
    // real de estado), acá el comando decide cómo absorber el cambio.
    const coalesced =
      withinWindow &&
      top != null &&
      key != null &&
      lastCoalesceKey === key &&
      command.coalesceInto?.(top) === true;

    if (!coalesced) {
      executed.push(command);
      pointer = executed.length - 1;
      if (executed.length > MAX_STACK) {
        const drop = executed.length - MAX_STACK;
        executed.splice(0, drop);
        pointer -= drop;
      }
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
    // Cada Command.undo() ya deja sus propias métricas al día (H9): o
    // restaura props con métricas cacheadas, o llama updateFeatureMetrics()
    // puntual sobre lo que tocó. Los comandos cuyo efecto no está acotado
    // (AddStreetCommand/AddRoundaboutCommand, por el recompute de manzanos)
    // ya hacen su propio refreshSourceMetrics dentro de undo()/redo(). Un
    // refreshSourceMetrics global acá volvía a recalcular TODO el proyecto
    // en cada Ctrl+Z — el mismo costo que H9 eliminó de cada comando
    // individual. `.changed()` solo dispara el re-render.
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
        // Fallback: re-ejecutar es seguro para comandos cuyo execute() es
        // idempotente respecto a su propio estado interno (auditado caso
        // por caso — ver diagnóstico Fase 2).
        await command.execute(ctx);
      }
    } catch (err) {
      console.error(`CommandStack: error al rehacer "${command.label}"`, err);
    }
    pointer += 1;
    lastCoalesceKey = null;
    lastCommandAt = 0;
    useSelectionStore.getState().clear();
    // Mismo criterio que en undo(): sin refresh global, ver nota arriba.
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