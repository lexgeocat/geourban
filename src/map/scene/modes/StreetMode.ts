import Draw from 'ol/interaction/Draw.js';
import { Stroke, Style } from 'ol/style.js';
import LineString from 'ol/geom/LineString.js';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { useStreetStore, type Street } from '../../../store/entities/streetStore';
import { runCommand } from '../../../commands/core/CommandStack';
import { AddStreetCommand } from '../../../commands/roads/AddStreetCommand';
import { requireLayerForKind } from '../../../store/ui/layerPickerStore';
import type { ModeContext } from './ModeContext';

function findNearbyStreetEndpointWarning(
  point: [number, number],
  streets: Street[],
  toleranceM: number,
): string | null {
  for (const s of streets) {
    for (const candidate of [s.start, s.end]) {
      const d = Math.hypot(point[0] - candidate[0], point[1] - candidate[1]);
      if (d > 1e-6 && d < toleranceM) {
        return `El extremo del trazo está a ${d.toFixed(2)}m de un extremo de "${s.name}" sin llegar a conectarse — puede generar un manzano-sliver.`;
      }
    }
  }
  return null;
}

export function activateStreet(ctx: ModeContext): void {
  const { map, streetSource } = ctx;
  const draw = new Draw({
    source: streetSource,
    type: 'LineString',
    style: new Style({
      stroke: new Stroke({ color: 'rgba(255, 166, 87, 0.95)', width: 2.5, lineDash: [6, 4], lineCap: 'round' }),
    }),
  });

  draw.on('drawend', (event) => {
    const feature = event.feature as Feature<Geometry>;
    // ol/interaction/Draw agrega el sketch a `streetSource` SIEMPRE, antes
    // de disparar este evento. Si cualquiera de las validaciones de abajo
    // corta el flujo temprano (geometría degenerada, confirmación
    // cancelada), el feature tiene que salir igual — si no, queda una
    // feature "fantasma" en streetSource que OL sigue dibujando con su
    // estilo por defecto (streetLayer confía en que streetSource esté
    // siempre vacío entre trazos, ver DrawLayerRenderer.ts). Esa era la
    // "línea de más" que aparecía al trazar, y ni "Limpiar vías" ni
    // Deshacer la sacaban porque ninguno de los dos toca streetSource
    // (solo tocan streetStore, que es un store aparte).
    try {
      const geom = feature.getGeometry();
      if (!geom || !(geom instanceof LineString)) return;
      const coords = geom.getCoordinates();
      if (coords.length < 2) return;

      const streetStore = useStreetStore.getState();
      const start = coords[0] as [number, number];
      const end = coords[coords.length - 1] as [number, number];
      const waypoints = coords.length > 2 ? (coords.slice(1, -1) as Array<[number, number]>) : undefined;

      const TOL_M = 2;
      const warning =
        findNearbyStreetEndpointWarning(start, streetStore.streets, TOL_M) ??
        findNearbyStreetEndpointWarning(end, streetStore.streets, TOL_M);
      if (warning && !window.confirm(`${warning}\n\n¿Trazar de todos modos?`)) {
        return;
      }

      void (async () => {
        const layerId = await requireLayerForKind('calle');
        if (!layerId) return; // cancelado — no se traza la calle sin capa
         await runCommand(new AddStreetCommand(start, end, streetStore.defaultWidthM, waypoints, streetStore.defaultSideWidthM, layerId));
       })();
    } finally {
      streetSource.removeFeature(feature);
      streetSource.changed();
    }
  });

  ctx.activeDrawRef.current = draw;
  map.addInteraction(draw);
  ctx.addCleanup(() => {
    map.removeInteraction(draw);
    if (ctx.activeDrawRef.current === draw) ctx.activeDrawRef.current = null;
  });
}