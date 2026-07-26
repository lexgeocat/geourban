import { useRoundaboutStore } from '../../../store/entities/roundaboutStore';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddRoundaboutCommand } from '../../../commands/roads/AddRoundaboutCommand';
import { validateRoundaboutParams } from '../../../geo/roundabout/roundaboutEngine';
import { RoundaboutDrawInteraction } from '../RoundaboutDrawInteraction';
import type { ModeContext } from './ModeContext';

export function activateRoundabout(ctx: ModeContext): void {
  const { map } = ctx;
  const draw = new RoundaboutDrawInteraction({
    map,
    onComplete: (center, radiusM) => {
      const rb = useRoundaboutStore.getState();
      const params = {
        center: center as [number, number],
        radiusM,
        sides: rb.defaultSides,
        rotation: 0,
        roadWidthM: rb.defaultRoadWidthM,
        sidewalkWidthM: rb.defaultSidewalkWidthM,
      };
      const error = validateRoundaboutParams(params);
      if (error) {
        alert(error);
        map.render();
        return;
      }
      void runCommand(new AddRoundaboutCommand(params));
      map.render();
    },
    onCancel: () => map.render(),
  });
  map.addInteraction(draw);
  ctx.addCleanup(() => map.removeInteraction(draw));
  const onRoundaboutPreview = () => {
    ctx.postrenderPainter?.setRoundaboutPreview(draw.getPreview());
  };
  map.on('postrender', onRoundaboutPreview);
  ctx.addCleanup(() => map.un('postrender', onRoundaboutPreview));
}