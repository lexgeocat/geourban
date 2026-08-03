import { Command, type CommandContext } from '../core/Command';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
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
import type { RoundaboutParams } from '../../geo/roundabout/roundaboutEngine';

interface RoundaboutEntry {
  id: string | null;
  params: RoundaboutParams;
}

export class AddRoundaboutCommand extends Command {
  readonly label = 'Trazar rotonda';
  readonly coalesceKey: string;

  private entries: RoundaboutEntry[];
  private diff: StructuralDiff = EMPTY_STRUCTURAL_DIFF;

  constructor(params: RoundaboutParams) {
    super();
    this.coalesceKey = `roundabout:${useStreetTracingSessionStore.getState().currentSessionId}`;
    this.entries = [{ id: null, params }];
  }

  override async execute(_ctx: CommandContext): Promise<void> {
    await waitForPendingRecompute();
    const entry = this.entries[this.entries.length - 1];
    entry.id = useRoundaboutStore.getState().addRoundabout(entry.params);
    const stepDiff = await recomputeManzanos();
    this.diff = composeStructuralDiffs(this.diff, stepDiff);
  }

  override undo(ctx: CommandContext): void {
    for (const e of this.entries) {
      if (e.id) useRoundaboutStore.getState().removeRoundabout(e.id);
    }
    revertStructuralDiff(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override async redo(ctx: CommandContext): Promise<void> {
    for (const e of this.entries) {
      if (e.id) useRoundaboutStore.getState().addRoundaboutWithId(e.id, e.params);
    }
    applyStructuralDiffForward(ctx.drawSource, this.diff);
    refreshSourceMetrics(ctx.drawSource);
  }

  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof AddRoundaboutCommand)) return false;
    previous.entries.push(...this.entries);
    previous.diff = composeStructuralDiffs(previous.diff, this.diff);
    return true;
  }

  override approxMemoryBytes(): number {
    return approxStructuralDiffBytes(this.diff);
  }
}