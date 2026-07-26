import { Fill, Stroke, Style } from 'ol/style.js';
import { HitTestSelect, type HitTestSelectEvent } from '../HitTestSelect';
import { runCommand } from '../../../commands/core/CommandStack';
import { DeleteFeaturesCommand } from '../../../commands/features/DeleteFeaturesCommand';
import type { ModeContext } from './ModeContext';

export const ERASE_STYLE = new Style({
  fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
  stroke: new Stroke({ color: '#ef4444', width: 2 }),
});

export function activateErase(ctx: ModeContext): void {
  const select = new HitTestSelect({
    map: ctx.map,
    source: ctx.drawSource,
    spatialIndex: ctx.spatialIndex,
    pixelTolerance: 6,
    multi: false,
  });
  ctx.highlightLayer.setStyle(ERASE_STYLE);
  select.addEventListener('select', (evt) => {
    const e = evt as unknown as HitTestSelectEvent;
    if (e.selected.length === 0) return;
    const ids: Array<string | number> = [];
    e.selected.forEach((f) => {
      const id = f.getId();
      if (id === undefined || id === null) return;
      if (ctx.isLayerLocked(f)) return;
      ids.push(id as string | number);
    });
    if (ids.length > 0) void runCommand(new DeleteFeaturesCommand(ids));
    select.getFeatures().clear();
    ctx.highlightSource.clear();
  });
  ctx.map.addInteraction(select);
  ctx.selectInteractionRef.current = select;
  ctx.addCleanup(() => ctx.map.removeInteraction(select));
}