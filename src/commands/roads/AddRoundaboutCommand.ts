import { RoadEntityCommand } from './RoadEntityCommand';
import { useRoundaboutStore } from '../../store/entities/roundaboutStore';
import { useStreetTracingSessionStore } from '../../store/ui/streetTracingSessionStore';
import type { Command } from '../core/Command';
import type { RoundaboutParams } from '../../geo/roundabout/roundaboutEngine';

// Re-export del tipo de input para no obligar a los consumidores a importar
// desde `geo/roundabout/roundaboutEngine`.
export type { RoundaboutParams };

export class AddRoundaboutCommand extends RoadEntityCommand<
  RoundaboutParams,
  ReturnType<typeof useRoundaboutStore.getState>
> {
  readonly label = 'Trazar rotonda';

  constructor(params: RoundaboutParams) {
    super(
      'roundabout',
      () => useStreetTracingSessionStore.getState().currentSessionId,
      params,
    );
  }

  protected getStore() {
    return useRoundaboutStore.getState();
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
