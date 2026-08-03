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

export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
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