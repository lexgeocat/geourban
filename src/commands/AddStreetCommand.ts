import { Command, type CommandContext } from './Command';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';

export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  private readonly start: [number, number];
  private readonly end: [number, number];
  private readonly widthM: number;
  private streetId: string | null = null;

  constructor(start: [number, number], end: [number, number], widthM: number) {
    super();
    this.start = start;
    this.end = end;
    this.widthM = widthM;
  }

  execute(_ctx: CommandContext): void {
    this.streetId = useStreetStore.getState().addStreet({
      start: this.start,
      end: this.end,
      widthM: this.widthM,
    });
    // Recortar polígonos por la nueva calle → manzanos. Este efecto es
    // destructivo sobre el drawSource; el snapshot pre del CommandStack
    // permite deshacerlo.
    recomputeManzanos();
  }

  override undo(_ctx: CommandContext): void {
    if (this.streetId) {
      useStreetStore.getState().removeStreet(this.streetId);
    }
    // Los manzanos nuevos los restaura el snapshot del CommandStack.
  }
}
