import { Command } from '@kernel/command/Command';
import { useEntityLabelStore, type EntityLabelEntry } from '../store/entityLabelStore';
import { useMapStore } from '@map-core/store/mapStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { useLayersStore } from '@layers-engine/store/layersRegistryStore';
import type { LabelStyleConfig } from '../model/labelModel';
import {
  ensureLayerLabelsVisible,
  restoreLayerVisibility,
  type LayerVisibilitySnapshot,
} from './labelCommandUtils';

export class ApplyEntityLabelConfigCommand extends Command {
  readonly label = 'Configurar etiqueta';
  private readonly entityId: string;
  private readonly entityType: 'street' | 'roundabout';
  private readonly next: LabelStyleConfig;
  private readonly nextText: string;
  private prev: EntityLabelEntry | undefined;
  private hadPrev = false;
  private layerSnapshot: LayerVisibilitySnapshot = {};
  private resolvedLayerId: string | undefined;

  constructor(
    entityId: string,
    entityType: 'street' | 'roundabout',
    next: LabelStyleConfig,
    nextText: string
  ) {
    super();
    this.entityId = entityId;
    this.entityType = entityType;
    this.next = next;
    this.nextText = nextText;
  }

  private resolveLayerId(): string | undefined {
    const registry = useLayersStore.getState();
    if (this.entityType === 'street') {
      const s = useStreetStore.getState().streets.find((x) => x.id === this.entityId);
      return s?.layerId ?? registry.getLayerForKind('via')?.id;
    }
    const r = useRoundaboutStore.getState().roundabouts.find((x) => x.id === this.entityId);
    return r?.layerId ?? registry.getLayerForKind('via')?.id;
  }

  execute(): void {
    const store = useEntityLabelStore.getState();
    this.prev = store.get(this.entityId);
    this.hadPrev = this.prev !== undefined;
    store.set(this.entityId, { config: this.next, text: this.nextText });
    this.resolvedLayerId = this.resolveLayerId();
    this.layerSnapshot = ensureLayerLabelsVisible(this.resolvedLayerId);
    useMapStore.getState().mapInstance?.render();
  }

  override undo(): void {
    const store = useEntityLabelStore.getState();
    if (this.hadPrev && this.prev) store.set(this.entityId, this.prev);
    else store.remove(this.entityId);
    restoreLayerVisibility(this.resolvedLayerId, this.layerSnapshot);
    useMapStore.getState().mapInstance?.render();
  }
}
