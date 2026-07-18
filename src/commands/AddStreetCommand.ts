import { Command, type CommandContext } from './Command';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';

export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  private readonly start: [number, number];
  private readonly end: [number, number];
  private readonly widthM: number;
  private readonly curvatureM: number;
  private readonly waypoints?: Array<[number, number]>;
  private streetId: string | null = null;

  constructor(
    start: [number, number],
    end: [number, number],
    widthM: number,
    waypoints?: Array<[number, number]>,
    curvatureM = 0,
  ) {
    super();
    this.start = start;
    this.end = end;
    this.widthM = widthM;
    this.waypoints = waypoints;
    this.curvatureM = curvatureM;
  }

  execute(_ctx: CommandContext): void {
    this.streetId = useStreetStore.getState().addStreet({
      start: this.start,
      end: this.end,
      widthM: this.widthM,
      curvature: this.curvatureM > 0 ? this.curvatureM : undefined,
      waypoints: this.waypoints,
    });
    recomputeManzanos();
  }

  override undo(_ctx: CommandContext): void {
    if (this.streetId) {
      useStreetStore.getState().removeStreet(this.streetId);
    }
    // Los manzanos nuevos los restaura el snapshot del CommandStack.
  }
}
