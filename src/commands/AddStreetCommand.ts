import { Command, type CommandContext } from './Command';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';
import { refreshSourceMetrics } from '../geo/metrics';
import {
  snapshotDrawSource,
  restoreDrawSourceSnapshot,
  type DrawSourceSnapshot,
} from './drawSourceSnapshot';

interface StreetEntry {
  id: string | null;
  start: [number, number];
  end: [number, number];
  widthM: number;
  sideWidthM: number;
  waypoints?: Array<[number, number]>;
}

/**
 * Traza una calle.
 *
 * `recomputeManzanos()` ahora es debounced (ver diagnóstico H12 en
 * mapStore.ts): varias llamadas próximas comparten UN solo recompute
 * real. Esto significa que si el usuario traza varias calles en sucesión
 * rápida, sus respectivos `execute()` pueden terminar esperando la MISMA
 * ejecución compartida — y por lo tanto, ya no es seguro asumir que el
 * `before`/`after` de cada comando individual es exacto respecto al
 * resto.
 *
 * Solución: instancias trazadas dentro de la ventana de coalescing del
 * CommandStack se FUSIONAN vía `coalesceInto` en una sola entrada de
 * historial (mismo mecanismo que ya usa ModifyGeometryCommand para
 * arrastres consecutivos). El comando resultante conserva el `before`
 * original (antes de CUALQUIER calle del lote) y adopta el `after` de la
 * última absorbida — que ya refleja el estado combinado, porque para
 * cuando ese recompute compartido corre, TODAS las calles del lote ya
 * fueron agregadas a streetStore (cada `addStreet()` es síncrono, ocurre
 * antes de cualquier `await`).
 */
export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  readonly coalesceKey = 'AddStreetCommand';

  private entries: StreetEntry[];
  private before: DrawSourceSnapshot | null = null;
  private after: DrawSourceSnapshot | null = null;

  constructor(
    start: [number, number],
    end: [number, number],
    widthM: number,
    waypoints?: Array<[number, number]>,
    sideWidthM?: number,
  ) {
    super();
    this.entries = [{
      id: null,
      start,
      end,
      widthM,
      waypoints,
      sideWidthM: sideWidthM ?? useStreetStore.getState().defaultSideWidthM,
    }];
  }

  override async execute(ctx: CommandContext): Promise<void> {
    if (this.before == null) {
      this.before = snapshotDrawSource(ctx.drawSource);
    }
    const entry = this.entries[this.entries.length - 1];
    entry.id = useStreetStore.getState().addStreet({
      start: entry.start,
      end: entry.end,
      widthM: entry.widthM,
      sideWidthM: entry.sideWidthM,
      waypoints: entry.waypoints,
    });
    await recomputeManzanos();
    this.after = snapshotDrawSource(ctx.drawSource);
  }

  override undo(ctx: CommandContext): void {
    for (const e of this.entries) {
      if (e.id) useStreetStore.getState().removeStreet(e.id);
    }
    if (this.before != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.before);
      refreshSourceMetrics(ctx.drawSource);
    }
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
        });
      }
    }
    if (this.after != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.after);
      refreshSourceMetrics(ctx.drawSource);
    } else {
      await this.execute(ctx);
    }
  }

  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof AddStreetCommand)) return false;
    previous.entries.push(...this.entries);
    previous.after = this.after;
    return true;
  }
}