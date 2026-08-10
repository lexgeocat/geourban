import { RoadEntityCommand } from './RoadEntityCommand';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { useStreetTracingSessionStore } from '../store/streetTracingSessionStore';
import type { Command } from '@kernel/command/Command';
import type { RoundaboutParams } from '../geometry/roundaboutEngine';

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
