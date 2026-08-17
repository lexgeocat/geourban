import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Stroke, Style } from 'ol/style.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { runCommand } from '@kernel/command/CommandStack';
import { SplitFeatureCommand } from '../commands/SplitFeatureCommand';
import { splitLineStringByLine, splitPolygonRingByLine } from '@kernel/geometry/splitGeometry';
import type { Pt } from '@kernel/geometry/polygonEngine';
import { buildSegmentLiveLabels } from '../styles/liveDimensions';
import { toast } from '@shared-ui/store/toastStore';
import { useSelectionStore } from '@selection-engine/store/selectionStore';
import { useDrawStore } from '@map-core/store/drawStore';
import type { ModeContext } from '@kernel/modes/ModeContext';

export function activateSplitFeature(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;

  const draw = new Draw({
    source: src,
    type: 'LineString',
    condition: primaryAction,
    style: (feature) => {
      const geom = feature.getGeometry();
      const coords = geom instanceof LineString ? geom.getCoordinates() : [];
      const lineStyle = new Style({
        stroke: new Stroke({
          color: 'rgba(239, 68, 68, 0.95)',
          width: 2,
          lineDash: [4, 4],
          lineCap: 'round',
        }),
      });
      return [lineStyle, ...buildSegmentLiveLabels(map, coords)];
    },
  });

  draw.on('drawend', (event) => {
    const sketch = event.feature as Feature<Geometry>;
    const geom = sketch.getGeometry();
    src.removeFeature(sketch);
    src.changed();
    if (!(geom instanceof LineString)) return;
    const cutter = geom.getCoordinates() as Pt[];
    if (cutter.length < 2) return;

    const targetId = useSelectionStore.getState().primaryId;
    if (targetId == null) {
      toast(
        'Seleccioná primero el elemento a dividir (modo Seleccionar) y luego trazá la línea de corte.',
        {
          variant: 'warning',
          durationMs: 6000,
        }
      );
      return;
    }
    const target = src.getFeatureById(targetId) as Feature<Geometry> | null;
    if (!target) return;

    if (!ctx.isLayerEditable(target)) {
      toast(
        'El elemento seleccionado no está en una capa en edición. Activá "Iniciar edición" en el panel de Capas.',
        {
          variant: 'warning',
          durationMs: 6000,
        }
      );
      return;
    }

    const targetGeom = target.getGeometry();
    let ok = false;

    if (targetGeom instanceof Polygon) {
      const ring = (targetGeom.getCoordinates()[0] ?? []) as Pt[];
      const result = splitPolygonRingByLine(ring, cutter);
      if (!result) {
        toast('La línea de corte debe cruzar el polígono exactamente dos veces, de lado a lado.', {
          variant: 'warning',
          durationMs: 6000,
        });
      } else {
        void runCommand(new SplitFeatureCommand(targetId, [result.a, result.b], true));
        toast('Elemento dividido en 2.', { variant: 'success' });
        ok = true;
      }
    } else if (targetGeom instanceof LineString) {
      const coords = targetGeom.getCoordinates() as Pt[];
      const pieces = splitLineStringByLine(coords, cutter);
      if (!pieces) {
        toast('La línea de corte no cruza el elemento seleccionado.', { variant: 'warning' });
      } else {
        void runCommand(new SplitFeatureCommand(targetId, pieces, false));
        toast(`Elemento dividido en ${pieces.length}.`, { variant: 'success' });
        ok = true;
      }
    } else {
      toast('El elemento seleccionado no se puede dividir (solo polígonos y líneas).', {
        variant: 'warning',
      });
    }

    if (ok) {
      useSelectionStore.getState().clear();
      useDrawStore.getState().setMode('select');
    }
  });

  ctx.activeDrawRef.current = draw;
  map.addInteraction(draw);
  ctx.addCleanup(() => {
    map.removeInteraction(draw);
    if (ctx.activeDrawRef.current === draw) ctx.activeDrawRef.current = null;
  });
}
