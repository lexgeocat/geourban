import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';
import { useSelectionStore } from '../store/selectionStore';

/** Borra features por id. Si no se pasan ids, borra la selección actual. */
export class DeleteFeaturesCommand extends Command {
  readonly label = 'Borrar features';
  private readonly ids: Array<string | number>;
  private removed: Array<{ id: string | number; feature: Feature<Geometry> }> = [];

  constructor(ids?: Array<string | number>) {
    super();
    if (ids && ids.length > 0) {
      this.ids = ids;
    } else {
      this.ids = Array.from(useSelectionStore.getState().selectedIds);
    }
  }

  execute(ctx: CommandContext): void {
    this.removed = [];
    for (const id of this.ids) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f) continue;
      this.removed.push({ id, feature: f });
      ctx.drawSource.removeFeature(f);
      useSelectionStore.getState().remove(id);
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const { id, feature } of this.removed) {
      if (ctx.drawSource.getFeatureById(id) == null) {
        ctx.drawSource.addFeature(feature);
      }
    }
    ctx.drawSource.changed();
  }
}
