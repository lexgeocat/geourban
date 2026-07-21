import { Command, type CommandContext } from './Command';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';
import { refreshSourceMetrics } from '../geo/metrics';
import {
  snapshotDrawSource,
  restoreDrawSourceSnapshot,
  type DrawSourceSnapshot,
} from './drawSourceSnapshot';

export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  private readonly start: [number, number];
  private readonly end: [number, number];
  private readonly widthM: number;
  private readonly sideWidthM: number;
  private readonly waypoints?: Array<[number, number]>;
  private streetId: string | null = null;

  // recomputeManzanos() puede reparticionar cualquier manzano/lote del
  // proyecto — no solo los que tocan esta calle — así que el undo/redo no
  // se puede reconstruir con una lista acotada de ids. Antes, undo() solo
  // borraba la calle de useStreetStore y dejaba los fragmentos de manzano
  // huérfanos en el mapa (H1 del diagnóstico).
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
    this.start = start;
    this.end = end;
    this.widthM = widthM;
    this.waypoints = waypoints;
    this.sideWidthM = sideWidthM ?? useStreetStore.getState().defaultSideWidthM;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    this.before = snapshotDrawSource(ctx.drawSource);
    this.streetId = useStreetStore.getState().addStreet({
      start: this.start,
      end: this.end,
      widthM: this.widthM,
      sideWidthM: this.sideWidthM,
      waypoints: this.waypoints,
    });
    await recomputeManzanos();
    this.after = snapshotDrawSource(ctx.drawSource);
  }

  override undo(ctx: CommandContext): void {
    if (this.streetId) {
      useStreetStore.getState().removeStreet(this.streetId);
    }
    if (this.before != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.before);
      refreshSourceMetrics(ctx.drawSource);
    }
  }

  override async redo(ctx: CommandContext): Promise<void> {
    if (this.streetId) {
      useStreetStore.getState().addStreetWithId(this.streetId, {
        start: this.start,
        end: this.end,
        widthM: this.widthM,
        sideWidthM: this.sideWidthM,
        waypoints: this.waypoints,
      });
    }
    if (this.after != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.after);
      refreshSourceMetrics(ctx.drawSource);
    } else {
      await this.execute(ctx);
    }
  }
}