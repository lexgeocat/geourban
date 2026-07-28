import { Command } from '../core/Command';
import { useLayersStore } from '../../store/entities/layersRegistryStore';
import type { Layer } from '../../core/objectModel';

export class UpdateLayerCommand extends Command {
  readonly label: string;
  readonly coalesceKey: string;
  private readonly layerId: string;
  private readonly patch: Partial<Layer>;
  private before: Partial<Layer> = {};
  private after: Partial<Layer> = {};
  private captured = false;

  constructor(layerId: string, patch: Partial<Layer>, label = 'Editar capa') {
    super();
    this.layerId = layerId;
    this.patch = patch;
    this.label = label;
    this.coalesceKey = `UpdateLayer:${layerId}:${Object.keys(patch).sort().join(',')}`;
  }

  execute(): void {
    const store = useLayersStore.getState();
    const layer = store.getById(this.layerId);
    if (!layer) return;
    if (!this.captured) {
      for (const key of Object.keys(this.patch) as (keyof Layer)[]) {
        (this.before as Record<string, unknown>)[key] = layer[key];
      }
      this.captured = true;
    }
    this.after = { ...this.patch };
    store.update({ id: this.layerId, ...this.patch });
  }

  override undo(): void {
    const store = useLayersStore.getState();
    if (store.getById(this.layerId)) store.update({ id: this.layerId, ...this.before });
  }

  override redo(): void {
    const store = useLayersStore.getState();
    if (store.getById(this.layerId)) store.update({ id: this.layerId, ...this.after });
  }

  override coalesceInto(previous: Command): boolean {
    if (!(previous instanceof UpdateLayerCommand)) return false;
    if (previous.coalesceKey !== this.coalesceKey) return false;
    previous.after = { ...this.after };
    return true;
  }
}