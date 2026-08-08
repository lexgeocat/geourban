// Base genérica para los comandos que agregan entidades viales (calles y
// rotondas). Ambos comparten: coalesce por sesión, diff estructural tras el
// recálculo de manzanos, undo/redo simétrico.
import { Command, type CommandContext } from '../core/Command';
import { recomputeManzanos, waitForPendingRecompute } from '../../geo/recomputeManzanos';
import { refreshSourceMetrics } from '../../geo/metrics';
import {
  composeStructuralDiffs,
  applyStructuralDiffForward,
  revertStructuralDiff,
  approxStructuralDiffBytes,
  EMPTY_STRUCTURAL_DIFF,
  type StructuralDiff,
} from '../core/structuralDiff';

export interface RoadEntityEntry<TParams> {
  id: string | null;
  params: TParams;
}

export abstract class RoadEntityCommand<TParams, TStore> extends Command {
  abstract readonly label: string;
  readonly coalesceKey: string;

  protected entries: RoadEntityEntry<TParams>[];
  protected diff: StructuralDiff = EMPTY_STRUCTURAL_DIFF;

  constructor(coalescePrefix: string, sessionIdSource: () => string, params: TParams) {
    super();
    this.coalesceKey = `${coalescePrefix}:${sessionIdSource()}`;
    this.entries = [{ id: null, params }];
  }

  protected abstract getStore(): TStore;

  /** Agrega una nueva entidad al store; devuelve el id asignado. */
  protected abstract addToStore(params: TParams): string;

  /** Re-construye una entidad con id existente (para redo). */
  protected abstract addWithId(id: string, params: TParams): void;

  /** Elimina la entidad del store por id. */
  protected abstract removeFromStore(id: string): void;

  /** Tipo concreto del command (para evitar que coalesce mezcle calles con rotondas). */
  protected abstract sameKind(other: Command): boolean;

  override async execute(_ctx: CommandContext): Promise<void> {
    await waitForPendingRecompute();
    const entry = this.entries[this.entries.length - 1];
    entry.id = this.addToStore(entry.params);
    const stepDiff = await recomputeManzanos();
    this.diff = composeStructuralDiffs(this.diff, stepDiff);
  }

  override undo(ctx: CommandContext): void {
    for (const e of this.entries) {
      if (e.id) this.removeFromStore(e.id);
    }
    revertStructuralDiff(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override async redo(ctx: CommandContext): Promise<void> {
    for (const e of this.entries) {
      if (e.id) this.addWithId(e.id, e.params);
    }
    applyStructuralDiffForward(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override coalesceInto(previous: Command): boolean {
    if (!this.sameKind(previous)) return false;
    const prev = previous as RoadEntityCommand<TParams, TStore>;
    prev.entries.push(...this.entries);
    prev.diff = composeStructuralDiffs(prev.diff, this.diff);
    return true;
  }

  override approxMemoryBytes(): number {
    return approxStructuralDiffBytes(this.diff);
  }
}
