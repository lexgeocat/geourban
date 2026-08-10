import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { GeoUrbanFeatureKind } from '../../core/objectModel';
import { pickLayerId } from '../../store/entities/layerResolution';
import { nextId } from '../../lib/id';

function resolveLayerId(override?: string, kind?: GeoUrbanFeatureKind): string | undefined {
  if (!kind) return undefined;
  return pickLayerId({ kind, override, requireKindMatch: true, autoCreate: false });
}

export class AddFeatureCommand extends Command {
  readonly label: string;
  private readonly feature: Feature<Geometry>;
  private readonly mode: 'register' | 'claim';
  private readonly kind: GeoUrbanFeatureKind;
  private readonly layerId?: string;

  constructor(
    feature: Feature<Geometry>,
    options: { mode?: 'register' | 'claim'; label?: string; prefix?: string; kind?: GeoUrbanFeatureKind; layerId?: string } = {},
  ) {
    super();
    const { mode = 'register', label, prefix = 'feat', kind = 'lote', layerId } = options;
    this.mode = mode;
    this.feature = feature;
    this.kind = kind;
    this.layerId = layerId;
    this.label = label ?? (mode === 'claim' ? 'Dibujar feature' : 'Agregar feature');
    if (mode === 'register' && feature.getId() == null) {
      feature.setId(nextId(prefix));
    }
  }

  execute(ctx: CommandContext): void {
    if (this.mode === 'claim') {
      const id = this.feature.getId();
      if (id == null) {
        this.feature.setId(nextId('feat'));
      }
      if (ctx.drawSource.getFeatureById(this.feature.getId() as string | number) == null) {
        ctx.drawSource.addFeature(this.feature);
      }
    } else {
      ctx.drawSource.addFeature(this.feature);
    }
    this.feature.set('kind', this.kind);
    const resolvedLayerId = this.layerId ?? resolveLayerId(undefined, this.kind);
    if (resolvedLayerId) this.feature.set('layerId', resolvedLayerId);
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    const id = this.feature.getId();
    if (id == null) return;
    const f = ctx.drawSource.getFeatureById(id);
    if (f) ctx.drawSource.removeFeature(f);
    ctx.drawSource.changed();
  }
}