import { Command, type CommandContext } from '../core/Command';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { recomputeManzanos, waitForPendingRecompute } from '../../geo/recomputeManzanos';
import { refreshSourceMetrics } from '../../geo/metrics';
import {
  snapshotDrawSource,
  restoreDrawSourceSnapshot,
  type DrawSourceSnapshot,
} from '../core/drawSourceSnapshot';
import type { RoundaboutParams } from '../../geo/roundabout/roundaboutEngine';

interface RoundaboutEntry {
  id: string | null;
  params: RoundaboutParams;
}

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
      await waitForPendingRecompute();
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

  override approxMemoryBytes(): number {
    return (this.before?.length ?? 0) * 2 + (this.after?.length ?? 0) * 2;
  }
}