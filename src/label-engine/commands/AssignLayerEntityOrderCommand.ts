import { Command } from '@kernel/command/Command';
import type { LabelStyleConfig } from '../model/labelModel';
import { resolveEffectiveLabelConfig } from '../model/labelModel';
import { formatOrderLabel, type LabelNumberingMode } from '../model/labelNumbering';
import { useEntityLabelStore, type EntityLabelEntry } from '../store/entityLabelStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import {
  ensureLayerLabelsVisible,
  restoreLayerVisibility,
  type LayerVisibilitySnapshot,
} from './labelCommandUtils';

export interface AssignLayerEntityOrderOptions {
  layerId: string;
  config: LabelStyleConfig;
  numbering: LabelNumberingMode;
  customTemplate?: string;
}

export class AssignLayerEntityOrderCommand extends Command {
  readonly label = 'Etiquetar elementos de capa en orden';
  private readonly opts: AssignLayerEntityOrderOptions;
  private before = new Map<string, EntityLabelEntry | undefined>();
  private layerSnapshot: LayerVisibilitySnapshot = {};

  constructor(opts: AssignLayerEntityOrderOptions) {
    super();
    this.opts = opts;
  }

  private targetEntities(): Array<{ id: string }> {
    const layerId = this.opts.layerId;
    const fallbackViaId = useLayersStore.getState().getLayerForKind('via')?.id;
    const streets = useStreetStore
      .getState()
      .streets.filter((s) => (s.layerId ?? fallbackViaId) === layerId);
    const roundabouts = useRoundaboutStore
      .getState()
      .roundabouts.filter((r) => (r.layerId ?? fallbackViaId) === layerId);
    return [...streets, ...roundabouts];
  }

  execute(): void {
    this.before.clear();
    const entities = this.targetEntities();
    const effectiveConfig = resolveEffectiveLabelConfig(this.opts.config, this.opts.numbering);
    const store = useEntityLabelStore.getState();
    entities.forEach((e, i) => {
      this.before.set(e.id, store.get(e.id));
      const text = formatOrderLabel(
        this.opts.numbering,
        i,
        entities.length,
        undefined,
        this.opts.customTemplate
      );
      store.set(e.id, { config: effectiveConfig, text });
    });
    this.layerSnapshot = ensureLayerLabelsVisible(this.opts.layerId);
  }

  override undo(): void {
    const store = useEntityLabelStore.getState();
    for (const [id, prev] of this.before) {
      if (prev) store.set(id, prev);
      else store.remove(id);
    }
    restoreLayerVisibility(this.opts.layerId, this.layerSnapshot);
  }

  override redo(): void {
    this.execute();
  }
}
