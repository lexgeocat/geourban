import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';

export class MoveFeaturesToLayerCommand extends Command {
  readonly label = 'Mover a otra capa';
  private readonly ids: Array<string | number>;
  private readonly targetLayerId: string;
  private before = new globalThis.Map<string | number, string | undefined>();

  constructor(ids: Array<string | number>, targetLayerId: string) {
    super();
    this.ids = ids;
    this.targetLayerId = targetLayerId;
  }

  execute(ctx: CommandContext): void {
    this.before.clear();
    for (const id of this.ids) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      this.before.set(id, f.get('layerId') as string | undefined);
      f.set('layerId', this.targetLayerId, true);
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const [id, prevLayerId] of this.before) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      if (prevLayerId) f.set('layerId', prevLayerId, true);
      else f.unset('layerId', true);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}