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

export class AddRoundaboutCommand extends Command {
  readonly label = 'Trazar rotonda';
  private readonly params: RoundaboutParams;
  private roundaboutId: string | null = null;
  private before: DrawSourceSnapshot | null = null;
  private after: DrawSourceSnapshot | null = null;

  constructor(params: RoundaboutParams) {
    super();
    this.params = params;
  }

  override async execute(ctx: CommandContext): Promise<void> {
    this.before = snapshotDrawSource(ctx.drawSource);
    this.roundaboutId = useRoundaboutStore.getState().addRoundabout(this.params);
    await recomputeManzanos();
    this.after = snapshotDrawSource(ctx.drawSource);
  }

  override undo(ctx: CommandContext): void {
    if (this.roundaboutId) {
      useRoundaboutStore.getState().removeRoundabout(this.roundaboutId);
    }
    if (this.before != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.before);
      refreshSourceMetrics(ctx.drawSource);
    }
  }

  override async redo(ctx: CommandContext): Promise<void> {
    if (this.roundaboutId) {
      useRoundaboutStore.getState().addRoundaboutWithId(this.roundaboutId, this.params);
    }
    if (this.after != null) {
      restoreDrawSourceSnapshot(ctx.drawSource, this.after);
      refreshSourceMetrics(ctx.drawSource);
    } else {
      await this.execute(ctx);
    }
  }
}