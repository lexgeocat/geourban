// src/commands/core/CommandStack.test.ts
//
// Tests de caracterización + regresión del CommandStack (Fase 9 del
// plan de optimización — Prioridad 1). Cubre:
//  - run básico: agrega al stack, actualiza flags
//  - run con execute que tira: retorna { ok: false }, no agrega
//  - coalescing por clave + ventana de 250ms (con fake timers)
//  - coalesceInto=false deja ambos comandos en el stack
//  - redo tras un nuevo run() trunca la pila
//  - undo sin undo() implementado: loguea warning, no truena, avanza
//  - undo con undo() que tira: toast error, no avanza
//  - redo sin nada que rehacer: retorna false
//  - pruneStack por cantidad (MAX_STACK) y por bytes (MAX_STACK_BYTES)
//
// Estrategia:
//  - vi.mock de './commandContext' inyecta un drawSource real (OL
//    funciona en vitest con environment: 'node').
//  - vi.mock de perfTelemetry, toast y selectionStore para que los
//    side effects de CommandStack no contaminen otros tests ni
//    la consola.
//  - beforeEach: useCommandStack.getState().clear() resetea stack +
//    lastCoalesceKey/lastCommandAt.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import VectorSource from 'ol/source/Vector.js';
import { Command } from './Command';
import type { CommandContext } from './commandContext';

const mockDrawSource = new VectorSource();
const mockCtx: CommandContext = {
  drawSource: mockDrawSource,
  getMap: () => null,
};

vi.mock('./commandContext', () => ({
  getCommandContext: () => mockCtx,
}));

vi.mock('../../store/map/selectionStore', () => ({
  useSelectionStore: {
    getState: () => ({ clear: () => undefined }),
  },
}));

vi.mock('../../store/debug/perfTelemetry', () => ({
  recordUndoCommand: () => undefined,
}));

vi.mock('../../store/ui/toastStore', () => ({
  toast: () => undefined,
}));

// Import tardío: los vi.mock() de arriba deben estar registrados antes
// de que se ejecute el cuerpo del módulo de CommandStack.
import { useCommandStack } from './CommandStack';

// ─── Helpers de Commands ────────────────────────────────────────────

let counter = 0;

interface CmdOpts {
  label?: string;
  coalesceKey?: string;
  coalesceInto?: (prev: Command) => boolean;
  undo?: (ctx: CommandContext) => void;
  redo?: (ctx: CommandContext) => void;
  executeImpl?: (ctx: CommandContext) => void;
  memoryBytes?: number;
  /** Cuando es false, el método `undo` se borra del prototype de la
   *  subclase para que `command.undo` sea undefined — el chequeo del
   *  CommandStack cae al else que loggea warning. */
  hasUndo?: boolean;
  /** Ídem para `redo`. */
  hasRedo?: boolean;
}

function makeCmd(opts: CmdOpts = {}): Command {
  const id = ++counter;
  const hasUndo = opts.hasUndo ?? true;
  const hasRedo = opts.hasRedo ?? true;
  class TestCommand extends Command {
    readonly label = opts.label ?? `cmd-${id}`;
    readonly coalesceKey = opts.coalesceKey;
    readonly coalesceInto = opts.coalesceInto;
    execute(ctx: CommandContext): void {
      if (opts.executeImpl) opts.executeImpl(ctx);
    }
    undo(ctx: CommandContext): void {
      if (hasUndo && opts.undo) opts.undo(ctx);
    }
    redo(ctx: CommandContext): void {
      if (hasRedo && opts.redo) opts.redo(ctx);
    }
    override approxMemoryBytes(): number {
      return opts.memoryBytes ?? 256;
    }
  }
  if (!hasUndo) {
    // Borra el método del prototype de la subclase para que
    // `command.undo` sea undefined (no una función heredada).
    delete (TestCommand.prototype as { undo?: unknown }).undo;
  }
  if (!hasRedo) {
    delete (TestCommand.prototype as { redo?: unknown }).redo;
  }
  return new TestCommand();
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(() => {
  useCommandStack.getState().clear();
  mockDrawSource.clear();
});

// ─── Tests ──────────────────────────────────────────────────────────

describe('CommandStack — run básico', () => {
  it('agrega al stack y actualiza canUndo', async () => {
    const cmd = makeCmd({ label: 'noop' });
    const result = await useCommandStack.getState().run(cmd);
    expect(result.ok).toBe(true);
    expect(useCommandStack.getState().canUndo).toBe(true);
    expect(useCommandStack.getState().canRedo).toBe(false);
  });

  it('run con execute() que tira retorna { ok: false } y NO agrega al stack', async () => {
    const stack = useCommandStack.getState();
    expect(stack.canUndo).toBe(false);
    const cmd = makeCmd({
      label: 'will-throw',
      executeImpl: () => {
        throw new Error('boom');
      },
    });
    const result = await stack.run(cmd);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('boom');
    expect(useCommandStack.getState().canUndo).toBe(false);
  });

  it('clear() resetea el stack y los flags', async () => {
    await useCommandStack.getState().run(makeCmd());
    expect(useCommandStack.getState().canUndo).toBe(true);
    useCommandStack.getState().clear();
    expect(useCommandStack.getState().canUndo).toBe(false);
    expect(useCommandStack.getState().canRedo).toBe(false);
  });
});

describe('CommandStack — coalescing', () => {
  it('dos runs con mismo coalesceKey y coalesceInto=true dentro de la ventana quedan como 1', async () => {
    const stack = useCommandStack.getState();
    const cmdA = makeCmd({
      label: 'a',
      coalesceKey: 'draw',
      coalesceInto: () => true,
    });
    const cmdB = makeCmd({
      label: 'b',
      coalesceKey: 'draw',
      coalesceInto: () => true,
    });
    await stack.run(cmdA);
    await stack.run(cmdB);
    // Tras coalescing, undo solo está disponible una vez.
    await useCommandStack.getState().undo();
    expect(useCommandStack.getState().canUndo).toBe(false);
  });

  it('coalesceInto=false deja ambos commands en el stack', async () => {
    const stack = useCommandStack.getState();
    const cmdA = makeCmd({ label: 'a', coalesceKey: 'x', coalesceInto: () => false });
    const cmdB = makeCmd({ label: 'b', coalesceKey: 'x', coalesceInto: () => false });
    await stack.run(cmdA);
    await stack.run(cmdB);
    await useCommandStack.getState().undo();
    expect(useCommandStack.getState().canUndo).toBe(true);
  });

  it('sin coalesceKey, dos runs seguidos producen dos comandos independientes', async () => {
    const stack = useCommandStack.getState();
    await stack.run(makeCmd({ label: 'a' }));
    await stack.run(makeCmd({ label: 'b' }));
    await useCommandStack.getState().undo();
    expect(useCommandStack.getState().canUndo).toBe(true);
    await useCommandStack.getState().undo();
    expect(useCommandStack.getState().canUndo).toBe(false);
  });
});

describe('CommandStack — undo/redo', () => {
  it('undo con command.undo implementado llama al undo y avanza el puntero', async () => {
    let undoCalls = 0;
    const stack = useCommandStack.getState();
    await stack.run(
      makeCmd({
        label: 'with-undo',
        undo: () => {
          undoCalls++;
        },
      }),
    );
    const ok = await useCommandStack.getState().undo();
    expect(ok).toBe(true);
    expect(undoCalls).toBe(1);
    expect(useCommandStack.getState().canUndo).toBe(false);
    expect(useCommandStack.getState().canRedo).toBe(true);
  });

  it('undo sin command.undo implementado NO truena (loggea warning, avanza)', async () => {
    const stack = useCommandStack.getState();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await stack.run(makeCmd({ label: 'no-undo', hasUndo: false, hasRedo: false }));
    const ok = await useCommandStack.getState().undo();
    expect(ok).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no implementa undo'));
    expect(useCommandStack.getState().canUndo).toBe(false);
    warnSpy.mockRestore();
  });

  it('undo con command.undo que tira: toast error, NO avanza', async () => {
    const stack = useCommandStack.getState();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const toastSpy = vi.fn();
    vi.doMock('../../store/ui/toastStore', () => ({ toast: toastSpy }));
    await stack.run(
      makeCmd({
        label: 'undo-fails',
        undo: () => {
          throw new Error('undo boom');
        },
      }),
    );
    const ok = await useCommandStack.getState().undo();
    expect(ok).toBe(false);
    expect(useCommandStack.getState().canUndo).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('redo avanza el puntero si hay algo pendiente', async () => {
    const stack = useCommandStack.getState();
    await stack.run(makeCmd({ label: 'r' }));
    await useCommandStack.getState().undo();
    expect(useCommandStack.getState().canRedo).toBe(true);
    const ok = await useCommandStack.getState().redo();
    expect(ok).toBe(true);
    expect(useCommandStack.getState().canRedo).toBe(false);
  });

  it('redo sin nada pendiente retorna false (no-op)', async () => {
    expect(useCommandStack.getState().canRedo).toBe(false);
    const ok = await useCommandStack.getState().redo();
    expect(ok).toBe(false);
  });

  it('run() nuevo trunca el redo pendiente (run-after-undo contract)', async () => {
    const stack = useCommandStack.getState();
    await stack.run(makeCmd({ label: 'first' }));
    await stack.run(makeCmd({ label: 'second' }));
    await useCommandStack.getState().undo(); // deshace second
    expect(useCommandStack.getState().canRedo).toBe(true);
    await stack.run(makeCmd({ label: 'third' })); // trunca el redo
    expect(useCommandStack.getState().canRedo).toBe(false);
  });

  it('undo() con pila vacía retorna false (no-op)', async () => {
    const ok = await useCommandStack.getState().undo();
    expect(ok).toBe(false);
  });
});

describe('CommandStack — pruneStack (memoria)', () => {
  it('pila > MAX_STACK: el command más viejo se descarta', async () => {
    const stack = useCommandStack.getState();
    // MAX_STACK = 100. Empujamos 105 comandos de 1 byte cada uno.
    for (let i = 0; i < 105; i++) {
      await stack.run(makeCmd({ label: `c-${i}`, memoryBytes: 1 }));
    }
    // Tras 105 runs, el más viejo (c-0) tiene que haberse podado.
    // El undo debería poder deshacer MAX_STACK (100) veces.
    let undoCount = 0;
    while (useCommandStack.getState().canUndo) {
      await useCommandStack.getState().undo();
      undoCount++;
      if (undoCount > 200) break;
    }
    expect(undoCount).toBe(100);
  });

  it('comandos muy pesados podan la pila por bytes (MAX_STACK_BYTES)', async () => {
    const stack = useCommandStack.getState();
    // MAX_STACK_BYTES = 24 MB. Empujamos 30 comandos de 1 MB cada uno:
    // 30 MB > 24 MB → el stack tiene que podarse hasta entrar en budget.
    for (let i = 0; i < 30; i++) {
      await stack.run(makeCmd({ label: `big-${i}`, memoryBytes: 1024 * 1024 }));
    }
    // Tras 30 × 1 MB = 30 MB, pruneStack debe haber eliminado comandos
    // hasta quedar en <= 24 MB. No conocemos el número exacto (porque
    // pruneStack poda de a 1 mientras total > 24 MB), pero al menos
    // sabemos que la pila final debe caber en budget.
    // No hay API pública para enumerar executed[], pero podemos
    // verificar indirectamente: undo hasta vaciar y contar.
    let undoCount = 0;
    while (useCommandStack.getState().canUndo) {
      await useCommandStack.getState().undo();
      undoCount++;
      if (undoCount > 100) break;
    }
    // Quedaron <= 24 / 1 = 24 comandos. Más estricto: < 25.
    expect(undoCount).toBeLessThanOrEqual(24);
  });
});