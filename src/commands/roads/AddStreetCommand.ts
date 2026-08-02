import { Command, type CommandContext } from '../core/Command';
import { useStreetStore } from '../../store/entities/streetStore';
import { useStreetTracingSessionStore } from '../../store/ui/streetTracingSessionStore';
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

interface StreetEntry {
  id: string | null;
  start: [number, number];
  end: [number, number];
  widthM: number;
  sideWidthM: number;
  waypoints?: Array<[number, number]>;
  layerId?: string;
}

/**
 * Fase 3.2 (auditoria-para-mejora.md, §6, Fase 3) — ya no serializa el
 * drawSource COMPLETO en cada trazo de calle (antes/después vía snapshot
 * GeoJSON del proyecto — el bug crítico de §2.1; ese snapshot fue
 * eliminado en la Fase 3.4). El undo/redo se arma
 * a partir del `StructuralDiff` que devuelve `recomputeManzanos()`: solo
 * los manzanos/lotes que esta calle realmente afectó, sin importar el
 * tamaño total del proyecto.
 */
export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  /** Una key por sesión de trazo (cambia en cada `drawstart` de StreetMode).
   * Garantiza que dos trazos consecutivos NO se fusionen en un único undo. */
  readonly coalesceKey: string;

  private entries: StreetEntry[];
  private diff: StructuralDiff = EMPTY_STRUCTURAL_DIFF;

  constructor(
    start: [number, number],
    end: [number, number],
    widthM: number,
    waypoints?: Array<[number, number]>,
    sideWidthM?: number,
    layerId?: string,
  ) {
    super();
    this.coalesceKey = `street:${useStreetTracingSessionStore.getState().currentSessionId}`;
    this.entries = [{
      id: null,
      start,
      end,
      widthM,
      waypoints,
      sideWidthM: sideWidthM ?? useStreetStore.getState().defaultSideWidthM,
      layerId,
    }];
  }

  override async execute(_ctx: CommandContext): Promise<void> {
    // Esperar cualquier recompute en curso antes de arrancar el propio:
    // evita que el diff de esta operación se contamine con cambios de
    // otro comando corriendo en simultáneo.
    await waitForPendingRecompute();
    const entry = this.entries[this.entries.length - 1];
    entry.id = useStreetStore.getState().addStreet({
      start: entry.start,
      end: entry.end,
      widthM: entry.widthM,
      sideWidthM: entry.sideWidthM,
      waypoints: entry.waypoints,
      layerId: entry.layerId,
    });
    const stepDiff = await recomputeManzanos();
    this.diff = composeStructuralDiffs(this.diff, stepDiff);
  }

  override undo(ctx: CommandContext): void {
    for (const e of this.entries) {
      if (e.id) useStreetStore.getState().removeStreet(e.id);
    }
    revertStructuralDiff(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override async redo(ctx: CommandContext): Promise<void> {
    for (const e of this.entries) {
      if (e.id) {
        useStreetStore.getState().addStreetWithId(e.id, {
          start: e.start,
          end: e.end,
          widthM: e.widthM,
          sideWidthM: e.sideWidthM,
          waypoints: e.waypoints,
          layerId: e.layerId,
        });
      }
    }
    applyStructuralDiffForward(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof AddStreetCommand)) return false;
    previous.entries.push(...this.entries);
    previous.diff = composeStructuralDiffs(previous.diff, this.diff);
    return true;
  }

  override approxMemoryBytes(): number {
    return approxStructuralDiffBytes(this.diff);
  }
}