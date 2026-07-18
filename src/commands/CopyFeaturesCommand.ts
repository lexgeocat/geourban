import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';

/** Copia un grupo de features ya construidos al drawSource en un único
 *  paso de undo. Los features YA tienen su id asignado por el llamador. */
export class CopyFeaturesCommand extends Command {
  readonly label: string;
  private readonly features: Array<Feature<Geometry>>;

  constructor(features: Array<Feature<Geometry>>, label = 'Copiar selección') {
    super();
    this.features = features;
    this.label = label;
  }

  execute(ctx: CommandContext): void {
    for (const f of this.features) {
      const id = f.getId();
      if (id == null) continue;
      if (ctx.drawSource.getFeatureById(id) == null) {
        ctx.drawSource.addFeature(f);
      }
    }
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const f of this.features) {
      const id = f.getId();
      if (id == null) continue;
      const existing = ctx.drawSource.getFeatureById(id);
      if (existing) ctx.drawSource.removeFeature(existing);
    }
    ctx.drawSource.changed();
  }
}
