import { Command, type CommandContext } from './Command';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';

export class AddStreetCommand extends Command {
  readonly label = 'Trazar calle';
  private readonly start: [number, number];
  private readonly end: [number, number];
  private readonly widthM: number;
  private readonly sideWidthM: number;
  private readonly waypoints?: Array<[number, number]>;
  private streetId: string | null = null;

  constructor(
    start: [number, number],
    end: [number, number],
    widthM: number,
    waypoints?: Array<[number, number]>,
    sideWidthM?: number,
  ) {
    super();
    this.start = start;
    this.end = end;
    this.widthM = widthM;
    this.waypoints = waypoints;
    this.sideWidthM = sideWidthM ?? useStreetStore.getState().defaultSideWidthM;
  }

  execute(_ctx: CommandContext): void {
    this.streetId = useStreetStore.getState().addStreet({
      start: this.start,
      end: this.end,
      widthM: this.widthM,
      sideWidthM: this.sideWidthM,
      waypoints: this.waypoints,
    });
    recomputeManzanos();
  }

  override undo(_ctx: CommandContext): void {
    if (this.streetId) {
      useStreetStore.getState().removeStreet(this.streetId);
    }
  }
}
