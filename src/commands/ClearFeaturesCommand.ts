import type VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';

/**
 * Clears all features from the drawSource.
 * Stores a snapshot of the features for undo.
 */
export class ClearFeaturesCommand extends Command {
  readonly label = 'Limpiar features';
  private features: Feature<Geometry>[] = [];

  execute(ctx: CommandContext): void {
    this.features = ctx.drawSource.getFeatures();
    ctx.drawSource.clear();
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    if (this.features.length === 0) return;
    ctx.drawSource.addFeatures(this.features);
    ctx.drawSource.changed();
  }
}