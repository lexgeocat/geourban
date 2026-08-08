import { RoadEntityCommand } from './RoadEntityCommand';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useStreetTracingSessionStore } from '../../store/ui/streetTracingSessionStore';
import type { Command } from '../core/Command';
import type { RoundaboutParams } from '../../geo/roundabout/roundaboutEngine';

export class AddRoundaboutCommand extends RoadEntityCommand<RoundaboutParams> {
  readonly label = 'Trazar rotonda';

  constructor(params: RoundaboutParams) {
    super(
      'roundabout',
      () => useStreetTracingSessionStore.getState().currentSessionId,
      params,
    );
  }

  protected addToStore(params: RoundaboutParams): string {
    return useRoundaboutStore.getState().addRoundabout(params);
  }

  protected addWithId(id: string, params: RoundaboutParams): void {
    useRoundaboutStore.getState().addRoundaboutWithId(id, params);
  }

  protected removeFromStore(id: string): void {
    useRoundaboutStore.getState().removeRoundabout(id);
  }

  protected sameKind(other: Command): boolean {
    return other instanceof AddRoundaboutCommand;
  }
}
