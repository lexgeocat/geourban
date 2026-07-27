import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';

export interface DuplicateLayerOptions {
  sourceLayerId: string;
  newLayerId: string;
  newName: string;
  /** Si es true, también clona (con ids nuevos) cada feature de la capa origen. */
  duplicateFeatures: boolean;
}

/** Duplica una capa del registro — opcionalmente clonando también sus
 *  features. Un solo paso de historial para ambas partes (consistente
 *  con Fase 3: todo CRUD de capas pasa por CommandStack). */
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
        const newId = `dup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        clone.setId(newId);
        clone.set('layerId', this.opts.newLayerId, true);
        ctx.drawSource.addFeature(clone);
        this.clonedFeatureIds.push(newId);
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