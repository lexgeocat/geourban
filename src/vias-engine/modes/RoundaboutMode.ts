import { useRoundaboutStore } from '../store/roundaboutStore';
import { runCommand } from '@kernel/command/CommandStack';
import { AddRoundaboutCommand } from '../commands/AddRoundaboutCommand';
import { validateRoundaboutParams } from '../geometry/roundaboutEngine';
import { RoundaboutDrawInteraction } from '../interactions/RoundaboutDrawInteraction';
import { requireLayerForKind } from '@layers-engine/store/layerPickerStore';
import { toast } from '@shared-ui/store/toastStore';
import { useStreetTracingSessionStore } from '../store/streetTracingSessionStore';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activateRoundabout(ctx: ModeContext): void {
  const { map } = ctx;
  useStreetTracingSessionStore.getState().nextSession();
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
        toast(error, { variant: 'error', durationMs: 6000 });
        map.render();
        return;
      }
      void (async () => {
        const layerId = await requireLayerForKind('rotonda');
        if (!layerId) {
          map.render();
          return;
        }
        void runCommand(new AddRoundaboutCommand({ ...params, layerId }));
        map.render();
      })();
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
  ctx.addCleanup(() => ctx.postrenderPainter?.setRoundaboutPreview(null)); // limpia preview huérfano
}
