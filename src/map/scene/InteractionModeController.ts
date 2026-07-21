import type Map from 'ol/Map.js';
import VectorSource from 'ol/source/Vector.js';
import type VectorLayer from 'ol/layer/Vector.js';
import type WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Select from 'ol/interaction/Select.js';
import SafeTranslate from '../safeTranslate';
import { toLonLat } from 'ol/proj.js';
import { Fill, Stroke, Style, Circle as CircleStyle } from 'ol/style.js';
import Feature from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import Polygon from 'ol/geom/Polygon.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import type Geometry from 'ol/geom/Geometry.js';
import { createBox } from 'ol/interaction/Draw.js';
import { click as clickCondition, pointerMove } from 'ol/events/condition.js';
import { intersects as extentIntersects } from 'ol/extent.js';
import type { DrawMode } from '../../store/drawStore';
import { useDrawStore } from '../../store/drawStore';
import { useSelectionStore } from '../../store/selectionStore';
import { useStreetStore } from '../../store/streetStore';
import { runCommand } from '../../commands/CommandStack';
import { AddFeatureCommand } from '../../commands/AddFeatureCommand';
import { ModifyGeometryCommand } from '../../commands/ModifyGeometryCommand';
import { AddStreetCommand } from '../../commands/AddStreetCommand';
import { updateFeatureMetrics } from '../../geo/metrics';
import { createLiveDrawingLabelStyle } from '../styleFactory';
import { LassoSelection, type LassoMode } from './LassoSelection';
import { useLayersStore } from '../../store/layersRegistryStore';
import { useRoundaboutStore } from '../../store/roundaboutStore';
import { AddRoundaboutCommand } from '../../commands/AddRoundaboutCommand';
import { DeleteFeaturesCommand } from '../../commands/DeleteFeaturesCommand';
import { RoundaboutDrawInteraction } from './RoundaboutDrawInteraction';
import { pointInPoly } from '../../geo/polygonEngine';
import type { PostrenderPainter } from './PostrenderPainter';
export interface InteractionContext {
  map: Map;
  drawSource: VectorSource;
  measurementLayer: VectorLayer<VectorSource>;
  drawLayer: WebGLVectorLayer;
  streetLayer: VectorLayer<VectorSource>;
  streetSource: VectorSource;
  postrenderPainter?: PostrenderPainter;
}

export class InteractionModeController {
  private ctx: InteractionContext;
  private selectInteraction: Select | null = null;
  private toClean: (() => void)[] = [];

  /** Ref mutable para que SnapEngine (creado fuera) lea el Draw activo. */
  readonly activeDrawRef: { current: Draw | null } = { current: null };

  constructor(ctx: InteractionContext) {
    this.ctx = ctx;
  }

  activate(mode: DrawMode): void {
    const { map, drawSource: src, measurementLayer, drawLayer } = this.ctx;

    if (!map || !src) return;

    this.cleanup();

    const viewport = map.getViewport();
    const previousCursor = viewport.getAttribute('data-cursor');

// Cursor crosshair en modos de dibujo
  if (
    mode === 'polygon' || mode === 'line' ||
    mode === 'rectangle' || mode === 'roundabout'
  ) {
      viewport.setAttribute('data-cursor', mode);
    } else {
      viewport.removeAttribute('data-cursor');
    }

    // Limpia interacción Select previa
    if (this.selectInteraction) {
      map.removeInteraction(this.selectInteraction);
      this.selectInteraction = null;
    }

    const refreshLayers = () => {
      measurementLayer?.changed();
      drawLayer?.changed();
    };

    const hitDetectionLayers = measurementLayer ? [measurementLayer] : [];

    const wireSelectBehavior = (select: Select) => {
      select.on('select', (evt) => {
        const oe = (evt as any).originalEvent as MouseEvent | undefined;
        const shift = !!oe?.shiftKey;
        const selected = select.getFeatures().getArray();
        const clickedFeature =
          ((evt as any).selected?.[0] as Feature<Geometry> | undefined) ??
          (selected[selected.length - 1] as Feature<Geometry> | undefined);

        if (selected.length === 0) {
          useSelectionStore.getState().clear();
          refreshLayers();
          return;
        }

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
          const clickedId = clickedFeature.getId();
          if (clickedId !== undefined && clickedId !== null) {
            const prev = useSelectionStore.getState().selectedIds;
            if (prev.has(clickedId)) {
              useSelectionStore.getState().remove(clickedId as string | number);
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
            useSelectionStore.getState().add(clickedId as string | number);
            useSelectionStore.setState({ primaryId: clickedId as string | number });
            refreshLayers();
            return;
          }
        }

        const prev = useSelectionStore.getState().selectedIds;
        prev.forEach((id) => useSelectionStore.getState().remove(id));
        nextIds.forEach((id) => useSelectionStore.getState().add(id));
        useSelectionStore.setState({ primaryId: primary });
        refreshLayers();
      });
    };

    // === Modo SELECT / EDIT ===
    if (mode === 'select' || mode === 'edit') {
      const isLayerLocked = (f: Feature<Geometry>): boolean => {
        const layerId = f.get('layerId') as string | undefined;
        if (!layerId) return false;
        const layer = useLayersStore.getState().getById(layerId);
        return !!layer?.locked;
      };

      const select = new Select({
        layers: hitDetectionLayers,
        style: new Style({
          fill: new Fill({ color: 'rgba(0, 212, 255, 0.15)' }),
          stroke: new Stroke({ color: '#00d4ff', width: 2.5 }),
        }),
        multi: false,
        condition: (event) => clickCondition(event) && !pointerMove(event),
        filter: (feature) => !isLayerLocked(feature as Feature<Geometry>),
      });
      wireSelectBehavior(select);
      map.addInteraction(select);
      this.selectInteraction = select;
      this.toClean.push(() => map.removeInteraction(select));

      const subMode = useSelectionStore.getState().selectMode;
      if (subMode === 'rect' || subMode === 'lasso') {
        const lassoMode: LassoMode = subMode;
        const lasso = new LassoSelection({
          map,
          mode: lassoMode,
          onComplete: (result) => {
            // Limpia preview
            this.ctx.postrenderPainter?.setLassoPreview(null);
            // Calcula candidatos
            const allFeatures = src.getFeatures();
            const candidates: Array<Feature<Geometry>> = [];
            for (const f of allFeatures) {
              const id = f.getId();
              if (id == null) continue;
              const layerId = f.get('layerId') as string | undefined;
              if (layerId) {
                const layer = useLayersStore.getState().getById(layerId);
                if (layer?.locked) continue;
              }
              const g = f.getGeometry();
              if (!g) continue;
              if (result.kind === 'rect') {
                const ext = g.getExtent();
                if (extentIntersects(ext, result.extent)) candidates.push(f as Feature<Geometry>);
              } else {
                const poly = result.polygon as [number, number][];
                // Compute lasso extent for pre-filter
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                for (const p of poly) {
                  if (p[0] < minX) minX = p[0];
                  if (p[1] < minY) minY = p[1];
                  if (p[0] > maxX) maxX = p[0];
                  if (p[1] > maxY) maxY = p[1];
                }
                const ext = g.getExtent();
                if (!extentIntersects(ext, [minX, minY, maxX, maxY])) continue;
                // Walk vértices, point-in-poly
                let inside = false;
                const coords = (g as any).getCoordinates();
                const walk = (arr: unknown) => {
                  if (inside) return;
                  if (Array.isArray(arr) && typeof arr[0] === 'number') {
                    const x = arr[0] as number;
                    const y = arr[1] as number;
                    if (pointInPoly(x, y, poly)) inside = true;
                    return;
                  }
                  if (Array.isArray(arr)) for (const c of arr) walk(c);
                };
                walk(coords);
                if (inside) candidates.push(f as Feature<Geometry>);
              }
            }

            const ids = candidates
              .map((f) => f.getId())
              .filter((id): id is string | number => id != null);
            useSelectionStore.getState().setSelection(ids, ids[0] ?? null);
            refreshLayers();
          },
          onCancel: () => {
            this.ctx.postrenderPainter?.setLassoPreview(null);
            map.render();
          },
        });
        map.addInteraction(lasso);
        this.toClean.push(() => {
          map.removeInteraction(lasso);
          this.ctx.postrenderPainter?.setLassoPreview(null);
        });
        const onRender = () => {
          this.ctx.postrenderPainter?.setLassoPreview(lasso.getPreview());
        };
        map.on('postrender', onRender);
        this.toClean.push(() => map.un('postrender', onRender));
      }
    }

    // === Modo EDIT: Modify + Translate ===
    if (mode === 'edit') {
      const sel = this.selectInteraction;
      if (sel) {
        const primaryId = useSelectionStore.getState().primaryId;
        const selectedFeatures: Feature<Geometry>[] = [];
        useSelectionStore.getState().selectedIds.forEach((id) => {
          const f = src.getFeatureById(id) as Feature<Geometry> | null;
          if (f) selectedFeatures.push(f);
        });

        if (primaryId && selectedFeatures.length > 0) {
          const modify = new Modify({
            features: sel.getFeatures(),
            style: new Style({
              fill: new Fill({ color: 'rgba(245, 158, 11, 0.2)' }),
              stroke: new Stroke({ color: '#f59e0b', width: 2 }),
            }),
          });
          let pendingModify: ModifyGeometryCommand | null = null;
          modify.on('modifystart', (event) => {
            const targets = event.features.getArray().filter(
              (f) => f.getId() != null,
            );
            pendingModify = new ModifyGeometryCommand(targets, 'Editar vértices');
            pendingModify.captureBefore();
          });
          modify.on('modifyend', () => {
            if (pendingModify) {
              void runCommand(pendingModify);
              pendingModify = null;
            } else {
          // No debería ocurrir (modifystart siempre precede a modifyend en
          // OL), pero si pasa, igual pasa por el Command Stack: sin
          // "before" real el undo de este paso puntual no será exacto,
          // pero evita que canUndo/canRedo queden desincronizados con lo
          // que realmente hay en drawSource.
          console.warn('Modify: modifyend sin modifystart previo — undo no será exacto para este cambio.');
          const fallbackTargets = sel.getFeatures().getArray().filter(
            (f) => f.getId() != null,
          ) as Feature<Geometry>[];
          if (fallbackTargets.length > 0) {
            const fallbackCmd = new ModifyGeometryCommand(fallbackTargets, 'Editar vértices');
            fallbackCmd.captureBefore();
            void runCommand(fallbackCmd);
          } else {
            sel.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
            refreshLayers();
          }
            }
          });
          map.addInteraction(modify);
          this.toClean.push(() => map.removeInteraction(modify));

          if (measurementLayer) {
            const translate = new SafeTranslate({
              features: sel.getFeatures(),
              hitDetectionLayer: measurementLayer,
            });
            let pendingTranslate: ModifyGeometryCommand | null = null;
            translate.on('translatestart' as any, (event: any) => {
              const feats =
                (event.features as Array<Feature<Geometry>> | undefined) ??
                sel.getFeatures().getArray();
              pendingTranslate = new ModifyGeometryCommand(feats, 'Mover');
              pendingTranslate.captureBefore();
            });
            translate.on('translateend', () => {
              if (pendingTranslate) {
                void runCommand(pendingTranslate);
                pendingTranslate = null;
              } else {
                console.warn('Translate: translateend sin translatestart previo — undo no será exacto para este cambio.');
                const fallbackTargets = sel.getFeatures().getArray().filter(
                  (f) => f.getId() != null,
                ) as Feature<Geometry>[];
               if (fallbackTargets.length > 0) {
                  const fallbackCmd = new ModifyGeometryCommand(fallbackTargets, 'Mover');
                  fallbackCmd.captureBefore();
                  void runCommand(fallbackCmd);
                } else {
                  sel.getFeatures().forEach((f) => updateFeatureMetrics(f as Feature<Geometry>));
                  refreshLayers();
                }
              }
            });
            map.addInteraction(translate);
            this.toClean.push(() => map.removeInteraction(translate));
          }
        }
      }
    }

    // === Modo POLYGON ===
    if (mode === 'polygon') {
      const draw = new Draw({
        source: src,
        type: 'Polygon',
        style: (feature) => {
          const geom = feature.getGeometry();
          const sketchCoords =
            geom instanceof LineString
              ? geom.getCoordinates()
              : geom instanceof Polygon
                ? (geom.getCoordinates()[0] ?? [])
                : [];

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

          const lineStyle = new Style({
            stroke: new Stroke({
              color: 'rgba(0, 212, 255, 0.95)',
              width: 2,
              lineDash: [6, 4],
              lineCap: 'round',
            }),
          });

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

          return [lineStyle, vertexStyle, ...segmentLabels].filter(
            (s): s is Style => s !== null
          );
        },
      });

      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;
        const areaKind = useDrawStore.getState().areaKind;
        void runCommand(
          new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar polígono', kind: areaKind }),
        );
        updateFeatureMetrics(feature);
        refreshLayers();
      });
      this.activeDrawRef.current = draw;
      map.addInteraction(draw);
      this.toClean.push(() => {
        map.removeInteraction(draw);
        if (this.activeDrawRef.current === draw) this.activeDrawRef.current = null;
      });
    }

    // === Modo LINE ===
    if (mode === 'line') {
      const draw = new Draw({
        source: src,
        type: 'LineString',
        style: new Style({
          stroke: new Stroke({
            color: 'rgba(0, 212, 255, 0.95)',
            width: 2,
            lineDash: [6, 4],
            lineCap: 'round',
          }),
        }),
      });
      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;
        void runCommand(
          new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar línea' }),
        );
        useDrawStore.getState().setLastDrawnLineId(feature.getId() as string);
        updateFeatureMetrics(feature);
        refreshLayers();
      });
      this.activeDrawRef.current = draw;
      map.addInteraction(draw);
      this.toClean.push(() => {
        map.removeInteraction(draw);
        if (this.activeDrawRef.current === draw) this.activeDrawRef.current = null;
      });
    }

    // === Modo RECTANGLE ===
    if (mode === 'rectangle') {
      const draw = new Draw({
        source: src,
        type: 'Circle',
        geometryFunction: createBox(),
        style: new Style({
          stroke: new Stroke({ color: 'rgba(0, 212, 255, 0.95)', width: 2, lineDash: [6, 4] }),
          fill: new Fill({ color: 'rgba(0, 212, 255, 0.10)' }),
        }),
      });
      draw.on('drawend', (event) => {
        const feature = event.feature as Feature<Geometry>;
        const areaKind = useDrawStore.getState().areaKind;
        void runCommand(
          new AddFeatureCommand(feature, { mode: 'claim', label: 'Dibujar rectángulo', kind: areaKind }),
        );
        updateFeatureMetrics(feature);
        refreshLayers();
      });
      this.activeDrawRef.current = draw;
      map.addInteraction(draw);
      this.toClean.push(() => {
        map.removeInteraction(draw);
        if (this.activeDrawRef.current === draw) this.activeDrawRef.current = null;
      });
    }

    // === Modo STREET ===
    if (mode === 'street') {
      const draw = new Draw({
        source: this.ctx.streetSource,
        type: 'LineString',
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
        const start = coords[0] as [number, number];
        const end = coords[coords.length - 1] as [number, number];
        const waypoints = coords.length > 2
          ? (coords.slice(1, -1) as Array<[number, number]>)
          : undefined;
        void runCommand(
          new AddStreetCommand(start, end, streetStore.defaultWidthM, waypoints, streetStore.defaultSideWidthM),
        );

        this.ctx.streetSource?.changed();
      });

      this.activeDrawRef.current = draw;
      map.addInteraction(draw);
      this.toClean.push(() => {
        map.removeInteraction(draw);
        if (this.activeDrawRef.current === draw) this.activeDrawRef.current = null;
      });
    }

// === Modo ROUNDABOUT: 2 clics (centro → radio) ===
if (mode === 'roundabout') {
  const draw = new RoundaboutDrawInteraction({
    map,
    onComplete: (center, radiusM) => {
      const rb = useRoundaboutStore.getState();
      void runCommand(
        new AddRoundaboutCommand({
          center: center as [number, number],
          radiusM,
          sides: rb.defaultSides,
          rotation: 0,
          roadWidthM: rb.defaultRoadWidthM,
          sidewalkWidthM: rb.defaultSidewalkWidthM,
        }),
      );
      map.render();
    },
    onCancel: () => map.render(),
  });
  map.addInteraction(draw);
  this.toClean.push(() => map.removeInteraction(draw));
  const onRoundaboutPreview = () => {
    this.ctx.postrenderPainter?.setRoundaboutPreview(draw.getPreview());
  };
  map.on('postrender', onRoundaboutPreview);
  this.toClean.push(() => map.un('postrender', onRoundaboutPreview));
}

// === Modo ERASE ===
if (mode === 'erase') {
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
          if (id === undefined || id === null) return;
          const layerId = f.get('layerId') as string | undefined;
          if (layerId) {
            const layer = useLayersStore.getState().getById(layerId);
            if (layer?.locked) return;
          }
          ids.push(id as string | number);
        });
        if (ids.length > 0) {
          void runCommand(new DeleteFeaturesCommand(ids));
        }
        select.getFeatures().clear();
      });
      map.addInteraction(select);
      this.selectInteraction = select;
      this.toClean.push(() => map.removeInteraction(select));
    }

    // Guarda cleanup + cursor para restore
    const cursorCleanup = () => {
      if (previousCursor === null) {
        viewport.removeAttribute('data-cursor');
      } else {
        viewport.setAttribute('data-cursor', previousCursor);
      }
    };
    this.toClean.push(cursorCleanup);
  }

  getActiveDraw(): Draw | null {
    return this.activeDrawRef.current;
  }

  private cleanup(): void {
    this.toClean.forEach((fn) => fn());
    this.toClean = [];
  }

  dispose(): void {
    this.cleanup();
    if (this.selectInteraction) {
      this.ctx.map.removeInteraction(this.selectInteraction);
      this.selectInteraction = null;
    }
    this.activeDrawRef.current = null;
  }
}
