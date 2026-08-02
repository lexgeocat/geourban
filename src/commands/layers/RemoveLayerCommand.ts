import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';
import { estimateGeometryBytes } from '../core/memoryEstimate';

export interface RemoveLayerOptions {
  layerId: string;
  action: 'move' | 'delete';
  targetLayerId?: string;
}

export class RemoveLayerCommand extends Command {
  readonly label = 'Eliminar capa';
  private readonly opts: RemoveLayerOptions;

  private removedLayer: Layer | null = null;
  private removedIndex = -1;
  private reassigned: Array<{ id: string | number }> = [];
  private removedFeatures: Array<{ id: string | number; feature: Feature<Geometry> }> = [];

  constructor(opts: RemoveLayerOptions) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
    const store = useLayersStore.getState();
    const layer = store.getById(this.opts.layerId);
    if (!layer) return;

    this.removedLayer = { ...layer };
    this.removedIndex = store.layers.findIndex((l) => l.id === this.opts.layerId);
    this.reassigned = [];
    this.removedFeatures = [];

    const affected: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      if (f.get('layerId') === this.opts.layerId) affected.push(f as Feature<Geometry>);
    });

    if (this.opts.action === 'move' && this.opts.targetLayerId) {
      const target = this.opts.targetLayerId;
      for (const f of affected) {
        const id = f.getId();
        if (id == null) continue;
        this.reassigned.push({ id });
        f.set('layerId', target);
      }
    } else if (this.opts.action === 'delete') {
      for (const f of affected) {
        const id = f.getId();
        if (id == null) continue;
        this.removedFeatures.push({ id, feature: f });
        ctx.drawSource.removeFeature(f);
      }
    }
    ctx.drawSource.changed();

    store.remove(this.opts.layerId);
  }

  override undo(ctx: CommandContext): void {
    const store = useLayersStore.getState();
    if (this.removedLayer && !store.getById(this.removedLayer.id)) {
      store.add(this.removedLayer);
      if (this.removedIndex >= 0) store.reorder([this.removedLayer.id], this.removedIndex);
    }

    for (const { id, feature } of this.removedFeatures) {
      if (ctx.drawSource.getFeatureById(id) == null) ctx.drawSource.addFeature(feature);
    }
    for (const r of this.reassigned) {
      const f = ctx.drawSource.getFeatureById(r.id);
      if (f && this.removedLayer) f.set('layerId', this.removedLayer.id);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }

  // Fase 3.3 — "Eliminar capa" con acción `delete` puede arrastrar todos
  // los features de esa capa (potencialmente miles). Igual que
  // DeleteFeaturesCommand, sin este override el costo quedaba oculto
  // detrás del default de 256 bytes.
  override approxMemoryBytes(): number {
    if (this.removedFeatures.length === 0) return 256;
    return this.removedFeatures.reduce((sum, r) => sum + estimateGeometryBytes(r.feature.getGeometry()), 0);
  }
}