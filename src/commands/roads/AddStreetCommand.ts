import { Command, type CommandContext } from '../core/Command';
import { useStreetStore } from '../../store/entities/streetStore';
import { recomputeManzanos, waitForPendingRecompute } from '../../geo/recomputeManzanos';
import { refreshSourceMetrics } from '../../geo/metrics';
import {
  snapshotDrawSource,
  restoreDrawSourceSnapshot,
  type DrawSourceSnapshot,
} from '../core/drawSourceSnapshot';

interface StreetEntry {
  id: string | null;
  start: [number, number];
  end: [number, number];
  widthM: number;
  sideWidthM: number;
  waypoints?: Array<[number, number]>;
  layerId?: string;
}

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
    layerId?: string,
  ) {
    super();
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

  override async execute(ctx: CommandContext): Promise<void> {
    if (this.before == null) {
      await waitForPendingRecompute();
      this.before = snapshotDrawSource(ctx.drawSource);
    }
    const entry = this.entries[this.entries.length - 1];
    entry.id = useStreetStore.getState().addStreet({
      start: entry.start,
      end: entry.end,
      widthM: entry.widthM,
      sideWidthM: entry.sideWidthM,
      waypoints: entry.waypoints,
      layerId: entry.layerId,
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
          layerId: e.layerId,
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

  override approxMemoryBytes(): number {
    return (this.before?.length ?? 0) * 2 + (this.after?.length ?? 0) * 2;
  }
}