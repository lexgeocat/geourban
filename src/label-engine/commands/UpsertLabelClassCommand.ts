import { Command } from '@kernel/command/Command';
import { useLabelClassStore } from '../store/labelClassStore';
import type { LabelClass } from '../model/labelClass';
import type { LabelStyleConfig } from '../model/labelModel';
import type { LabelNumberingMode } from '../model/labelNumbering';

export interface UpsertLabelClassOptions {
  layerId: string;
  style: LabelStyleConfig;
  numbering?: { mode: LabelNumberingMode; restartPerParent: boolean; customTemplate?: string };
  enabled?: boolean;
  priority?: number;
  placement?: LabelClass['placement'];
  visibleMinZoom?: number;
  visibleMaxZoom?: number;
  name?: string;
}

export class UpsertLabelClassCommand extends Command {
  readonly label = 'Configurar clase de etiqueta';
  private readonly opts: UpsertLabelClassOptions;
  private prevClass: LabelClass | null = null;
  private hadPrev = false;
  private nextClass: LabelClass | null = null;

  constructor(opts: UpsertLabelClassOptions) {
    super();
    this.opts = opts;
  }

  execute(): void {
    const store = useLabelClassStore.getState();
    this.prevClass = store.getForLayer(this.opts.layerId) ?? null;
    this.hadPrev = this.prevClass !== null;
    const patched: Parameters<typeof store.upsert>[1] = {
      style: this.opts.style,
      enabled: this.opts.enabled ?? true,
      numbering: this.opts.numbering,
      priority: this.opts.priority,
      placement: this.opts.placement,
      visibleMinZoom: this.opts.visibleMinZoom,
      visibleMaxZoom: this.opts.visibleMaxZoom,
      name: this.opts.name,
    };
    this.nextClass = store.upsert(this.opts.layerId, patched);
  }

  override undo(): void {
    const store = useLabelClassStore.getState();
    if (this.hadPrev && this.prevClass) {
      store.upsert(this.opts.layerId, this.prevClass);
    } else {
      store.remove(this.opts.layerId);
    }
  }

  override redo(): void {
    if (!this.nextClass) return;
    useLabelClassStore.getState().upsert(this.opts.layerId, this.nextClass);
  }
}
