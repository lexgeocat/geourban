import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { nextLayerFid } from '@kernel/id/layerFidRegistry';

interface MoveEntry {
  id: string | number;
  prevLayerId: string | undefined;
  prevFid: number | undefined;
  newFid: number;
}

export class MoveFeaturesToLayerCommand extends Command {
  readonly label = 'Mover a otra capa';
  private readonly ids: Array<string | number>;
  private readonly targetLayerId: string;
  private entries: MoveEntry[] = [];

  constructor(ids: Array<string | number>, targetLayerId: string) {
    super();
    this.ids = ids;
    this.targetLayerId = targetLayerId;
  }

  execute(ctx: CommandContext): void {
    this.entries = [];
    for (const id of this.ids) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      const prevLayerId = f.get('layerId') as string | undefined;
      const prevFid = f.get('fid') as number | undefined;
      const newFid = nextLayerFid(this.targetLayerId);
      this.entries.push({ id, prevLayerId, prevFid, newFid });
      f.set('layerId', this.targetLayerId);
      f.set('fid', newFid);
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const { id, prevLayerId, prevFid } of this.entries) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      if (prevLayerId) f.set('layerId', prevLayerId);
      else f.unset('layerId');
      if (prevFid !== undefined) f.set('fid', prevFid);
      else f.unset('fid');
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    for (const { id, newFid } of this.entries) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      f.set('layerId', this.targetLayerId);
      f.set('fid', newFid);
    }
    ctx.drawSource.changed();
  }
}
