import { Command, type CommandContext } from './Command';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { recomputeManzanos } from '../store/mapStore';
import { refreshSourceMetrics } from '../geo/metrics';
import {
  snapshotDrawSource,
  restoreDrawSourceSnapshot,
  type DrawSourceSnapshot,
} from './drawSourceSnapshot';
import type { RoundaboutParams } from '../geo/roundaboutEngine';

interface RoundaboutEntry {
  id: string | null;
  params: RoundaboutParams;
}

/** Traza una rotonda. Ver AddStreetCommand.ts para la explicación
 *  completa de por qué fusiona instancias consecutivas vía
 *  `coalesceInto` (necesario para convivir con el debounce de
 *  `recomputeManzanos()`, H12). */
export class AddRoundaboutCommand extends Command {
  readonly label = 'Trazar rotonda';
  readonly coalesceKey = 'AddRoundaboutCommand';

  private entries: RoundaboutEntry[];
  private before: DrawSourceSnapshot | null = null;
  private after: DrawSourceSnapshot | null = null;

  constructor(params: RoundaboutParams) {
    super();
    this.entries = [{ id: null, params }];
  }

  override async execute(ctx: CommandContext): Promise<void> {
    if (this.before == null) {
      this.before = snapshotDrawSource(ctx.drawSource);
    }
    const entry = this.entries[this.entries.length - 1];
    entry.id = useRoundaboutStore.getState().addRoundabout(entry.params);
    await recomputeManzanos();
    this.after = snapshotDrawSource(ctx.drawSource);
  }

  override undo(ctx: CommandContext): void {
    for (const e of this.entries) {
      if (e.id) useRoundaboutStore.getState().removeRoundabout(e.id);
    }
    if (this.before != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.before);
      refreshSourceMetrics(ctx.drawSource);
    }
  }

  override async redo(ctx: CommandContext): Promise<void> {
    for (const e of this.entries) {
      if (e.id) useRoundaboutStore.getState().addRoundaboutWithId(e.id, e.params);
    }
    if (this.after != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.after);
      refreshSourceMetrics(ctx.drawSource);
    } else {
      await this.execute(ctx);
    }
  }

  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof AddRoundaboutCommand)) return false;
    previous.entries.push(...this.entries);
    previous.after = this.after;
    return true;
  }
}