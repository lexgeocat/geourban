import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';
import { AddFeatureCommand } from './AddFeatureCommand';

/**
 * Adds multiple features to the drawSource.
 * Uses AddFeatureCommand internally for each feature.
 */
export class AddFeaturesCommand extends Command {
  readonly label: string;
  private commands: AddFeatureCommand[] = [];

  constructor(
    features: Feature<Geometry>[],
    options: { label?: string; prefix?: string } = {},
  ) {
    super();
    const { label, prefix = 'feat' } = options;
    this.label = label ?? 'Agregar features';
    this.commands = features.map(
      (feature) => new AddFeatureCommand(feature, { prefix }),
    );
  }

  execute(ctx: CommandContext): void {
    this.commands.forEach((cmd) => cmd.execute(ctx));
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    this.commands.forEach((cmd) => cmd.undo?.(ctx));
    ctx.drawSource.changed();
  }
}