import { Command } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';

export class ReorderLayersCommand extends Command {
  readonly label = 'Reordenar capas';
  private readonly ids: string[];
  private readonly position: number;
  private beforeOrder: string[] = [];

  constructor(ids: string[], position: number) {
    super();
    this.ids = ids;
    this.position = position;
  }

  execute(): void {
    const store = useLayersStore.getState();
    if (this.beforeOrder.length === 0) this.beforeOrder = store.layers.map((l) => l.id);
    store.reorder(this.ids, this.position);
  }

  override undo(): void {
    if (this.beforeOrder.length === 0) return;
    useLayersStore.getState().reorder(this.beforeOrder, 0);
  }

  override redo(): void {
    useLayersStore.getState().reorder(this.ids, this.position);
  }
}