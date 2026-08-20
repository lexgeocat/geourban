import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import { layerEntityAdapters, type LayerEntitySnapshot } from '@layers-engine/extension-points';
import { newId } from '@kernel/id/id';
import { nextLayerFid } from '@kernel/id/layerFidRegistry';
import type { Layer } from '@kernel/domain-model/featureModel';

export interface DuplicateLayerOptions {
  sourceLayerId: string;
  newLayerId: string;
  newName: string;
  duplicateFeatures: boolean;
}

interface ClonedEntity {
  newId: string;
  source: LayerEntitySnapshot;
}

export class DuplicateLayerCommand extends Command {
  readonly label = 'Duplicar capa';
  private readonly opts: DuplicateLayerOptions;
  private clonedFeatureIds: Array<string | number> = [];
  private clonedFeatures: Array<{ id: string | number; feature: Feature<Geometry> }> = [];
  private clonedEntities: ClonedEntity[] = [];
  private addedLayer: Layer | null = null;

  constructor(opts: DuplicateLayerOptions) {
    super();
    this.opts = opts;
  }

  execute(ctx: CommandContext): void {
    const store = useLayersStore.getState();
    const source = store.getById(this.opts.sourceLayerId);
    if (!source) return;

    if (!store.getById(this.opts.newLayerId)) {
      const clone: Omit<Layer, 'zIndex'> = {
        ...source,
        id: this.opts.newLayerId,
        name: this.opts.newName,
      };
      store.add(clone);
      this.addedLayer = { ...clone, zIndex: source.zIndex };
    }

    if (this.opts.duplicateFeatures) {
      this.clonedFeatureIds = [];
      this.clonedFeatures = [];
      this.clonedEntities = [];
      const toClone: Array<Feature<Geometry>> = [];
      ctx.drawSource.forEachFeature((f) => {
        if (f.get('layerId') === this.opts.sourceLayerId) toClone.push(f as Feature<Geometry>);
      });
      for (const f of toClone) {
        if (!f.getGeometry()) continue;
        const clone = f.clone();
        const clonedFeatureId = newId('dup');
        clone.setId(clonedFeatureId);
        clone.set('layerId', this.opts.newLayerId, true);
        clone.set('fid', nextLayerFid(this.opts.newLayerId), true);
        ctx.drawSource.addFeature(clone);
        this.clonedFeatureIds.push(clonedFeatureId);
        this.clonedFeatures.push({ id: clonedFeatureId, feature: clone });
      }
      for (const adapter of layerEntityAdapters.collect()) {
        for (const snap of adapter.list(this.opts.sourceLayerId)) {
          const clonedId = newId('dup');
          const remapped: LayerEntitySnapshot = {
            ...snap,
            id: clonedId,
            data: {
              ...(snap.data as Record<string, unknown>),
              layerId: this.opts.newLayerId,
              fid: undefined, // fuerza a que el store asigne un fid nuevo
            },
            layerId: this.opts.newLayerId,
          };
          this.clonedEntities.push({ newId: clonedId, source: remapped });
        }
      }
      if (this.clonedEntities.length > 0) {
        for (const adapter of layerEntityAdapters.collect()) {
          const mySnaps = this.clonedEntities.map((c) => c.source);
          if (mySnaps.length > 0) adapter.restore(mySnaps);
        }
      }
      ctx.drawSource.changed();
    }
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.clonedFeatureIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.clonedFeatureIds = [];
    if (this.clonedEntities.length > 0) {
      const ids = this.clonedEntities.map((c) => c.newId);
      for (const adapter of layerEntityAdapters.collect()) {
        for (const id of ids) adapter.removeById(id);
      }
      this.clonedEntities = [];
    }
    ctx.drawSource.changed();
    useLayersStore.getState().remove(this.opts.newLayerId);
  }

  override redo(ctx: CommandContext): void {
    const store = useLayersStore.getState();
    if (this.addedLayer && !store.getById(this.addedLayer.id)) store.add(this.addedLayer);
    for (const { id, feature } of this.clonedFeatures) {
      if (ctx.drawSource.getFeatureById(id) == null) ctx.drawSource.addFeature(feature);
    }
    if (this.clonedEntities.length > 0) {
      for (const adapter of layerEntityAdapters.collect()) {
        const mySnaps = this.clonedEntities.map((c) => c.source);
        if (mySnaps.length > 0) adapter.restore(mySnaps);
      }
    }
    ctx.drawSource.changed();
  }
}
