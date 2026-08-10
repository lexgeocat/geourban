import { Command } from '@kernel/command/Command';
import { useEntityLabelStore, type EntityLabelEntry } from '../store/entityLabelStore';
import { useMapStore } from '@map-core/store/mapStore';
import type { LabelStyleConfig } from '../model/labelModel';

export class ApplyEntityLabelConfigCommand extends Command {
  readonly label = 'Configurar etiqueta';
  private readonly entityId: string;
  private readonly next: LabelStyleConfig;
  private readonly nextText: string;
  private prev: EntityLabelEntry | undefined;
  private hadPrev = false;

  constructor(entityId: string, next: LabelStyleConfig, nextText: string) {
    super();
    this.entityId = entityId;
    this.next = next;
    this.nextText = nextText;
  }

  execute(): void {
    const store = useEntityLabelStore.getState();
    this.prev = store.get(this.entityId);
    this.hadPrev = this.prev !== undefined;
    store.set(this.entityId, { config: this.next, text: this.nextText });
    useMapStore.getState().mapInstance?.render();
  }

  override undo(): void {
    const store = useEntityLabelStore.getState();
    if (this.hadPrev && this.prev) store.set(this.entityId, this.prev);
    else store.remove(this.entityId);
    useMapStore.getState().mapInstance?.render();
  }
}
