import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { AddFeatureCommand } from './AddFeatureCommand';
import { isGeoUrbanFeatureKind } from '../../core/objectModel';

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
    this.commands = features.map((feature) => {
      const existingKind = feature.get('kind');
      const existingLayerId = feature.get('layerId') as string | undefined;
      return new AddFeatureCommand(feature, {
        prefix,
        kind: isGeoUrbanFeatureKind(existingKind) ? existingKind : undefined,
        layerId: existingLayerId,
      });
    });
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