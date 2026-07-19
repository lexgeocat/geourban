// src/commands/AddRoundaboutCommand.ts
import { Command, type CommandContext } from './Command';
import { useRoundaboutStore } from '../store/roundaboutStore';
import type { RoundaboutParams } from '../geo/roundaboutEngine';

export class AddRoundaboutCommand extends Command {
  readonly label = 'Trazar rotonda';
  private readonly params: RoundaboutParams;
  private roundaboutId: string | null = null;

  constructor(params: RoundaboutParams) {
    super();
    this.params = params;
  }

  execute(_ctx: CommandContext): void {
    this.roundaboutId = useRoundaboutStore.getState().addRoundabout(this.params);
  }

  override undo(_ctx: CommandContext): void {
    if (this.roundaboutId) {
      useRoundaboutStore.getState().removeRoundabout(this.roundaboutId);
    }
  }
}