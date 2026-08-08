Plan: sistema de etiquetado pro (reemplaza el actual, no toca vías)

Reorganicé todo el sistema de "acotaciones y etiquetas" de lotes/manzanas/perímetros/equipamientos en un modelo nuevo: opt-in, por feature, configurable, con un modal profesional y una herramienta de trazado de orden para manzanos. El etiquetado de vías (calles/rotondas) no se toca — vive aparte en StreetPainter.ts/RoundaboutPainter.ts.

🗑️ Qué eliminar (se reemplaza por completo)
Archivo Acción
src/map/scene/painters/LabelPainter.ts Reemplazar entero (nuevo motor de dibujo)
src/map/styleFactory.ts Recortar: fuera drawSegmentLabels, drawMainMetricLabel, drawLotNumberBadge, drawLotAreaCaption, drawLeaderLine, resolveDimensionOrientation, computeLotGroupCounts, computeCotaOpacity, COTA_APPEAR_ZOOM, GEOURBAN_MANZANA_COLOR, LOT_BADGE_*, getApproxScreenArea, DimensionOrientation. Se queda solo createLiveDrawingLabelStyle (la usa PolygonMode.ts, no es parte del sistema de etiquetas final).

Confirmé que nada más en el repo importa esas funciones de styleFactory.ts fuera de LabelPainter.ts — no rompe nada más.

✏️ Qué actualizar (archivos existentes, cambios puntuales)

src/store/map/drawStore.ts, src/map/scene/InteractionModeController.ts, src/core/objectModel.ts, src/components/panels/PropertyPanel.tsx, src/components/panels/ManzanoPanel.tsx, src/App.tsx.

No hace falta tocar: PostrenderPainter.ts (mantuve la misma firma pública de LabelPainter), LayerPanel.tsx (los toggles 👁️🏷️📏 de capa siguen funcionando como interruptor maestro sobre el nuevo sistema), metrics.ts, projectFile.ts (la config nueva viaja dentro de feature.getProperties(), que ya se serializa genérico — persiste solo).

🆕 Archivos nuevos
src/core/labelModel.ts
ts
import type { GeoUrbanFeatureKind } from './objectModel';

export type AreaUnit = 'm2' | 'ha' | 'km2';

export interface LabelStyleConfig {
enabled: boolean;
prefix: string;
showPrefix: boolean;
unit: AreaUnit;
showArea: boolean;
showPerimeter: boolean;
/** Cotas por lado (dimensiones de cada arista, con líneas de extensión). */
showEdgeCotas: boolean;
labelFontSizePx: number;
cotaFontSizePx: number;
color: string;
fontFamily: string;
}

export const LABEL_FONT_OPTIONS: { value: string; label: string }[] = [
{ value: "'JetBrains Mono', monospace", label: 'JetBrains Mono' },
{ value: "'Courier New', monospace", label: 'Courier New' },
{ value: 'Arial, sans-serif', label: 'Arial' },
{ value: 'Georgia, serif', label: 'Georgia' },
{ value: 'Verdana, sans-serif', label: 'Verdana' },
];

export const AREA_UNIT_OPTIONS: { value: AreaUnit; label: string }[] = [
{ value: 'm2', label: 'm²' },
{ value: 'ha', label: 'ha' },
{ value: 'km2', label: 'km²' },
];

export function defaultColorForKind(kind: GeoUrbanFeatureKind | null): string {
switch (kind) {
case 'manzana':
return '#f59e0b';
case 'lote':
return '#38bdf8';
case 'perimetro':
return '#f0f6fc';
case 'equipamiento':
return '#4dd0c4';
default:
return '#dffcff';
}
}

export function defaultLabelStyleConfig(overrides?: Partial<LabelStyleConfig>): LabelStyleConfig {
return {
enabled: true,
prefix: '',
showPrefix: true,
unit: 'm2',
showArea: true,
showPerimeter: false,
showEdgeCotas: false,
labelFontSizePx: 11,
cotaFontSizePx: 10,
color: '#dffcff',
fontFamily: "'JetBrains Mono', monospace",
...overrides,
};
}

export function formatAreaWithUnit(areaM2: number | undefined, unit: AreaUnit): string {
if (!Number.isFinite(areaM2)) return '';
const v = areaM2 ?? 0;
switch (unit) {
case 'ha':
return `${(v / 10000).toFixed(3)} ha`;
case 'km2':
return `${(v / 1_000_000).toFixed(4)} km²`;
default:
return `${v.toFixed(2)} m²`;
}
}
src/store/ui/labelConfigModalStore.ts
ts
import { create } from 'zustand';
import type { LabelStyleConfig } from '../../core/labelModel';

export type LabelNumberingMode = 'numeric' | 'alpha';

interface SingleTarget {
kind: 'single';
featureId: string | number;
}
interface BatchTarget {
kind: 'batch-manzanos';
}

export type LabelConfigTarget = SingleTarget | BatchTarget;

interface LabelConfigModalState {
open: boolean;
target: LabelConfigTarget | null;
initialConfig: LabelStyleConfig | null;
/** Último estilo usado para manzanos — lo lee LabelOrderMode al cerrar el trazado. */
lastManzanoConfig: LabelStyleConfig | null;
numberingMode: LabelNumberingMode;
openForFeature: (featureId: string | number, initial: LabelStyleConfig) => void;
openForManzanoBatch: (initial: LabelStyleConfig) => void;
setNumberingMode: (m: LabelNumberingMode) => void;
setLastManzanoConfig: (cfg: LabelStyleConfig) => void;
close: () => void;
}

export const useLabelConfigModalStore = create<LabelConfigModalState>()((set) => ({
open: false,
target: null,
initialConfig: null,
lastManzanoConfig: null,
numberingMode: 'alpha',
openForFeature: (featureId, initial) =>
set({ open: true, target: { kind: 'single', featureId }, initialConfig: initial }),
openForManzanoBatch: (initial) =>
set({ open: true, target: { kind: 'batch-manzanos' }, initialConfig: initial }),
setNumberingMode: (m) => set({ numberingMode: m }),
setLastManzanoConfig: (cfg) => set({ lastManzanoConfig: cfg }),
close: () => set({ open: false, target: null, initialConfig: null }),
}));
src/commands/labels/ApplyLabelConfigCommand.ts
ts
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import type { LabelStyleConfig } from '../../core/labelModel';

export class ApplyLabelConfigCommand extends Command {
readonly label = 'Configurar etiqueta';
private readonly featureId: string | number;
private readonly next: LabelStyleConfig;
private readonly nextLabelText: string;
private prevConfig: LabelStyleConfig | undefined;
private prevLabelText: string | undefined;

constructor(featureId: string | number, next: LabelStyleConfig, nextLabelText: string) {
super();
this.featureId = featureId;
this.next = next;
this.nextLabelText = nextLabelText;
}

execute(ctx: CommandContext): void {
const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
if (!f) return;
this.prevConfig = f.get('labelConfig') as LabelStyleConfig | undefined;
this.prevLabelText = f.get('labelText') as string | undefined;
f.set('labelConfig', this.next, true);
f.set('labelText', this.nextLabelText, true);
ctx.drawSource.changed();
}

override undo(ctx: CommandContext): void {
const f = ctx.drawSource.getFeatureById(this.featureId) as Feature<Geometry> | null;
if (!f) return;
if (this.prevConfig) f.set('labelConfig', this.prevConfig, true);
else f.unset('labelConfig', true);
if (this.prevLabelText !== undefined) f.set('labelText', this.prevLabelText, true);
else f.unset('labelText', true);
ctx.drawSource.changed();
}

override redo(ctx: CommandContext): void {
this.execute(ctx);
}
}
src/commands/labels/AssignManzanoLabelOrderCommand.ts
ts
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Command, type CommandContext } from '../core/Command';
import type { LabelStyleConfig } from '../../core/labelModel';
import { autoLetterCode } from '../../lib/autoName';
import type { LabelNumberingMode } from '../../store/ui/labelConfigModalStore';

export class AssignManzanoLabelOrderCommand extends Command {
readonly label = 'Etiquetar manzanos en orden';
private readonly orderedIds: Array<string | number>;
private readonly config: LabelStyleConfig;
private readonly numbering: LabelNumberingMode;
private before = new Map<string | number, { config?: LabelStyleConfig; text?: string }>();

constructor(orderedIds: Array<string | number>, config: LabelStyleConfig, numbering: LabelNumberingMode) {
super();
this.orderedIds = orderedIds;
this.config = config;
this.numbering = numbering;
}

execute(ctx: CommandContext): void {
this.before.clear();
this.orderedIds.forEach((id, i) => {
const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
if (!f) return;
this.before.set(id, { config: f.get('labelConfig'), text: f.get('labelText') });
const suffix = this.numbering === 'alpha' ? autoLetterCode(i) : String(i + 1);
f.set('labelConfig', this.config, true);
f.set('labelText', suffix, true);
});
ctx.drawSource.changed();
}

override undo(ctx: CommandContext): void {
for (const [id, prev] of this.before) {
const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
if (!f) continue;
if (prev.config) f.set('labelConfig', prev.config, true);
else f.unset('labelConfig', true);
if (prev.text !== undefined) f.set('labelText', prev.text, true);
else f.unset('labelText', true);
}
ctx.drawSource.changed();
}

override redo(ctx: CommandContext): void {
this.execute(ctx);
}
}
src/map/scene/modes/LabelOrderMode.ts
ts
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
src/map/scene/painters/LabelPainter.ts (reemplazo completo)
ts
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import type { Extent } from 'ol/extent.js';
import type VectorSource from 'ol/source/Vector.js';
import Polygon from 'ol/geom/Polygon.js';
import { getFeatureKind, getLotStatus } from '../../../core/objectModel';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import { formatAreaWithUnit, type LabelStyleConfig } from '../../../core/labelModel';
import { measureCached } from '../../textMeasureCache';
import type { SegmentMetric } from '../../../geo/metrics';

interface PlacedBox {
x: number;
y: number;
w: number;
h: number;
}

const COLLISION_GRID_CELL_PX = 48;
const HARD_VISIBLE_CAP = 20_000;

class LabelCollisionGrid {
private cells = new Map<string, PlacedBox[]>();
private key(cx: number, cy: number): string {
return cx + ',' + cy;
}
private range(box: PlacedBox) {
return {
cx0: Math.floor(box.x / COLLISION_GRID_CELL_PX),
cy0: Math.floor(box.y / COLLISION_GRID_CELL_PX),
cx1: Math.floor((box.x + box.w) / COLLISION_GRID_CELL_PX),
cy1: Math.floor((box.y + box.h) / COLLISION_GRID_CELL_PX),
};
}
intersects(box: PlacedBox): boolean {
const { cx0, cy0, cx1, cy1 } = this.range(box);
for (let cx = cx0; cx <= cx1; cx++) {
for (let cy = cy0; cy <= cy1; cy++) {
const bucket = this.cells.get(this.key(cx, cy));
if (!bucket) continue;
for (const b of bucket) {
if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) {
return true;
}
}
}
}
return false;
}
insert(box: PlacedBox): void {
const { cx0, cy0, cx1, cy1 } = this.range(box);
for (let cx = cx0; cx <= cx1; cx++) {
for (let cy = cy0; cy <= cy1; cy++) {
const key = this.key(cx, cy);
let bucket = this.cells.get(key);
if (!bucket) {
bucket = [];
this.cells.set(key, bucket);
}
bucket.push(box);
}
}
}
clear(): void {
this.cells.clear();
}
}

function buildLabelLines(feature: Feature<Geometry>, cfg: LabelStyleConfig): string[] {
const lines: string[] = [];
const customText = (feature.get('labelText') as string | undefined) ?? '';
const prefixPart = cfg.showPrefix && cfg.prefix ? cfg.prefix : '';
const title = [prefixPart, customText].filter(Boolean).join(' ').trim();
if (title) lines.push(title);

const areaM2 = feature.get('areaM2') as number | undefined;
const perimeterM = feature.get('perimeterM') as number | undefined;
if (cfg.showArea && areaM2 !== undefined) lines.push(formatAreaWithUnit(areaM2, cfg.unit));
if (cfg.showPerimeter && perimeterM !== undefined) lines.push(`Perím. ${perimeterM.toFixed(2)} m`);
return lines;
}

function drawEdgeCotas(
ctx: CanvasRenderingContext2D,
segmentLengths: SegmentMetric[] | undefined,
centroidWorld: [number, number] | undefined,
toPx: (c: number[]) => [number, number],
cfg: LabelStyleConfig
): void {
if (!segmentLengths || segmentLengths.length === 0) return;
const MIN_SEGMENT_PX = 30;
const offsetPx = 13;
const fs = cfg.cotaFontSizePx;
const cenPx = centroidWorld ? toPx(centroidWorld) : null;

ctx.save();
for (const meta of segmentLengths) {
if (!meta || !Number.isFinite(meta.lengthM) || meta.lengthM <= 0) continue;
if (!meta.p0 || !meta.p1) continue;
const aPx = toPx(meta.p0);
const bPx = toPx(meta.p1);
const dxPx = bPx[0] - aPx[0];
const dyPx = bPx[1] - aPx[1];
const lenPx = Math.hypot(dxPx, dyPx);
if (lenPx < MIN_SEGMENT_PX) continue;

    let ang = Math.atan2(dyPx, dxPx);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;

    let nx = -dyPx / lenPx;
    let ny = dxPx / lenPx;
    if (cenPx) {
      const midPx: [number, number] = [(aPx[0] + bPx[0]) / 2, (aPx[1] + bPx[1]) / 2];
      const pointsAway = (midPx[0] - cenPx[0]) * nx + (midPx[1] - cenPx[1]) * ny >= 0;
      if (!pointsAway) {
        nx = -nx;
        ny = -ny;
      }
    }

    const dimA: [number, number] = [aPx[0] + nx * offsetPx, aPx[1] + ny * offsetPx];
    const dimB: [number, number] = [bPx[0] + nx * offsetPx, bPx[1] + ny * offsetPx];

    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(aPx[0] + nx * 3, aPx[1] + ny * 3);
    ctx.lineTo(dimA[0], dimA[1]);
    ctx.moveTo(bPx[0] + nx * 3, bPx[1] + ny * 3);
    ctx.lineTo(dimB[0], dimB[1]);
    ctx.moveTo(dimA[0], dimA[1]);
    ctx.lineTo(dimB[0], dimB[1]);
    ctx.stroke();

    const txC = (dimA[0] + dimB[0]) / 2;
    const tyC = (dimA[1] + dimB[1]) / 2;
    const text = meta.lengthM >= 100 ? meta.lengthM.toFixed(1) + ' m' : meta.lengthM.toFixed(2) + ' m';
    ctx.save();
    ctx.translate(txC, tyC);
    ctx.rotate(ang);
    ctx.font = `500 ${fs}px ${cfg.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(13, 17, 23, 0.85)';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = cfg.color;
    ctx.fillText(text, 0, 0);
    ctx.restore();

}
ctx.restore();
}

/**

- Motor de etiquetas "pro": SOLO dibuja lo que el usuario configuró
- explícitamente por feature (`labelConfig` + `labelText`), vía el modal
- de Generar etiqueta / Etiquetado de manzanos. No hay nada automático.
- El etiquetado de vías (calles/rotondas) vive aparte, en StreetPainter /
- RoundaboutPainter, y no se toca acá.
  */
  export class LabelPainter {
  private readonly collisionGrid = new LabelCollisionGrid();

update(_features: Array<Feature<Geometry>>, _changed: boolean): void {
// no-op — el set de features con etiqueta habilitada suele ser chico,
// no hace falta cachear operaciones de dibujo entre frames.
}

paint(
ctx: CanvasRenderingContext2D,
features: Array<Feature<Geometry>>,
_zoom: number,
_resolution: number,
toPx: (c: number[]) => [number, number],
interacting: boolean,
_extent: Extent | null,
_drawSource: VectorSource
): void {
if (interacting) return;
if (features.length > HARD_VISIBLE_CAP) return;

    this.collisionGrid.clear();
    const registry = useLayersStore.getState();

    for (const feature of features) {
      const cfg = feature.get('labelConfig') as LabelStyleConfig | undefined;
      if (!cfg || !cfg.enabled) continue;

      const kind = getFeatureKind(feature);
      if (kind === 'manzana' && getLotStatus(feature) === 'subdivided') continue;

      const geometry = feature.getGeometry();
      if (!(geometry instanceof Polygon)) continue;

      const layerId = feature.get('layerId') as string | undefined;
      const layer = layerId ? registry.getById(layerId) : undefined;
      if (layer && !layer.visible) continue;

      const labelPoint = feature.get('labelPoint') as [number, number] | undefined;
      if (!labelPoint) continue;

      if (!layer || layer.showLabel !== false) {
        const lines = buildLabelLines(feature, cfg);
        if (lines.length > 0) {
          this.drawLabelBlock(ctx, toPx(labelPoint), lines, cfg);
        }
      }

      if (cfg.showEdgeCotas && (!layer || layer.showCota !== false)) {
        drawEdgeCotas(ctx, feature.get('segmentLengths') as SegmentMetric[] | undefined, labelPoint, toPx, cfg);
      }
    }

}

private drawLabelBlock(
ctx: CanvasRenderingContext2D,
px: [number, number],
lines: string[],
cfg: LabelStyleConfig
): void {
const fs = cfg.labelFontSizePx;
const lineHeight = fs * 1.25;
ctx.save();
ctx.font = `700 ${fs}px ${cfg.fontFamily}`;
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';

    let maxW = 0;
    for (const line of lines) {
      const w = measureCached(ctx, line).width;
      if (w > maxW) maxW = w;
    }
    const totalH = lines.length * lineHeight;
    const box: PlacedBox = {
      x: px[0] - maxW / 2 - 4,
      y: px[1] - totalH / 2 - 2,
      w: maxW + 8,
      h: totalH + 4,
    };
    if (this.collisionGrid.intersects(box)) {
      ctx.restore();
      return;
    }
    this.collisionGrid.insert(box);

    ctx.fillStyle = 'rgba(13, 17, 23, 0.72)';
    ctx.fillRect(box.x, box.y, box.w, box.h);

    ctx.fillStyle = cfg.color;
    let y = px[1] - totalH / 2 + lineHeight / 2;
    for (const line of lines) {
      ctx.fillText(line, px[0], y);
      y += lineHeight;
    }
    ctx.restore();

}
}
src/components/modals/LabelConfigModal.tsx
tsx
import React, { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { useLabelConfigModalStore, type LabelNumberingMode } from '../../store/ui/labelConfigModalStore';
import {
AREA_UNIT_OPTIONS,
LABEL_FONT_OPTIONS,
defaultLabelStyleConfig,
type LabelStyleConfig,
type AreaUnit,
} from '../../core/labelModel';
import { useMapStore } from '../../store/map/mapStore';
import { runCommand } from '../../commands/core/CommandStack';
import { ApplyLabelConfigCommand } from '../../commands/labels/ApplyLabelConfigCommand';
import { useDrawStore } from '../../store/map/drawStore';

export default function LabelConfigModal() {
const open = useLabelConfigModalStore((s) => s.open);
const target = useLabelConfigModalStore((s) => s.target);
const initialConfig = useLabelConfigModalStore((s) => s.initialConfig);
const numberingMode = useLabelConfigModalStore((s) => s.numberingMode);
const setNumberingMode = useLabelConfigModalStore((s) => s.setNumberingMode);
const setLastManzanoConfig = useLabelConfigModalStore((s) => s.setLastManzanoConfig);
const close = useLabelConfigModalStore((s) => s.close);
const drawSource = useMapStore((s) => s.drawSource);

const [cfg, setCfg] = useState<LabelStyleConfig>(defaultLabelStyleConfig());
const [name, setName] = useState('');

useEffect(() => {
if (!open) return;
setCfg(initialConfig ?? defaultLabelStyleConfig());
if (target?.kind === 'single' && drawSource) {
const f = drawSource.getFeatureById(target.featureId);
setName((f?.get('labelText') as string | undefined) ?? '');
} else {
setName('');
}
}, [open, initialConfig, target, drawSource]);

if (!target) return null;
const isBatch = target.kind === 'batch-manzanos';

const patch = (p: Partial<LabelStyleConfig>) => setCfg((c) => ({ ...c, ...p }));

const handleApplyOnly = () => {
if (target.kind === 'single') {
void runCommand(new ApplyLabelConfigCommand(target.featureId, cfg, name));
close();
return;
}
setLastManzanoConfig(cfg);
close();
};

const handleTraceOrder = () => {
setLastManzanoConfig(cfg);
close();
useDrawStore.getState().setMode('labelOrder');
};

return (
<Modal
open={open}
onOpenChange={(o) => { if (!o) close(); }}
title="Configurar etiqueta"
visuallyHiddenTitle
width="min(460px, 92vw)" >
<h2 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--cad-text)', marginBottom: 12 }}>
{isBatch ? 'Etiquetado de manzanos' : 'Generar etiqueta'}
</h2>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
        {!isBatch && (
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Nombre del polígono
            <input value={name} onChange={(e) => setName(e.target.value)} className="cad-input" placeholder="Ej. Lote 12" />
          </label>
        )}

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Prefijo {isBatch ? '(se combina con la letra/número de orden)' : ''}
          <input value={cfg.prefix} onChange={(e) => patch({ prefix: e.target.value })} className="cad-input" placeholder="Ej. Mzo., Lote, L-" />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
          <input type="checkbox" className="cad-toggle" checked={cfg.showPrefix} onChange={(e) => patch({ showPrefix: e.target.checked })} />
          Mostrar prefijo
        </label>

        {isBatch && (
          <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Numeración del trazado
            <select value={numberingMode} onChange={(e) => setNumberingMode(e.target.value as LabelNumberingMode)} className="cad-input">
              <option value="alpha">Alfabética (A, B, C…)</option>
              <option value="numeric">Numérica (1, 2, 3…)</option>
            </select>
          </label>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Unidad de superficie
            <select value={cfg.unit} onChange={(e) => patch({ unit: e.target.value as AreaUnit })} className="cad-input">
              {AREA_UNIT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Fuente
            <select value={cfg.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className="cad-input">
              {LABEL_FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
            <input type="checkbox" className="cad-toggle" checked={cfg.showArea} onChange={(e) => patch({ showArea: e.target.checked })} />
            Mostrar área
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
            <input type="checkbox" className="cad-toggle" checked={cfg.showPerimeter} onChange={(e) => patch({ showPerimeter: e.target.checked })} />
            Mostrar perímetro
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
          <input type="checkbox" className="cad-toggle" checked={cfg.showEdgeCotas} onChange={(e) => patch({ showEdgeCotas: e.target.checked })} />
          Mostrar cotas por lado (dimensión de cada arista)
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Tamaño de etiqueta (px)
            <input type="number" min={7} max={40} value={cfg.labelFontSizePx}
              onChange={(e) => patch({ labelFontSizePx: Math.max(7, parseInt(e.target.value, 10) || cfg.labelFontSizePx) })} className="cad-input" />
          </label>
          <label style={{ flex: 1, fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
            Tamaño de cotas (px)
            <input type="number" min={6} max={30} value={cfg.cotaFontSizePx}
              onChange={(e) => patch({ cotaFontSizePx: Math.max(6, parseInt(e.target.value, 10) || cfg.cotaFontSizePx) })} className="cad-input" />
          </label>
        </div>

        <label style={{ fontSize: '0.72rem', color: 'var(--cad-text-dim)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Color
          <input type="color" value={cfg.color} onChange={(e) => patch({ color: e.target.value })}
            style={{ width: '100%', height: 32, background: 'none', border: '1px solid var(--cad-border)', borderRadius: 4, cursor: 'pointer' }} />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--cad-text)' }}>
          <input type="checkbox" className="cad-toggle" checked={cfg.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
          Etiqueta habilitada (visible en el mapa)
        </label>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
        <button onClick={close} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 12px', fontSize: '0.72rem', color: 'var(--cad-text-dim)', border: '1px solid var(--cad-border)', borderRadius: 6 }}>
          Cancelar
        </button>
        <button onClick={handleApplyOnly} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.72rem', fontWeight: 600, color: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
          {isBatch ? 'Guardar estilo' : 'Aplicar'}
        </button>
        {isBatch && (
          <button onClick={handleTraceOrder} className="cad-icon-btn" style={{ width: 'auto', height: 'auto', padding: '7px 14px', fontSize: '0.72rem', fontWeight: 700, color: '#0d1117', background: 'var(--cad-accent)', border: '1px solid var(--cad-accent)', borderRadius: 6 }}>
            ▶ Trazar orden de etiquetado…
          </button>
        )}
      </div>
    </Modal>

);
}
src/components/panels/manzano/ManzanoLabelingCard.tsx
tsx
import React from 'react';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../../core/labelModel';

export default function ManzanoLabelingCard() {
const openBatch = useLabelConfigModalStore((s) => s.openForManzanoBatch);
const lastConfig = useLabelConfigModalStore((s) => s.lastManzanoConfig);

return (
<div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
<div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
◼ ETIQUETADO DE MANZANOS
</div>
<button
onClick={() => openBatch(lastConfig ?? defaultLabelStyleConfig({ prefix: 'Mzo.', color: defaultColorForKind('manzana') }))}
className="cad-icon-btn"
style={{ width: '100%', height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }} >
🏷 Configurar / Trazar orden…
</button>
</div>
);
}
Cambios puntuales en archivos existentes

src/store/map/drawStore.ts — agregar el modo al union:

ts
export type DrawMode =
| 'select' | 'polygon' | 'line' | 'rectangle' | 'street' | 'roundabout'
| 'erase' | 'edit' | 'labelOrder' | 'none';

src/map/scene/InteractionModeController.ts — importar y wirear:

ts
import { activateLabelOrder } from './modes/LabelOrderMode';
// ...
if (mode === 'polygon' || mode === 'line' || mode === 'rectangle' || mode === 'roundabout' || mode === 'labelOrder') {
viewport.setAttribute('data-cursor', mode);
}
// ...
switch (mode) {
// ...casos existentes...
case 'labelOrder':
activateLabelOrder(modeCtx);
break;
}

src/core/objectModel.ts — tipar los campos nuevos (opcional, solo TS):

ts
import type { LabelStyleConfig } from './labelModel';

export interface BaseFeatureProps {
kind: GeoUrbanFeatureKind;
createdAt: string;
label?: string;
layerId?: string;
labelConfig?: LabelStyleConfig;
labelText?: string;
}

src/components/panels/PropertyPanel.tsx — botón "Generar etiqueta" para cualquier polígono (agregar junto a las acciones rápidas, reemplaza/complementa "Subdividir este polígono"):

tsx
import { useLabelConfigModalStore } from '../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../core/labelModel';
// ...dentro del componente:
const openLabelModal = useLabelConfigModalStore((s) => s.openForFeature);
// ...dentro del bloque "Acciones rapidas", para cualquier isPolygon:
{isPolygon && (
<button
onClick={() => {
const existing = feat.get('labelConfig');
openLabelModal(primaryId, existing ?? defaultLabelStyleConfig({ color: defaultColorForKind(featureKind) }));
}}
className="cad-icon-btn"
style={{ width: '100%', height: 'auto', padding: '6px 10px', fontSize: '0.7rem', fontWeight: 500,
      background: 'var(--cad-bg-surface)', border: '1px solid var(--cad-border)', color: 'var(--cad-text-dim)',
      borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}

>

    🏷 Generar etiqueta

  </button>
)}

src/components/panels/ManzanoPanel.tsx — montar la card nueva:

tsx
import ManzanoLabelingCard from './manzano/ManzanoLabelingCard';
// ...dentro del render, antes de <LotParamsCard .../>:
<ManzanoLabelingCard />

src/App.tsx — montar el modal:

tsx
import LabelConfigModal from './components/modals/LabelConfigModal';
// ...junto a los otros modales:
<LabelConfigModal />
Flujo de uso
Cualquier polígono (perímetro/lote/manzano/equipamiento) → seleccionalo → panel Propiedades → "🏷 Generar etiqueta" → configurás nombre, prefijo, unidad, área/perímetro, cotas por lado, tamaños, color, fuente → Aplicar.
Manzanos en lote: panel Manzanos → "Configurar / Trazar orden…" → ajustás el estilo (mismo modal) → "▶ Trazar orden de etiquetado…" → el modo pasa a labelOrder, trazás una línea pasando cerca de los manzanos en el orden que querés, doble click para terminar → se etiquetan automáticamente en secuencia (alfabética o numérica) con el estilo configurado.
Todo es undo/redo-able (via CommandStack) y persiste solo en el .geourban porque viaja en feature.getProperties().
