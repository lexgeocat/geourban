import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from './Command';
import { GeoUrbanFeatureKind } from '../core/objectModel';
import { useLayersStore } from '../store/layersRegistryStore';

let _idCounter = 0;
function nextId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${Date.now()}-${_idCounter.toString(36)}`;
}

/**
 * Resuelve el layerId para una feature nueva: usa el override, luego la
 * capa activa, y por último la primera capa que coincida con el kind.
 */
export function resolveLayerId(override?: string, kind?: GeoUrbanFeatureKind): string | undefined {
  if (override) return override;
  const reg = useLayersStore.getState();
  if (reg.activeLayerId) {
    const active = reg.getById(reg.activeLayerId);
    if (active) return active.id;
  }
  if (kind) {
    const match = reg.getLayerForKind(kind);
    if (match) return match.id;
  }
  return undefined;
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