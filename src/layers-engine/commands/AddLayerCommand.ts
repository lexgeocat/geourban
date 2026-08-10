import { Command } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';

export class AddLayerCommand extends Command {
  readonly label: string;
  private readonly layer: Omit<Layer, 'zIndex'>;

  constructor(layer: Omit<Layer, 'zIndex'>, label = 'Agregar capa') {
    super();
    this.layer = layer;
    this.label = label;
  }

  execute(): void {
    const store = useLayersStore.getState();
    if (!store.getById(this.layer.id)) store.add(this.layer);
  }

  override undo(): void {
    useLayersStore.getState().remove(this.layer.id);
  }

  override redo(): void {
    this.execute();
  }
}