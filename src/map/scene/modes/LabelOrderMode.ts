import Draw from 'ol/interaction/Draw.js';
import { primaryAction } from 'ol/events/condition.js';
import { Stroke, Style } from 'ol/style.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { getFeatureKind } from '../../../core/objectModel';
import { runCommand } from '../../../commands/core/CommandStack';
import { AssignLabelOrderCommand } from '../../../commands/labels/AssignLabelOrderCommand';
import {
  useLabelConfigModalStore,
  type LabelOrderKind,
} from '../../../store/ui/labelConfigModalStore';
import { useDrawStore } from '../../../store/map/drawStore';
import { toast } from '../../../store/ui/toastStore';
import { polygonLabelPoint } from '../../../geo/math/polygonEngine';
import type { ModeContext } from './ModeContext';

/** Distancia acumulada (arco) hasta el punto de `line` más cercano a `pt`. */
function nearestArcLength(pt: [number, number], line: [number, number][]): number {
  let bestDist = Infinity;
  let bestArc = 0;
  let walked = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i],
      b = line[i + 1];
    const abx = b[0] - a[0],
      aby = b[1] - a[1];
    const segLen2 = abx * abx + aby * aby || 1e-9;
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * abx + (pt[1] - a[1]) * aby) / segLen2));
    const projX = a[0] + t * abx,
      projY = a[1] + t * aby;
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

const ORDER_KIND_LABELS: Record<LabelOrderKind, { noun: string; commandLabel: string }> = {
  manzana: { noun: 'manzanos', commandLabel: 'Etiquetar manzanos en orden' },
  lote: { noun: 'lotes', commandLabel: 'Etiquetar lotes en orden' },
};

export function activateLabelOrder(ctx: ModeContext): void {
  const { map, drawSource: src } = ctx;
  const draw = new Draw({
    source: src,
    type: 'LineString',
    condition: primaryAction,
    style: new Style({
      stroke: new Stroke({
        color: 'rgba(245, 158, 11, 0.95)',
        width: 2.5,
        lineDash: [8, 5],
        lineCap: 'round',
      }),
    }),
  });

  draw.on('drawend', (event) => {
    const sketch = event.feature as Feature<Geometry>;
    const geom = sketch.getGeometry();
    src.removeFeature(sketch); // el trazo es solo una herramienta, no queda como feature
    src.changed();
    if (!(geom instanceof LineString)) return;

    const request = useLabelConfigModalStore.getState().orderRequest;
    if (!request) {
      toast('Configurá primero el estilo de etiqueta ("Guardar estilo" o "Trazar orden…").', {
        variant: 'warning',
        durationMs: 6000,
      });
      useDrawStore.getState().setMode('select');
      return;
    }
    const { kind, scopeManzanoId, config, numbering } = request;
    const kindInfo = ORDER_KIND_LABELS[kind];

    const line = geom.getCoordinates() as [number, number][];
    if (line.length < 2) {
      toast(`Trazá una línea que pase cerca de los ${kindInfo.noun}, en el orden deseado.`, {
        variant: 'warning',
      });
      return; // se puede reintentar el trazo sin abortar el modo
    }

    const items: Array<{ id: string | number; arc: number }> = [];
    src.forEachFeature((f) => {
      const feat = f as Feature<Geometry>;
      if (getFeatureKind(feat) !== kind) return;
      if (
        kind === 'lote' &&
        scopeManzanoId != null &&
        feat.get('lotGroupId') !== String(scopeManzanoId)
      )
        return;
      const g = feat.getGeometry();
      if (!(g instanceof Polygon)) return;
      const id = feat.getId();
      if (id == null) return;
      const ring = (g.getCoordinates()[0] ?? []) as [number, number][];
      const anchor =
        (feat.get('labelPoint') as [number, number] | undefined) ??
        (ring.length >= 3
          ? polygonLabelPoint(ring)
          : (g.getInteriorPoint().getCoordinates() as [number, number]));
      items.push({ id, arc: nearestArcLength(anchor, line) });
    });

    if (items.length === 0) {
      toast(`No hay ${kindInfo.noun} para etiquetar.`, { variant: 'warning' });
      useLabelConfigModalStore.getState().clearOrderTrace();
      useDrawStore.getState().setMode('select');
      return;
    }

    items.sort((a, b) => a.arc - b.arc);
    const orderedIds = items.map((m) => m.id);

    void runCommand(
      new AssignLabelOrderCommand({ orderedIds, config, numbering, label: kindInfo.commandLabel })
    );
    toast(`${orderedIds.length} ${kindInfo.noun} etiquetados según el orden trazado.`, {
      variant: 'success',
    });
    useLabelConfigModalStore.getState().clearOrderTrace();
    useDrawStore.getState().setMode('select');
  });

  ctx.activeDrawRef.current = draw;
  map.addInteraction(draw);
  ctx.addCleanup(() => {
    map.removeInteraction(draw);
    if (ctx.activeDrawRef.current === draw) ctx.activeDrawRef.current = null;
  });
}
