import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { getFeatureKind } from '../../../core/objectModel';
import { runCommand } from '../../../commands/core/CommandStack';
import { AssignManzanoLabelOrderCommand } from '../../../commands/labels/AssignManzanoLabelOrderCommand';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { useDrawStore } from '../../../store/map/drawStore';
import { toast } from '../../../store/ui/toastStore';
import type { ModeContext } from './ModeContext';

/** Distancia acumulada (arco) hasta el punto de `line` más cercano a `pt`. */
function nearestArcLength(pt: [number, number], line: [number, number][]): number {
  let bestDist = Infinity;
  let bestArc = 0;
  let walked = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const abx = b[0] - a[0], aby = b[1] - a[1];
    const segLen2 = abx * abx + aby * aby || 1e-9;
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby) / segLen2));
    const projX = a[0] + t * abx, projY = a[1] + t * aby;
    const d = Math.hypot(pt[0] - projX, pt[1] - projY);
    const segLen = Math.sqrt(segLen2);
    if (d < bestDist) {
      bestDist = d;
      bestArc = walked + t * segLen;
    }
    walked += segLen;
  }
  return bestArc;
}

export function activateLabelOrder(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'LineString',
    condition: primaryAction,
    style: new Style({
      stroke: new Stroke({ color: 'rgba(245, 158, 11, 0.95)', width: 2.5, lineDash: [8, 5], lineCap: 'round' }),
    }),
  });

  draw.on('drawend', (event) => {
    const sketch = event.feature as Feature<Geometry>;
    const geom = sketch.getGeometry();
    src.removeFeature(sketch); // el trazo es solo una herramienta, no queda como feature
    src.changed();
    if (!(geom instanceof LineString)) return;

    const line = geom.getCoordinates() as [number, number][];
    if (line.length < 2) {
      toast('Trazá una línea que pase cerca de los manzanos, en el orden deseado.', { variant: 'warning' });
      return;
    }

    const manzanos: Array<{ id: string | number; arc: number }> = [];
    src.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== 'manzana') return;
      const g = feat.getGeometry();
      if (!(g instanceof Polygon)) return;
      const id = feat.getId();
      if (id == null) return;
      const anchor =
        (feat.get('labelPoint') as [number, number] | undefined) ??
        (g.getInteriorPoint().getCoordinates() as [number, number]);
      manzanos.push({ id, arc: nearestArcLength(anchor, line) });
    });

    if (manzanos.length === 0) {
      toast('No hay manzanos para etiquetar.', { variant: 'warning' });
      useDrawStore.getState().setMode('select');
      return;
    }

    manzanos.sort((a, b) => a.arc - b.arc);
    const orderedIds = manzanos.map((m) => m.id);

    const modalStore = useLabelConfigModalStore.getState();
    const config = modalStore.lastManzanoConfig;
    if (!config) {
      toast('Configurá primero el estilo de etiqueta de manzanos ("Configurar / Trazar orden…").', {
        variant: 'warning',
        durationMs: 6000,
      });
      useDrawStore.getState().setMode('select');
      return;
    }

    void runCommand(new AssignManzanoLabelOrderCommand(orderedIds, config, modalStore.numberingMode));
    toast(`${orderedIds.length} manzano(s) etiquetados según el orden trazado.`, { variant: 'success' });
    useDrawStore.getState().setMode('select');

  });

  ctx.activeDrawRef.current = draw;
  map.addInteraction(draw);
  ctx.addCleanup(() => {
    map.removeInteraction(draw);
    if (ctx.activeDrawRef.current === draw) ctx.activeDrawRef.current = null;
  });
}
