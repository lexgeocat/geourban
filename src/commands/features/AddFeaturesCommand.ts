import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { AddFeatureCommand } from './AddFeatureCommand';
import { isGeoUrbanFeatureKind } from '../../core/objectModel';

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
    this.commands = features.map((feature) => {
      // Fase 2 (persistencia/integridad de capas): al reabrir/reimportar
      // un proyecto, cada feature YA trae su `kind`/`layerId` reales
      // (vienen del GeoJSON — ver readOlFeaturesFromProject). Antes acá
      // no se pasaban explícitos: AddFeatureCommand los pisaba con su
      // default ('lote' + resolveLayerId('lote')), así que CUALQUIER
      // importación terminaba reasignando todo a la capa de lotes,
      // perdiendo el kind/layerId reales de manzanos, calles, etc.
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