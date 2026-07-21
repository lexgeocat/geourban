// src/commands/AddRoundaboutCommand.ts
import { Command, type CommandContext } from './Command';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { recomputeManzanos } from '../store/mapStore';
import type { RoundaboutParams } from '../geo/roundaboutEngine';

export class AddRoundaboutCommand extends Command {
  readonly label = 'Trazar rotonda';
  private readonly params: RoundaboutParams;
  private roundaboutId: string | null = null;

  constructor(params: RoundaboutParams) {
    super();
    this.params = params;
  }

  override async execute(_ctx: CommandContext): Promise<void> {
    this.roundaboutId = useRoundaboutStore.getState().addRoundabout(this.params);
    await recomputeManzanos();
  }

  override undo(_ctx: CommandContext): void {
    if (this.roundaboutId) {
      useRoundaboutStore.getState().removeRoundabout(this.roundaboutId);
    }
  }
}