import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { Layer } from '@kernel/domain-model/featureModel';
import { estimateGeometryBytes } from '@kernel/command/memoryEstimate';
import { layerEntityAdapters, type LayerEntitySnapshot } from '@layers-engine/extension-points';
import { useEditSessionStore } from '@layers-engine/store/editSessionStore';
import { nextLayerFid } from '@kernel/id/layerFidRegistry';

export interface RemoveLayerOptions {
  layerId: string;
  action: 'move' | 'delete';
  targetLayerId?: string;
}

interface ReassignedEntry {
  id: string | number;
  prevFid: number | undefined;
  newFid: number;
}

export class RemoveLayerCommand extends Command {
  readonly label = 'Eliminar capa';
  private readonly opts: RemoveLayerOptions;

  private removedLayer: Layer | null = null;
  private removedIndex = -1;
  private reassigned: ReassignedEntry[] = [];
  private removedFeatures: Array<{ id: string | number; feature: Feature<Geometry> }> = [];
  private removedEntitySnapshots: LayerEntitySnapshot[] = [];

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
    this.removedEntitySnapshots = [];

    const affected: Feature<Geometry>[] = [];
    ctx.drawSource.forEachFeature((f) => {
      if (f.get('layerId') === this.opts.layerId) affected.push(f as Feature<Geometry>);
    });

    if (this.opts.action === 'move' && this.opts.targetLayerId) {
      const target = this.opts.targetLayerId;
      for (const f of affected) {
        const id = f.getId();
        if (id == null) continue;
        const prevFid = f.get('fid') as number | undefined;
        const newFid = nextLayerFid(target);
        this.reassigned.push({ id, prevFid, newFid });
        f.set('layerId', target);
        f.set('fid', newFid);
      }
      for (const adapter of layerEntityAdapters.collect()) {
        adapter.reassign(this.opts.layerId, target);
      }
    } else if (this.opts.action === 'delete') {
      for (const f of affected) {
        const id = f.getId();
        if (id == null) continue;
        this.removedFeatures.push({ id, feature: f });
        ctx.drawSource.removeFeature(f);
      }
      for (const adapter of layerEntityAdapters.collect()) {
        const snaps = adapter.remove(this.opts.layerId);
        for (const s of snaps) this.removedEntitySnapshots.push(s);
      }
    }
    ctx.drawSource.changed();

    store.remove(this.opts.layerId);
    useEditSessionStore.getState().stopEditing(this.opts.layerId);
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
    for (const { id, prevFid } of this.reassigned) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f || !this.removedLayer) continue;
      f.set('layerId', this.removedLayer.id);
      if (prevFid !== undefined) f.set('fid', prevFid);
      else f.unset('fid');
    }
    if (this.removedEntitySnapshots.length > 0) {
      for (const adapter of layerEntityAdapters.collect()) {
        adapter.restore(this.removedEntitySnapshots);
      }
    }
    if (this.opts.action === 'move' && this.opts.targetLayerId && this.removedLayer) {
      for (const adapter of layerEntityAdapters.collect()) {
        adapter.reassign(this.opts.targetLayerId, this.removedLayer.id);
      }
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    if (!this.removedLayer) return;
    const store = useLayersStore.getState();
    if (store.getById(this.removedLayer.id)) store.remove(this.removedLayer.id);

    for (const { id, newFid } of this.reassigned) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (!f || !this.opts.targetLayerId) continue;
      f.set('layerId', this.opts.targetLayerId);
      f.set('fid', newFid);
    }
    for (const { id } of this.removedFeatures) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    if (this.opts.action === 'delete') {
      for (const adapter of layerEntityAdapters.collect()) {
        adapter.remove(this.removedLayer.id);
      }
    } else if (this.opts.action === 'move' && this.opts.targetLayerId) {
      for (const adapter of layerEntityAdapters.collect()) {
        adapter.reassign(this.removedLayer.id, this.opts.targetLayerId);
      }
    }
    ctx.drawSource.changed();
  }
  override approxMemoryBytes(): number {
    if (this.removedFeatures.length === 0) return 256;
    return this.removedFeatures.reduce(
      (sum, r) => sum + estimateGeometryBytes(r.feature.getGeometry()),
      0
    );
  }
}
