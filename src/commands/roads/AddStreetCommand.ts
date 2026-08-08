import { RoadEntityCommand } from './RoadEntityCommand';
import { useStreetStore, type Street } from '../../store/entities/streetStore';
import { useStreetTracingSessionStore } from '../../store/ui/streetTracingSessionStore';
import type { Command } from '../core/Command';

export class AddStreetCommand extends RoadEntityCommand<
  Omit<Street, 'id' | 'name'>,
  ReturnType<typeof useStreetStore.getState>
> {
  readonly label = 'Trazar calle';

  constructor(
    start: [number, number],
    end: [number, number],
    widthM: number,
    waypoints?: Array<[number, number]>,
    sideWidthM?: number,
    layerId?: string,
  ) {
    super(
      'street',
      () => useStreetTracingSessionStore.getState().currentSessionId,
      {
        start,
        end,
        widthM,
        waypoints,
        sideWidthM: sideWidthM ?? useStreetStore.getState().defaultSideWidthM,
        layerId,
      },
    );
  }

  protected getStore() {
    return useStreetStore.getState();
  }

  protected addToStore(params: Omit<Street, 'id' | 'name'>): string {
    return useStreetStore.getState().addStreet(params);
  }

  protected addWithId(id: string, params: Omit<Street, 'id' | 'name'>): void {
    useStreetStore.getState().addStreetWithId(id, params);
  }

  protected removeFromStore(id: string): void {
    useStreetStore.getState().removeStreet(id);
  }

  protected sameKind(other: Command): boolean {
    return other instanceof AddStreetCommand;
  }
}
