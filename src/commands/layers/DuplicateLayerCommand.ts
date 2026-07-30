import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import { newId } from '../../lib/id';
import type { Layer } from '../../core/objectModel';

export interface DuplicateLayerOptions {
  sourceLayerId: string;
  newLayerId: string;
  newName: string;
  duplicateFeatures: boolean;
}

export class DuplicateLayerCommand extends Command {
  readonly label = 'Duplicar capa';
  private readonly opts: DuplicateLayerOptions;
  private clonedFeatureIds: Array<string | number> = [];

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
    }

    if (this.opts.duplicateFeatures) {
      this.clonedFeatureIds = [];
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
        ctx.drawSource.addFeature(clone);
        this.clonedFeatureIds.push(clonedFeatureId);
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
    ctx.drawSource.changed();
    useLayersStore.getState().remove(this.opts.newLayerId);
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }
}