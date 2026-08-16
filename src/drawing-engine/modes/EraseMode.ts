import { Fill, Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import {
  HitTestSelect,
  type HitTestSelectEvent,
} from '@selection-engine/interactions/HitTestSelect';
import { runCommand } from '@kernel/command/CommandStack';
import { DeleteFeaturesCommand } from '../commands/DeleteFeaturesCommand';
import { useEntityLabelStore } from '@label-engine/store/entityLabelStore';
import { recomputeManzanos } from '@manzanos-engine/orchestration/recomputeManzanos';
import { extraSnapSources } from '@snap-engine/extension-points';
import { isEraseIntercepted } from '../extension-points';
import { toast } from '@shared-ui/store/toastStore';
import type { ModeContext } from '@kernel/modes/ModeContext';

const ERASE_STYLE = new Style({
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
  stroke: new Stroke({ color: '#ef4444', width: 2 }),
});

export function activateErase(ctx: ModeContext): void {
  const select = new HitTestSelect({
    map: ctx.map,
    source: ctx.drawSource,
    pixelTolerance: 6,
    multi: false,
    filter: (feature) => !ctx.isLayerLocked(feature) && ctx.isLayerVisible(feature),
    getExtraFeatures: () => extraSnapSources.collect().flat() as Feature<Geometry>[],
  });
  ctx.highlightLayer.setStyle(ERASE_STYLE);
  select.addEventListener('select', (evt) => {
    const e = evt as unknown as HitTestSelectEvent;
    if (e.selected.length === 0) return;
    const ids: Array<string | number> = [];
    let removedRoadEntity = false;
    e.selected.forEach((f) => {
      const id = f.getId();
      if (id === undefined || id === null) return;
      if (ctx.isLayerLocked(f)) return;
      const kind = f.get('kind') as string | undefined;
      if (kind === 'via' || kind === 'rotonda') {
        if (isEraseIntercepted(kind as 'via' | 'rotonda', String(id))) {
          useEntityLabelStore.getState().remove(String(id));
          removedRoadEntity = true;
          return;
        }
      }
      ids.push(id as string | number);
    });
    if (ids.length > 0) {
      const cmd = new DeleteFeaturesCommand(ids);
      void runCommand(cmd);
      if (cmd.skippedCount > 0) {
        toast(`${cmd.skippedCount} elemento(s) no se borraron por estar en una capa bloqueada.`, {
          variant: 'warning',
          durationMs: 5000,
        });
      }
    }
    if (removedRoadEntity) void recomputeManzanos();
    select.getFeatures().clear();
    ctx.highlightSource.clear();
  });
  ctx.map.addInteraction(select);
  ctx.selectInteractionRef.current = select;
  ctx.addCleanup(() => ctx.map.removeInteraction(select));
}
