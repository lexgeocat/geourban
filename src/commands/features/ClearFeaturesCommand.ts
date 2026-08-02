import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { estimateGeometryBytes } from '../core/memoryEstimate';

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

  // Fase 3.3 — este es el único comando cuyo "cambio" es intencionalmente
  // el proyecto ENTERO (no es un snapshot por comodidad, es la semántica
  // de "Nuevo proyecto"/limpiar todo). Justamente por eso es el que más
  // necesita reportar su tamaño real: sin este override, CommandStack
  // contaba 256 bytes fijos aunque `this.features` tuviera cientos de
  // miles de geometrías retenidas para el undo.
  override approxMemoryBytes(): number {
    if (this.features.length === 0) return 256;
    return this.features.reduce((sum, f) => sum + estimateGeometryBytes(f.getGeometry()), 0);
  }
}