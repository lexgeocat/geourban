import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import React, { useEffect, useRef } from 'react';
import Map from 'ol/Map.js';
import View from 'ol/View.js';
import type BaseLayer from 'ol/layer/Base.js';
import VectorLayer from 'ol/layer/Vector.js';
import { defaults } from 'ol/control.js';
import Attribution from 'ol/control/Attribution.js';
import VectorSource from 'ol/source/Vector.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Select from 'ol/interaction/Select.js';
import DragPan from 'ol/interaction/DragPan.js';
import SafeTranslate from './safeTranslate';
import { unByKey } from 'ol/Observable.js';
import { toLonLat, fromLonLat, transform } from 'ol/proj.js';
import { Fill, Stroke, Style, Circle as CircleStyle, RegularShape } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import type Geometry from 'ol/geom/Geometry.js';

// Función para calcular el zoom a partir de la resolución (usada en styleFactory.ts)
function getZoomFromResolution(resolution: number) {
  return Math.log2(156543.03392804097 / resolution);
}
import { click as clickCondition, pointerMove } from 'ol/events/condition.js';
import { useLayerStore } from '../store/layerStore';
import { useMapStore } from '../store/mapStore';
import { useDrawStore } from '../store/drawStore';
import { useHistoryStore } from '../store/historyStore';
import { useSelectionStore } from '../store/selectionStore';
import { useProjectCrsStore } from '../store/projectCrsStore';
import { updateFeatureMetrics, formatMetricArea, formatMetricLength, type SegmentMetric } from '../geo/metrics';
import { SNAP_COLORS, type SnapGuideVisual } from './advancedSnap';
import SnapEngine from './snapInteraction';
import { BASE_MAP_DEFS } from './baseMaps';
import {
  createMeasurementStyle,
  drawSegmentLabels,
  createLiveDrawingLabelStyle,
  drawMainMetricLabel,
  resolveDimensionOrientation,
  computeLotGroupCounts,
  getApproxScreenArea,
} from './styleFactory';
import { useStreetStore } from '../store/streetStore';
import { recomputeManzanos } from '../store/mapStore';
import { computeStreetFillets, filletArcPoints } from '../geo/streetEngine';
import { getOrCreateSpatialIndex } from './demoDataset';
import { ensureUtmZoneRegistered } from '../geo/utmZones';

// ─── willReadFrequently: parche global único ─────────────────────────────
// OpenLayers usa getImageData internamente para hit-testing en capas Canvas2D.
// Sin willReadFrequently=true el browser emite una advertencia de performance
// cada vez que se leen píxeles (múltiples readback operations).
if (!(HTMLCanvasElement.prototype as any).__willReadFreqPatched) {
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as any).__willReadFreqPatched = true;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...args: any[]) {
    if (type === '2d' || type === 'bitmaprenderer') {
      const attrs = (args[0] || {}) as CanvasRenderingContext2DSettings;
      if (!attrs.willReadFrequently) {
        args[0] = { ...attrs, willReadFrequently: true };
      }
    }
    return origGetContext.call(this, type, ...args);
  } as typeof HTMLCanvasElement.prototype.getContext;
}

export default function MapView() {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<Map | null>(null);
  const baseLayerRef = useRef<BaseLayer | null>(null);
  const baseLayerCleanupRef = useRef<(() => void) | null>(null);
  const baseMapInitializedRef = useRef(false);
  const baseMapEffectPrimedRef = useRef(false);
  const measurementLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawLayerRef = useRef<WebGLVectorLayer | null>(null);
  const streetLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const drawSrcRef = useRef<VectorSource | null>(null);
  const streetLayerSrcRef = useRef<VectorSource | null>(null);
  const snapGuideRef = useRef<SnapGuideVisual | null>(null);
  const selectInteractionRef = useRef<Select | null>(null);
  const snapEngineRef = useRef<SnapEngine | null>(null);
  const activeDrawRef = useRef<Draw | null>(null);
  const baseMapId = useLayerStore((s) => s.baseMap);
  const workVisibility = useLayerStore((s) => s.workVisibility);
  const viewConfig = useMapStore((s) => s.viewConfig);
  const drawMode = useDrawStore().mode;

  // --- Inicializar mapa (solo una vez) ---
  useEffect(() => {
    if (!mapDivRef.current) return;

    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const baseLayer = def.create() as BaseLayer;
    baseLayerRef.current = baseLayer;

    // --- Capa de dibujo persistente (features del usuario) ---
    const drawSrc = new VectorSource();
    drawSrcRef.current = drawSrc;
    useMapStore.getState().setDrawSource(drawSrc);
    // WebGL layer: fill/stroke base para TODOS los features.
    // Manzanos con colores cíclicos vía match expression (reemplaza postrender fill).
    const MZN_COLORS_22 = [
      'rgba(88,166,255,0.13)', 'rgba(63,185,80,0.13)', 'rgba(245,158,11,0.13)',
      'rgba(239,68,68,0.13)', 'rgba(139,92,246,0.13)', 'rgba(236,72,153,0.13)',
      'rgba(20,184,166,0.13)', 'rgba(249,115,22,0.13)', 'rgba(6,182,212,0.13)',
      'rgba(132,204,22,0.13)',
    ];
    const MZN_COLORS_STR = [
      '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
      '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
    ];
    const mznFillExpr = ['match', ['get', 'colorIdx'],
      0, MZN_COLORS_22[0], 1, MZN_COLORS_22[1], 2, MZN_COLORS_22[2],
      3, MZN_COLORS_22[3], 4, MZN_COLORS_22[4], 5, MZN_COLORS_22[5],
      6, MZN_COLORS_22[6], 7, MZN_COLORS_22[7], 8, MZN_COLORS_22[8],
      9, MZN_COLORS_22[9], 'rgba(16,185,129,0.30)',
    ] as any[];
    const mznStrokeExpr = ['match', ['get', 'colorIdx'],
      0, MZN_COLORS_STR[0], 1, MZN_COLORS_STR[1], 2, MZN_COLORS_STR[2],
      3, MZN_COLORS_STR[3], 4, MZN_COLORS_STR[4], 5, MZN_COLORS_STR[5],
      6, MZN_COLORS_STR[6], 7, MZN_COLORS_STR[7], 8, MZN_COLORS_STR[8],
      9, MZN_COLORS_STR[9], '#10b981',
    ] as any[];
    const drawLayer = new WebGLVectorLayer({
      source: drawSrc,
      disableHitDetection: true,
      style: {
        'fill-color': ['case', ['==', ['get', 'type'], 'manzana'], mznFillExpr, 'rgba(16,185,129,0.30)'],
        'stroke-color': ['case', ['==', ['get', 'type'], 'manzana'], mznStrokeExpr, '#10b981'],
        'stroke-width': 2,
      },
    });
    drawLayerRef.current = drawLayer;
    const measurementLayer = new VectorLayer({
      source: drawSrc,
      visible: workVisibility.measurements,
      declutter: true,
      style: createMeasurementStyle(),
    });
    measurementLayerRef.current = measurementLayer;

    // --- Capa de calles ---
    const streetLayerSrc = new VectorSource();
    streetLayerSrcRef.current = streetLayerSrc;
    const streetLayer = new VectorLayer({
      source: streetLayerSrc,
      visible: workVisibility.streets,
      style: new Style({
        stroke: new Stroke({
          color: 'rgba(255, 166, 87, 0.85)',
          width: 3,
          lineCap: 'round',
        }),
      }),
    });
    streetLayerRef.current = streetLayer;

    // --- Capa Canvas2D dedicada para postrender (labels, cotas, fillets) ---
    // Esta capa siempre visible garantiza que el postrender tenga un
    // CanvasRenderingContext2D válido, incluso si el usuario oculta las
    // mediciones o la capa de calles.
    const postrenderLayer = new VectorLayer({
      source: new VectorSource(),
      style: () => undefined,
      renderOrder: undefined,
    });

    const map = new Map({
      target: mapDivRef.current!,
      layers: [baseLayer, drawLayer, measurementLayer, streetLayer, postrenderLayer],
      view: new View({
        center: fromLonLat(viewConfig.center),
        zoom: viewConfig.zoom,
      }),
      controls: defaults({ attribution: false }).extend([
        new Attribution({
          collapsible: false,
          className: 'custom-attribution',
        }),
      ]),
    });

    // Reemplazar el DragPan por defecto (left-click) con uno de click derecho+medio
    // 1. Encontrar y remover el DragPan por defecto
    const interactions = map.getInteractions();
    const toRemove: any[] = [];
    interactions.forEach((interaction) => {
      if (interaction instanceof DragPan) {
        toRemove.push(interaction);
      }
    });
    toRemove.forEach((interaction) => interactions.remove(interaction));

    // 2. Agregar DragPan con click derecho (button 2) o click medio (button 1)
    const dragPan = new DragPan({
      condition: (event) => {
        const oe = event.originalEvent as unknown;
        if (!(oe instanceof MouseEvent)) return false;
        return oe.button === 1 || oe.button === 2;
      },
    });
    interactions.push(dragPan);

    // Prevenir menu contextual del click derecho en el mapa
    map.getViewport().addEventListener('contextmenu', (e) => e.preventDefault());

    // Cursor "manito" (grab) cuando se hace pan con click derecho o medio
    const viewport = map.getViewport();
    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1 || e.button === 2) {
        viewport.style.cursor = 'grabbing';
      }
    };
    const onPointerUp = () => {
      viewport.style.cursor = '';
    };
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointerup', onPointerUp);
    viewport.addEventListener('pointerleave', onPointerUp);

    // ─── Post-render cache (performance) ─────────────────────────────
    const MZN_COLORS = [
      '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
      '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
    ];
    const renderCache = {
      lastZoom: -1,
      lastFeatureCount: -1,
      lastStreetHash: '',
      cachedFillets: [] as ReturnType<typeof computeStreetFillets>,
      lotGroupCounts: new globalThis.Map<string, number>(),
      dirty: true,
    };
    function streetsHash(streets: any[]): string {
      return streets.map((s) => `${s.id}:${s.start[0]},${s.start[1]}-${s.end[0]},${s.end[1]}:${s.widthM}`).join('|');
    }

    // Marcar dirty cuando cambian features
    const onFeatureChange = () => { renderCache.dirty = true; };
    drawSrc.on('addfeature', onFeatureChange);
    drawSrc.on('removefeature', onFeatureChange);
    drawSrc.on('change', onFeatureChange);

    // --- Post-render para dibujar acotaciones manualmente (LOTES_SAI style) ---
    const postRenderHandler = (event: any) => {
      const ctx = event.context as CanvasRenderingContext2D | undefined;
      // ctx es undefined cuando el mapa usa solo renderer WebGL (WebGLVectorLayer).
      // Como dibujamos labels Canvas2D, necesitamos postrender sobre una capa Canvas.
      // Si no hay contexto, nos rendimos temprano.
      if (!ctx) return;
      const resolution = map.getView().getResolution() ?? 1;
      const zoom = getZoomFromResolution(resolution);
      const features = drawSrcRef.current?.getFeatures() ?? [];

      // Detectar si algo cambió desde el último frame
      const currentFeatureCount = features.length;
      const streets = useStreetStore.getState().streets;
      const currentStreetHash = streetsHash(streets);
      const featuresChanged = currentFeatureCount !== renderCache.lastFeatureCount;
      const streetsChanged = currentStreetHash !== renderCache.lastStreetHash;

      // Memoizar fillets: solo recalcular cuando calles cambian
      if (streetsChanged || renderCache.dirty) {
        renderCache.cachedFillets = computeStreetFillets(streets);
        renderCache.lastStreetHash = currentStreetHash;
      }

      // Recalcular agrupación de lotes (solo cuando features cambian) — decide
      // qué features comparten `lotGroupId` para elegir cotas internas/externas.
      if (featuresChanged || renderCache.dirty) {
        renderCache.lotGroupCounts = computeLotGroupCounts(features as Feature<Geometry>[]);
      }

      renderCache.lastZoom = zoom;
      renderCache.lastFeatureCount = currentFeatureCount;
      renderCache.dirty = false;

      // ─── toPx compartido: mundo (EPSG:3857) -> pixeles de canvas ───────
      const toPx = (coord: number[]): [number, number] => {
        const px = map.getPixelFromCoordinate(coord as [number, number]);
        return px ? [px[0], px[1]] : [0, 0];
      };
      const selectedIds = useSelectionStore.getState().selectedIds;

      // ─── Dibujar labels de manzanos/lotes + cotas (fill/stroke va en WebGL) ───
      for (let fi = 0; fi < features.length; fi++) {
        const feature = features[fi];
        const geometry = feature.getGeometry();
        if (!geometry) continue;

        const isManzana = feature.get('type') === 'manzana';
        const colorIdx = feature.get('colorIdx') ?? 0;
        const featureId = feature.getId();
        const isSelected = featureId != null && selectedIds.has(featureId as string | number);
        const orientation = resolveDimensionOrientation(feature as Feature<Geometry>, renderCache.lotGroupCounts);
        const labelPoint = feature.get('labelPoint') as [number, number] | undefined;

        if (geometry instanceof Polygon) {
          const coordinates = geometry.getCoordinates()[0] ?? [];
          if (coordinates.length < 3) continue;

          const showMainLabel =
            isSelected || zoom > 15.5 || getApproxScreenArea(geometry, resolution) >= 4200;
          if (showMainLabel && labelPoint) {
            const areaM2 = feature.get('areaM2') as number | undefined;
            if (areaM2 !== undefined) {
              if (isManzana) {
                const mznColor = MZN_COLORS[colorIdx % MZN_COLORS.length];
                drawMainMetricLabel(ctx, labelPoint, toPx, `Mzo. ${colorIdx + 1}`, true, {
                  extraLine: formatMetricArea(areaM2),
                  color: mznColor,
                });
              } else {
                drawMainMetricLabel(ctx, labelPoint, toPx, formatMetricArea(areaM2), false);
              }
            }
          }

          // Cotas de cada lado
          drawSegmentLabels(
            ctx,
            coordinates,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            toPx,
            isManzana,
          );
        } else if (geometry instanceof LineString) {
          const coordinates = geometry.getCoordinates() ?? [];
          if (coordinates.length < 2) continue;

          const showMainLabel = isSelected || zoom > 15.5;
          if (showMainLabel && labelPoint) {
            const lengthM = feature.get('lengthM') as number | undefined;
            if (lengthM !== undefined) {
              drawMainMetricLabel(ctx, labelPoint, toPx, formatMetricLength(lengthM), false);
            }
          }

          drawSegmentLabels(
            ctx,
            coordinates,
            feature.get('segmentLengths') as SegmentMetric[] | undefined,
            labelPoint,
            orientation,
            toPx,
            false,
          );
        }
      }

      // ─── Calles (con fillets cacheados) ───
      const streetVisible = useStreetStore.getState().visible;
      if (streetVisible && streets.length > 0) {
        const fillets = renderCache.cachedFillets;

        for (let si = 0; si < streets.length; si++) {
          const s = streets[si];
          const sPx = toPx(s.start);
          const ePx = toPx(s.end);
          const dx = ePx[0] - sPx[0], dy = ePx[1] - sPx[1];
          const len = Math.hypot(dx, dy);
          if (len < 1) continue;
          const nx = -dy / len, ny = dx / len;
          const halfPx = (s.widthM / 2) / resolution;

          // Cuerpo de calle
          ctx.save();
          ctx.fillStyle = 'rgba(247, 129, 102, 0.08)';
          ctx.beginPath();
          ctx.moveTo(sPx[0] + nx * halfPx, sPx[1] + ny * halfPx);
          ctx.lineTo(ePx[0] + nx * halfPx, ePx[1] + ny * halfPx);
          ctx.lineTo(ePx[0] - nx * halfPx, ePx[1] - ny * halfPx);
          ctx.lineTo(sPx[0] - nx * halfPx, sPx[1] - ny * halfPx);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Bordes sólidos
          ctx.save();
          ctx.strokeStyle = 'rgba(247, 129, 102, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.lineCap = 'round';
          for (const side of [1, -1]) {
            const ox = nx * halfPx * side;
            const oy = ny * halfPx * side;
            ctx.beginPath();
            ctx.moveTo(sPx[0] + ox, sPx[1] + oy);
            ctx.lineTo(ePx[0] + ox, ePx[1] + oy);
            ctx.stroke();
          }
          ctx.restore();

          // Eje central punteado
          ctx.save();
          ctx.strokeStyle = 'rgba(247, 129, 102, 0.75)';
          ctx.lineWidth = 1;
          ctx.setLineDash([7, 5]);
          ctx.beginPath();
          ctx.moveTo(sPx[0], sPx[1]);
          ctx.lineTo(ePx[0], ePx[1]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();

          // Etiquetas
          if (zoom > 12) {
            const midPx: [number, number] = [(sPx[0] + ePx[0]) / 2, (sPx[1] + ePx[1]) / 2];
            let ang = Math.atan2(dy, dx);
            if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
            const fs1 = Math.max(9, Math.min(13, 10 * zoom / 18));
            const fs2 = Math.max(8, Math.min(11, 9 * zoom / 18));
            ctx.save();
            ctx.translate(midPx[0], midPx[1]);
            ctx.rotate(ang);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${fs1}px Courier New`;
            ctx.fillStyle = 'rgba(247, 129, 102, 0.85)';
            ctx.fillText(`--- ${s.name} (Ancho de Vía ${s.widthM.toFixed(2)}m) ---`, 0, -fs1 * 0.8);
            ctx.font = `${fs2}px Courier New`;
            ctx.fillStyle = 'rgba(247, 129, 102, 0.55)';
            ctx.fillText('E   J   E    D   E     V   Í   A', 0, fs2 * 0.8);
            ctx.restore();
          }
        }

        // Fillets cacheados
        ctx.save();
        ctx.strokeStyle = 'rgba(247, 129, 102, 0.65)';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        for (const fillet of fillets) {
          const arcPts = filletArcPoints(fillet, 16);
          if (arcPts.length < 2) continue;
          const firstPx = toPx(arcPts[0]);
          ctx.beginPath();
          ctx.moveTo(firstPx[0], firstPx[1]);
          for (let i = 1; i < arcPts.length; i++) {
            const px = toPx(arcPts[i]);
            ctx.lineTo(px[0], px[1]);
          }
          ctx.stroke();
        }
        ctx.restore();
      };
      // ─── Guía visual de snap (línea punteada, escuadra, segmento resaltado) ───
      const guide = snapGuideRef.current;
      if (guide) {
        if (guide.highlightSegment) {
          const [ga, gb] = guide.highlightSegment;
          const gaPx = map.getPixelFromCoordinate(ga);
          const gbPx = map.getPixelFromCoordinate(gb);
          if (gaPx && gbPx) {
            ctx.save();
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(gaPx[0], gaPx[1]);
            ctx.lineTo(gbPx[0], gbPx[1]);
            ctx.stroke();
            ctx.restore();
          }
        }
        if (guide.dashedLine) {
          const [da, db] = guide.dashedLine;
          const daPx = map.getPixelFromCoordinate(da);
          const dbPx = map.getPixelFromCoordinate(db);
          if (daPx && dbPx) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 212, 255, 0.85)';
            ctx.lineWidth = 1.25;
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(daPx[0], daPx[1]);
            ctx.lineTo(dbPx[0], dbPx[1]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
        if (guide.rightAngleSquare) {
          const { point, size } = guide.rightAngleSquare;
          const centerPx = map.getPixelFromCoordinate(point);
          if (centerPx) {
            const sizePx = Math.max(6, size / resolution);
            ctx.save();
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(centerPx[0] - sizePx / 2, centerPx[1] - sizePx / 2, sizePx, sizePx);
            ctx.restore();
          }
        }
        if (guide.distanceLabel) {
          const { point, text } = guide.distanceLabel;
          const px = map.getPixelFromCoordinate(point);
          if (px) {
            ctx.save();
            ctx.font = '10px Courier New';
            ctx.fillStyle = 'rgba(0, 212, 255, 0.9)';
            ctx.textAlign = 'center';
            ctx.fillText(text, px[0], px[1] - 6);
            ctx.restore();
          }
        }
      }
    };
    postrenderLayer.on('postrender', postRenderHandler);

    // --- Live cursor coordinates & zoom ---
    const setCursorCoords = useMapStore.getState().setCursorCoords;
    const setZoom = useMapStore.getState().setZoom;
    const view = map.getView();

     map.on('pointermove', (evt) => {
      const crs = useProjectCrsStore.getState();
      if (crs.mode === 'utm') {
        // Con UTM activo, mostramos las coordenadas REALES proyectadas
        // (metros), no lon/lat — es lo que un CAD/GIS mostraría.
        const epsg = ensureUtmZoneRegistered(crs.utmZone, crs.utmHemisphere);
        const projected = transform(evt.coordinate, 'EPSG:3857', epsg) as [number, number];
        setCursorCoords({ x: projected[0], y: projected[1], isProjected: true });
      } else {
        const lonLat = toLonLat(evt.coordinate);
        setCursorCoords({ x: lonLat[0], y: lonLat[1], isProjected: false });
      }
    });

    const onZoomChange = () => {
      const z = view.getZoom();
      if (z !== undefined) {
        setZoom(z);
      }
    };
    view.on('change:resolution', onZoomChange);
    const initialZoom = view.getZoom();
    if (initialZoom !== undefined) {
      setZoom(initialZoom);
    }

    // Mantiene viewConfig (mapStore) sincronizado con la posición REAL del
    // mapa. Antes viewConfig.center quedaba congelado en su valor default
    // — nunca se actualizaba al hacer pan/zoom — lo que rompía "Detectar
    // zona UTM desde la vista actual" (siempre detectaba la ubicación
    // default) y también el autosave/guardado (siempre guardaba la vista
    // inicial, no la última vista real del usuario).
    const onMoveEnd = () => {
      const center = view.getCenter();
      const currentZoom = view.getZoom();
      if (center && currentZoom !== undefined) {
        const lonLat = toLonLat(center) as [number, number];
        useMapStore.getState().setViewConfig({ center: lonLat, zoom: currentZoom });
      }
    };
    const moveEndKey = map.on('moveend', onMoveEnd);

    // --- Indicador visual de snap (capa overlay, agregada al final) ---
    const snapIndicatorSrc = new VectorSource();
    const snapIndicatorLayer = new VectorLayer({
      source: snapIndicatorSrc,
      style: new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#f59e0b' }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }),
    });
    map.addLayer(snapIndicatorLayer);

    // Pre-crear estilos de snap (uno por tipo, reutilizados en cada frame)
    const snapStyles = new globalThis.Map<string, Style>();
    for (const [type, color] of Object.entries(SNAP_COLORS)) {
      snapStyles.set(type, new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color }),
          stroke: new Stroke({ color: '#fff', width: 1.5 }),
        }),
      }));
    }

    // Spatial Index para snap O(log n)
    const spatialIndex = getOrCreateSpatialIndex();
    spatialIndex.load(drawSrc.getFeatures() as Feature<Polygon>[]);

    // Actualizar índice cuando cambian features
    const onSpatialInsert = (evt: any) => {
      if (evt.feature instanceof Feature) spatialIndex.insert(evt.feature as Feature<Polygon>);
    };
    const onSpatialRemove = (evt: any) => {
      if (evt.feature instanceof Feature) spatialIndex.remove(evt.feature as Feature<Polygon>);
    };
    drawSrc.on('addfeature', onSpatialInsert);
    drawSrc.on('removefeature', onSpatialRemove);

// ────────────────────────────────────────────────────────────────
    // Motor de snap unificado — SnapEngine (interaction de OL) corrige
    // evt.coordinate/evt.pixel ANTES que Draw/Modify/Translate/Select
    // procesen el evento. Esto es lo que hace que el click real quede
    // pegado EXACTO al punto de snap mostrado (antes solo se movía el
    // sketch de preview, y el click final usaba la coordenada cruda del
    // mouse). Ver src/map/snapInteraction.ts.
    // ────────────────────────────────────────────────────────────────
    const getAnchor = (): number[] | undefined => {
      const draw = activeDrawRef.current;
      if (!draw) return undefined;
      const overlaySrc = draw.getOverlay().getSource();
      const sketch = overlaySrc?.getFeatures()[0];
      const sketchGeom = sketch?.getGeometry();
      if (!sketchGeom) return undefined;
      const ring =
        sketchGeom instanceof Polygon
          ? sketchGeom.getCoordinates()[0]
          : sketchGeom instanceof LineString
            ? sketchGeom.getCoordinates()
            : [];
      return ring.length >= 2 ? (ring[ring.length - 2] as number[]) : undefined;
    };

    const getExcludeFeature = (): Feature<Geometry> | undefined => {
      const mode = useDrawStore.getState().mode;
      if (mode !== 'edit') return undefined;
      const ds = drawSrcRef.current;
      const primaryId = useSelectionStore.getState().primaryId;
      const f = ds && primaryId != null ? ds.getFeatureById(primaryId) : null;
      return (f as Feature<Geometry>) ?? undefined;
    };

    // Snap de cierre de polígono: iman al primer vértice del sketch
    // activo cuando el cursor entra en el radio de cierre. Prioridad
    // absoluta sobre cualquier otro snap.
    const getCloseTarget = (coordinate: number[]): number[] | null => {
      if (useDrawStore.getState().mode !== 'polyline') return null;
      const draw = activeDrawRef.current;
      if (!draw) return null;
      const overlaySrc = draw.getOverlay().getSource();
      const sketch = overlaySrc?.getFeatures()[0];
      const sketchGeom = sketch?.getGeometry();
      if (!sketchGeom) return null;
      const rings =
        sketchGeom instanceof Polygon
          ? sketchGeom.getCoordinates()
          : sketchGeom instanceof LineString
            ? [sketchGeom.getCoordinates()]
            : [];
      const ring = rings[0];
      if (!ring || ring.length < 4) return null;
      const first = ring[0] as number[];
      const resolution = map.getView().getResolution() ?? 1;
      const closeRadiusMap = 12 * resolution;
      const dx = first[0] - coordinate[0];
      const dy = first[1] - coordinate[1];
      return Math.hypot(dx, dy) <= closeRadiusMap ? first : null;
    };

    const getEnabled = () => useDrawStore.getState().mode !== 'erase';

    // Qué tipos de evento "imantan" (sobreescriben) la coordenada real:
    //  - polyline/street: TODOS — el vértice que Draw termina agregando
    //    es EXACTO al punto de snap mostrado, no una aproximación del
    //    click del mouse.
    //  - edit: solo 'pointerdrag' — arrastrar un vértice (Modify) o una
    //    feature completa (Translate) se pega a otros puntos, sin tocar
    //    los clicks de selección (Select sigue usando el click real).
    const shouldSnapCoordinate = (eventType: string): boolean => {
      const mode = useDrawStore.getState().mode;
      if (mode === 'polyline' || mode === 'street') return true;
      if (mode === 'edit' && eventType === 'pointerdrag') return true;
      return false;
    };

    const snapEngine = new SnapEngine({
      getSource: () => drawSrcRef.current,
      spatialIndex,
      getEnabled,
      shouldSnapCoordinate,
      getAnchor,
      getExcludeFeature,
      getPriorityTarget: getCloseTarget,
      pixelTolerance: 10,
      onResultChange: (result) => {
        snapIndicatorSrc.clear();
        if (result) {
          snapIndicatorLayer.setStyle(snapStyles.get(result.type) ?? snapStyles.get('endpoint')!);
          snapIndicatorSrc.addFeature(
            new Feature({ geometry: new Point(result.point), snapType: result.type })
          );
        }
      },
      onGuideChange: (guide) => {
        snapGuideRef.current = guide;
        postrenderLayer.changed();
      },
    });
    snapEngineRef.current = snapEngine;
    map.addInteraction(snapEngine);

    useMapStore.getState().setMap(map);
    mapInstanceRef.current = map;

    if (def.attach) {
      baseLayerCleanupRef.current = def.attach(map, baseLayer);
    }
    baseMapInitializedRef.current = true;

    return () => {
      baseLayerCleanupRef.current?.();
      baseLayerCleanupRef.current = null;
      map.removeInteraction(snapEngine);
      snapEngineRef.current = null;
      unByKey(moveEndKey);
      postrenderLayer.un('postrender', postRenderHandler);
      drawSrc.un('addfeature', onFeatureChange);
      drawSrc.un('removefeature', onFeatureChange);
      drawSrc.un('change', onFeatureChange);
      drawSrc.un('addfeature', onSpatialInsert);
      drawSrc.un('removefeature', onSpatialRemove);
      useMapStore.getState().setMap(null);
      useMapStore.getState().setDrawSource(null);
      const m = mapInstanceRef.current;
      if (m) m.setTarget(undefined);
      mapInstanceRef.current = null;
    };
  }, []);

  // --- Cambiar mapa base ---
  useEffect(() => {
    if (!baseMapEffectPrimedRef.current) {
      baseMapEffectPrimedRef.current = true;
      return;
    }

    const map = mapInstanceRef.current;
    const oldLayer = baseLayerRef.current;
    if (!map || !baseMapInitializedRef.current) return;

    baseLayerCleanupRef.current?.();
    baseLayerCleanupRef.current = null;

    const def = BASE_MAP_DEFS.find((d) => d.id === baseMapId) ?? BASE_MAP_DEFS[0];
    const newLayer = def.create() as BaseLayer;
    baseLayerRef.current = newLayer;

    if (oldLayer) {
      map.removeLayer(oldLayer);
    }
    map.getLayers().insertAt(0, newLayer);

    if (def.attach) {
      baseLayerCleanupRef.current = def.attach(map, newLayer);
    }
  }, [baseMapId]);

  // --- Visibilidad de cotas automáticas ---
  useEffect(() => {
    if (measurementLayerRef.current) {
      measurementLayerRef.current.setVisible(workVisibility.measurements);
    }
  }, [workVisibility.measurements]);

  // --- Visibilidad de calles/viales ---
  useEffect(() => {
    if (streetLayerRef.current) {
      streetLayerRef.current.setVisible(workVisibility.streets);
    }
  }, [workVisibility.streets]);

  // --- Visibilidad de lotes/manzanos (WebGL layer) ---
  useEffect(() => {
    if (drawLayerRef.current) {
      drawLayerRef.current.setVisible(workVisibility.lots);
    }
  }, [workVisibility.lots]);

  // --- Interacciones según modo activo ---
  useEffect(() => {
    const map = mapInstanceRef.current;
    const src = drawSrcRef.current;
    if (!map || !src) return;

    // Cursor: crosshair (+) tipo AutoCAD solo en modos de dibujo.
    const viewport = map.getViewport();
    const previousCursor = viewport.getAttribute('data-cursor');
    if (drawMode === 'polyline') {
      viewport.setAttribute('data-cursor', drawMode);
    } else {
      viewport.removeAttribute('data-cursor');
    }

    const toClean: (() => void)[] = [];

    // Helper: dispara redraw de AMBAS capas (WebGL + Canvas). La
    // measurementLayer (Canvas) es la que usa OL para hit-test, pero
    // la drawLayer (WebGL) es la que el usuario VE como el poligono
    // "guardado". Sin forzar el redraw de la WebGL, las ediciones
    // (modify, translate) no se reflejan visualmente hasta el
    // siguiente zoom/pan. Llamamos changed() en ambas.
    const refreshLayers = () => {
      measurementLayerRef.current?.changed();
      drawLayerRef.current?.changed();
    };

    // Limpia interaccion Select previa antes de crear una nueva
    if (selectInteractionRef.current) {
      map.removeInteraction(selectInteractionRef.current);
      selectInteractionRef.current = null;
    }

    // La capa WebGL drawLayer tiene disableHitDetection:true y NO soporta
    // forEachFeatureAtCoordinate. Select/Modify/Translate deben restringirse
    // SOLO a measurementLayer (capa Canvas normal), o crashean al mover el
    // mouse. Se usa un array explicito (no funcion) para maxima compatibilidad
    // con el hit-detection interno de OL.
    const hitDetectionLayers = measurementLayerRef.current
      ? [measurementLayerRef.current]
      : [];

    // Helper: maneja el "select" event de OL de manera CAD-like.
    //   click normal      -> reemplaza la seleccion por el feature clickeado
    //   shift+click       -> toggle (agrega o quita)
    //   click en vacio    -> limpia la seleccion
    // Se usa tanto en modo 'select' como en 'edit' (en edit, click en el
    // exterior limpia la seleccion y permite empezar de nuevo).
    const wireSelectBehavior = (select: Select) => {
      select.on('select', (evt) => {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        const shift = !!oe?.shiftKey;
        const selected = select.getFeatures().getArray();
        const clickedFeature =
          ((evt as any).selected?.[0] as Feature<Geometry> | undefined) ??
          (selected[selected.length - 1] as Feature<Geometry> | undefined);

        // click en el vacio: limpia la seleccion
        if (selected.length === 0) {
          useSelectionStore.getState().clear();
          refreshLayers();
          return;
        }

        // Construye la nueva lista de ids a partir de los features
        // actualmente seleccionados por el Select de OL.
        const nextIds: Array<string | number> = [];
        let primary: string | number | null = null;
        selected.forEach((f) => {
          const id = f.getId();
          if (id !== undefined && id !== null) {
            nextIds.push(id as string | number);
            if (primary === null) primary = id as string | number;
          }
        });

        if (shift && clickedFeature) {
          // Shift+click sobre un feature que ya estaba -> toggle fuera.
          // El Select de OL con multi:false NO acumula por si solo; lo
          // hacemos manualmente leyendo el estado previo de selectionStore.
          const clickedId = clickedFeature.getId();
          if (clickedId !== undefined && clickedId !== null) {
            const prev = useSelectionStore.getState().selectedIds;
            if (prev.has(clickedId)) {
              // ya estaba: lo quitamos
              useSelectionStore.getState().remove(clickedId as string | number);
              // Y como OL solo deja UNO en selected, sincronizamos el resto
              const remaining: Array<string | number> = [];
              prev.forEach((id) => {
                if (id !== clickedId) remaining.push(id as string | number);
              });
              select.getFeatures().clear();
              remaining.forEach((id) => {
                const f = src.getFeatureById(id);
                if (f) select.getFeatures().push(f);
              });
              useSelectionStore.setState({
                primaryId: remaining.length > 0 ? (remaining[0] as string | number) : null,
              });
              refreshLayers();
              return;
            }
            // no estaba: lo agregamos al acumulador
            useSelectionStore.getState().add(clickedId as string | number);
            // OL ya lo puso en selected; no hace falta tocar select.getFeatures()
            useSelectionStore.setState({ primaryId: clickedId as string | number });
            refreshLayers();
            return;
          }
        }

        // click normal: reemplazar la seleccion
        const prev = useSelectionStore.getState().selectedIds;
        prev.forEach((id) => useSelectionStore.getState().remove(id));
        nextIds.forEach((id) => useSelectionStore.getState().add(id));
        useSelectionStore.setState({ primaryId: primary });
        refreshLayers();
      });
    };

    // === Modo SELECT: solo click-to-select (sin edicion implicita) ===
    if (drawMode === 'select' || drawMode === 'edit') {
      const select = new Select({
        layers: hitDetectionLayers,
        style: new Style({
          fill: new Fill({ color: 'rgba(0, 212, 255, 0.15)' }),
          stroke: new Stroke({ color: '#00d4ff', width: 2.5 }),
        }),
        // multi:false -> click normal REEMPLAZA la seleccion (comportamiento
        // CAD). El shift+click se maneja en wireSelectBehavior().
        multi: false,
        condition: (event) => clickCondition(event) && !pointerMove(event),
      });
      wireSelectBehavior(select);
      map.addInteraction(select);
      selectInteractionRef.current = select;
      toClean.push(() => map.removeInteraction(select));
    }

    // === Modo EDIT: Modify + Translate sobre la seleccion actual ===
    // Solo si hay al menos 1 feature seleccionado. Si no hay, Select ya
    // esta activo (de la rama de arriba) y permite elegir uno.
    if (drawMode === 'edit') {
      const sel = selectInteractionRef.current;
      if (sel) {
        const primaryId = useSelectionStore.getState().primaryId;
        const selectedFeatures: Feature<Geometry>[] = [];
        useSelectionStore.getState().selectedIds.forEach((id) => {
          const f = src.getFeatureById(id) as Feature<Geometry> | null;
          if (f) selectedFeatures.push(f);
        });

        // Modify solo si hay un poligono seleccionado (Modify no soporta
        // multi bien; traducimos todo a uno solo si hay varios).
        if (primaryId && selectedFeatures.length > 0) {
          const modify = new Modify({
            features: sel.getFeatures(),
            style: new Style({
              fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
              stroke: new Stroke({ color: '#f59e0b', width: 2 }),
            }),
          });
          modify.on('modifyend', (event) => {
            event.features.forEach((feature) => {
              updateFeatureMetrics(feature as Feature<Geometry>);
            });
            refreshLayers();
            useHistoryStore.getState().pushState(src.getFeatures());
          });
          map.addInteraction(modify);
          toClean.push(() => map.removeInteraction(modify));

          // Translate: arrastra los features seleccionados completos
          if (measurementLayerRef.current) {
            const translate = new SafeTranslate({
              features: sel.getFeatures(),
              hitDetectionLayer: measurementLayerRef.current,
            });
            translate.on('translateend', () => {
              sel.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
              refreshLayers();
              useHistoryStore.getState().pushState(src.getFeatures());
            });
            map.addInteraction(translate);
            toClean.push(() => map.removeInteraction(translate));
          }
        }
      }
    }

    // === Modo POLYLINE: Draw + SnapEngine (imán unificado) ===
    if (drawMode === 'polyline') {
      // El Snap nativo de OL (vertex/edge/midpoint) se quitó: quedaba
      // mal ordenado respecto a Draw y es redundante con SnapEngine,
      // que ya cubre 'endpoint'/'midpoint' (y corrige el click real,
      // no solo el preview) — ver snapInteraction.ts.

      // Dibujo. El `style` se aplica al sketch (linea de rubber-band
      // mientras se dibuja) y a los vertices pendientes: la usamos para
      // que la linea de preview sea segmentada (dashed) y los vertices
      // ya confirmados se vean como circulos semitransparentes (estilo
      // CAD pro).
      // POLYLINE usa Polygon (snap de cierre nativo de OL, iman perfecto).
      const drawType = 'Polygon';
      const draw = new Draw({
        source: src,
        type: drawType,
        style: (feature) => {
          const geom = feature.getGeometry();
          // Para geometrias de tipo "Point" (cada click genera un vertex
          // virtual con geometry Point), dibujamos un punto. Esto
          // ocurre cuando OL crea features intermedias para los
          // vertices pendientes; en la practica, para Polygon/LineString
          // el feature principal es la LineString/Polygon del sketch y
          // los vertices anteriores son parte de sus coordenadas.
          // Estilo 1: linea de rubber-band segmentada.
          // Estilo 2: vertices ya confirmados como circulos
          // semitransparentes (geometry function los extrae).
          // Estilo 3: si el cursor esta cerca del primer vertice,
          // mostramos un cuadrado (snap de cierre).
          const sketchCoords =
            geom instanceof LineString
              ? geom.getCoordinates()
              : geom instanceof Polygon
                ? (geom.getCoordinates()[0] ?? [])
                : [];

          // Vertices confirmados: circulos semitransparentes.
          const confirmedCoords =
            sketchCoords.length > 1 ? sketchCoords.slice(0, -1) : [];
          const vertexStyle =
            confirmedCoords.length > 0
              ? new Style({
                  geometry: new MultiPoint(confirmedCoords as number[][]),
                  image: new CircleStyle({
                    radius: 5,
                    fill: new Fill({ color: 'rgba(0, 212, 255, 0.25)' }),
                    stroke: new Stroke({
                      color: 'rgba(0, 212, 255, 0.95)',
                      width: 1.5,
                    }),
                  }),
                })
              : null;

          // Linea de rubber-band segmentada.
          const lineStyle = new Style({
            stroke: new Stroke({
              color: 'rgba(0, 212, 255, 0.95)',
              width: 2,
              lineDash: [6, 4],
              lineCap: 'round',
            }),
          });

          // Snap de cierre: cuadrado verde cuando el cursor esta cerca
          // del primer vertice (solo en modo polyline). Indica que un
          // click ahi finalizara la polilinea.
          const closeSnapStyle = (() => {
            if (drawMode !== 'polyline') return null;
            if (sketchCoords.length < 3) return null;
            const first = sketchCoords[0];
            const last = sketchCoords[sketchCoords.length - 1];
            if (!first || !last) return null;
            const resolution = map.getView().getResolution() ?? 1;
            const closeRadiusMap = 12 * resolution;
            const dx = first[0] - last[0];
            const dy = first[1] - last[1];
            if (Math.hypot(dx, dy) > closeRadiusMap) return null;
            // Cuadrado (RegularShape points:4, rotation=PI/4) en el
            // primer vertice para indicar "click para finalizar".
            return new Style({
              geometry: new Point(first as number[]),
              image: new RegularShape({
                points: 4,
                radius: 10,
                rotation: Math.PI / 4,
                fill: new Fill({ color: 'rgba(6, 248, 19, 0.95)' }),
                stroke: new Stroke({ color: '#0d1117', width: 2 }),
              }),
            });
          })();

          // Live segment labels — replica exacta de LOTES_SAI render.js:799-868.
          // Segmentos confirmados: azul manzana (#58a6ff). Último segmento
          // (al cursor): naranja (#ffa657). Fuente Courier New 10px.
          const segmentLabels: Style[] = [];
          const skRes = map.getView().getResolution() ?? 1;
          const PX_OFF = 14;
          const totalSegments = sketchCoords.length >= 2 ? sketchCoords.length - 1 : 0;
          if (sketchCoords.length >= 2) {
            for (let i = 0; i < sketchCoords.length - 1; i++) {
              const a = sketchCoords[i];
              const b = sketchCoords[i + 1];
              if (!a || !b) continue;
              const sdx = b[0] - a[0];
              const sdy = b[1] - a[1];
              const segLen = Math.hypot(sdx, sdy);
              if (segLen < 0.3) continue;
              // Longitud geodésica aprox usando haversine
              const aLL = toLonLat(a);
              const bLL = toLonLat(b);
              const R = 6371000;
              const dLat = (bLL[1] - aLL[1]) * Math.PI / 180;
              const dLon = (bLL[0] - aLL[0]) * Math.PI / 180;
              const lat1 = aLL[1] * Math.PI / 180;
              const lat2 = bLL[1] * Math.PI / 180;
              const sinDLat2 = Math.sin(dLat / 2);
              const sinDLon2 = Math.sin(dLon / 2);
              const h = sinDLat2 * sinDLat2 + sinDLon2 * sinDLon2 * Math.cos(lat1) * Math.cos(lat2);
              const liveLen = 2 * R * Math.asin(Math.sqrt(Math.min(h, 1)));
              if (liveLen < 0.3) continue;
              const midX = (a[0] + b[0]) / 2;
              const midY = (a[1] + b[1]) / 2;
              const angle = Math.atan2(sdy, sdx);
              let textAngle = angle;
              if (textAngle > Math.PI / 2 || textAngle < -Math.PI / 2) {
                textAngle += Math.PI;
              }
              const perpLen = PX_OFF * skRes;
              const perpNx = -sdy / segLen;
              const perpNy = sdx / segLen;
              const labelX = midX + perpNx * perpLen;
              const labelY = midY + perpNy * perpLen;

              const isLastSegment = i === totalSegments - 1;
              const label = liveLen >= 100
                ? liveLen.toFixed(1) + ' m'
                : liveLen.toFixed(2) + ' m';

              segmentLabels.push(
                createLiveDrawingLabelStyle(
                  label,
                  [labelX, labelY],
                  textAngle,
                  true,
                  isLastSegment
                )
              );
            }
          }

          return [lineStyle, vertexStyle, closeSnapStyle, ...segmentLabels].filter(
            (s): s is Style => s !== null
          );
        },
      });

// El "imán" del sketch ya NO se hace acá mutando la geometría a
      // mano: SnapEngine (agregado al final de este efecto, después de
      // `draw`) corrige evt.coordinate directamente en pointermove y en
      // el click de confirmación — el sketch de Draw recibe el punto ya
      // correcto sin código extra. Ver src/map/snapInteraction.ts.
      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;

        if (feature.getId() == null) {
          const prefix = 'poly';
          const newId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          feature.setId(newId);
        }
        useDrawStore.getState().setLastDrawnLineId(feature.getId() as string);
        updateFeatureMetrics(feature);
        refreshLayers();
        useHistoryStore.getState().pushState(src.getFeatures());
      });
      activeDrawRef.current = draw;
      map.addInteraction(draw);
      toClean.push(() => {
        map.removeInteraction(draw);
        if (activeDrawRef.current === draw) activeDrawRef.current = null;
      });
    }

    // === Modo STREET: trazado de calles (2 clicks, guarda en streetStore) ===
    if (drawMode === 'street') {
      // Snap nativo removido: SnapEngine (agregado al final de este
      // efecto) ya imanta el click real en este modo.
      const draw = new Draw({
        source: new VectorSource(),
        type: 'LineString',
        maxPoints: 2,
        style: new Style({
          stroke: new Stroke({
            color: 'rgba(255, 166, 87, 0.95)',
            width: 2.5,
            lineDash: [6, 4],
            lineCap: 'round',
          }),
        }),
      });

      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;
        const geom = feature.getGeometry();
        if (!geom || !(geom instanceof LineString)) return;
        const coords = geom.getCoordinates();
        if (coords.length < 2) return;

        const streetStore = useStreetStore.getState();
        streetStore.addStreet({
          start: coords[0] as [number, number],
          end: coords[coords.length - 1] as [number, number],
          widthM: streetStore.defaultWidthM,
        });

        // Forzar re-render de la capa de calles
        streetLayerSrcRef.current?.changed();

        // Recortar polígonos por la nueva calle → generar manzanos
        recomputeManzanos();

        useHistoryStore.getState().pushState(src.getFeatures());
      });

      activeDrawRef.current = draw;
      map.addInteraction(draw);
      toClean.push(() => {
        map.removeInteraction(draw);
        if (activeDrawRef.current === draw) activeDrawRef.current = null;
      });
    }

    // === Modo ERASE: cada click sobre una feature la borra ===
    if (drawMode === 'erase') {
      const select = new Select({
        layers: hitDetectionLayers,
        style: new Style({
          fill: new Fill({ color: 'rgba(239, 68, 68, 0.25)' }),
          stroke: new Stroke({ color: '#ef4444', width: 2 }),
        }),
        multi: true,
        condition: (event) => clickCondition(event) && !pointerMove(event),
      });
      select.on('select', (event) => {
        const selected = (event as any).selected ?? [];
        if (selected.length === 0) return;
        const ids: Array<string | number> = [];
        selected.forEach((f: Feature<Geometry>) => {
          const id = f.getId();
          if (id !== undefined && id !== null) ids.push(id as string | number);
        });
        ids.forEach((id) => useMapStore.getState().deleteFeatureById(id));
        // Limpia la seleccion interna de Select para evitar "fantasmas"
        select.getFeatures().clear();
      });
      map.addInteraction(select);
      selectInteractionRef.current = select;
      toClean.push(() => map.removeInteraction(select));
    }

    // SnapEngine debe quedar SIEMPRE como la última interacción
    // agregada al mapa (OL despacha eventos de la última hacia la
    // primera): así corrige evt.coordinate ANTES que cualquier
    // Draw/Modify/Translate/Select recién (re)creado en este efecto.
    if (snapEngineRef.current) {
      map.removeInteraction(snapEngineRef.current);
      map.addInteraction(snapEngineRef.current);
    }

    return () => {
      toClean.forEach((fn) => fn());
      // Restaurar el cursor del viewport.
      if (previousCursor === null) {
        viewport.removeAttribute('data-cursor');
      } else {
        viewport.setAttribute('data-cursor', previousCursor);
      }
    };
  }, [drawMode]);

  return (
    <div
      ref={mapDivRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--cad-bg-deepest)',
      }}
    />
  );
}
