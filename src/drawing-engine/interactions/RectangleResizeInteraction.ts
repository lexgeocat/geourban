import Interaction from 'ol/interaction/Interaction.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type Map from 'ol/Map.js';
import type Collection from 'ol/Collection.js';
import type VectorSource from 'ol/source/Vector.js';
import VectorSourceLayerOnly from 'ol/source/Vector.js';
import VectorLayer from 'ol/layer/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import Polygon from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { Style, Fill, Stroke, Circle as CircleStyle, RegularShape } from 'ol/style.js';
import { runCommand } from '@kernel/command/CommandStack';
import { ModifyGeometryCommand } from '../commands/ModifyGeometryCommand';

type Pt = [number, number];

interface HandleRef {
  feature: Feature<Geometry>;
  kind: 'corner' | 'edge';
  index: number; // corner: 0-3 · edge: 0-3 (edge i va entre corner i y corner i+1)
}

const HIT_TOLERANCE_PX = 10;
const MIN_SIZE_MAP_UNITS = 0.05;

function ringCorners(geom: Polygon): Pt[] | null {
  const ring = geom.getCoordinates()[0];
  if (!ring || ring.length < 4) return null;
  const pts = ring.slice(0, 4).map((c) => [c[0], c[1]] as Pt);
  return pts.length === 4 ? pts : null;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const normalize = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

export class RectangleResizeInteraction extends Interaction {
  private readonly hostMap: Map;
  private readonly source: Collection<Feature<Geometry>>;
  private readonly isEligible: (f: Feature<Geometry>) => boolean;
  private readonly drawSource?: VectorSource;

  private readonly tempSource = new VectorSourceLayerOnly();
  private readonly tempLayer: VectorLayer<VectorSource>;

  private dragging: {
    feature: Feature<Geometry>;
    handle: HandleRef;
    anchor: Pt;
    uAxis: Pt;
    vAxis: Pt;
    startCorners: Pt[];
    pending: ModifyGeometryCommand;
  } | null = null;

  constructor(
    map: Map,
    source: Collection<Feature<Geometry>>,
    isEligible: (f: Feature<Geometry>) => boolean,
    drawSource?: VectorSource
  ) {
    super({ handleEvent: (evt) => this.handleEvent_(evt as MapBrowserEvent) });
    this.hostMap = map;
    this.source = source;
    this.isEligible = isEligible;
    this.drawSource = drawSource;
    this.tempLayer = new VectorLayer({
      source: this.tempSource,
      zIndex: 999,
      style: (f) => {
        const role = f.get('role') as string;
        if (role === 'corner') {
          return new Style({
            image: new RegularShape({
              points: 4,
              radius: 7,
              angle: Math.PI / 4,
              fill: new Fill({ color: '#f59e0b' }),
              stroke: new Stroke({ color: '#0d1117', width: 1.5 }),
            }),
          });
        }
        return new Style({
          image: new CircleStyle({
            radius: 5,
            fill: new Fill({ color: '#f59e0b' }),
            stroke: new Stroke({ color: '#0d1117', width: 1.5 }),
          }),
        });
      },
    });
  }

  install(): () => void {
    this.hostMap.addLayer(this.tempLayer);
    this.refreshHandles();

    const onSelectionChange = () => this.refreshHandles();
    this.source.on('add', onSelectionChange);
    this.source.on('remove', onSelectionChange);

    const onFeatureChange = () => this.refreshHandles();
    this.drawSource?.on('changefeature', onFeatureChange);

    return () => {
      this.source.un('add', onSelectionChange);
      this.source.un('remove', onSelectionChange);
      this.drawSource?.un('changefeature', onFeatureChange);
      this.hostMap.removeLayer(this.tempLayer);
      this.tempSource.clear();
    };
  }

  private eligibleFeatures(): Feature<Geometry>[] {
    return this.source.getArray().filter(this.isEligible);
  }

  private refreshHandles(): void {
    this.tempSource.clear();
    for (const feat of this.eligibleFeatures()) {
      const geom = feat.getGeometry();
      if (!(geom instanceof Polygon)) continue;
      const corners = ringCorners(geom);
      if (!corners) continue;

      corners.forEach((c, i) => {
        const hf = new Feature({ geometry: new Point(c) });
        hf.set('role', 'corner');
        hf.set('ownerId', feat.getId());
        hf.set('handleIndex', i);
        this.tempSource.addFeature(hf);
      });
      for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const hf = new Feature({ geometry: new Point(mid) });
        hf.set('role', 'edge');
        hf.set('ownerId', feat.getId());
        hf.set('handleIndex', i);
        this.tempSource.addFeature(hf);
      }
    }
    this.hostMap.render();
  }

  private findHandleNear(pixel: number[]): HandleRef | null {
    let bestFeature: Feature<Geometry> | null = null;
    let bestDistance = Infinity;
    for (const hf of this.tempSource.getFeatures()) {
      const geom = hf.getGeometry();
      if (!(geom instanceof Point)) continue;
      const px = this.hostMap.getPixelFromCoordinate(geom.getCoordinates());
      if (!px) continue;
      const d = Math.hypot(px[0] - pixel[0], px[1] - pixel[1]);
      if (d <= HIT_TOLERANCE_PX && d < bestDistance) {
        bestDistance = d;
        bestFeature = hf;
      }
    }
    if (!bestFeature) return null;
    const handle = bestFeature as Feature<Geometry>;
    const ownerId = handle.get('ownerId');
    const owner = this.eligibleFeatures().find((f) => f.getId() === ownerId);
    if (!owner) return null;
    const kind = handle.get('role');
    const index = handle.get('handleIndex');
    if (kind !== 'corner' && kind !== 'edge') return null;
    if (typeof index !== 'number') return null;
    return { feature: owner, kind, index };
  }

  private handleEvent_(evt: MapBrowserEvent): boolean {
    const type = evt.type;

    if (type === 'pointerdown') {
      if (evt.originalEvent instanceof MouseEvent && evt.originalEvent.button !== 0) return true;
      const handle = this.findHandleNear(evt.pixel);
      if (!handle) return true;
      const geom = handle.feature.getGeometry();
      if (!(geom instanceof Polygon)) return true;
      const corners = ringCorners(geom);
      if (!corners) return true;

      let anchor: Pt, uAxis: Pt, vAxis: Pt;
      if (handle.kind === 'corner') {
        const oppIdx = (handle.index + 2) % 4;
        anchor = corners[oppIdx];
        uAxis = normalize(sub(corners[(handle.index + 1) % 4], anchor));
        vAxis = normalize(sub(corners[(handle.index + 3) % 4], anchor));
      } else {
        const oppEdgeIdx = (handle.index + 2) % 4;
        const oc1 = corners[oppEdgeIdx];
        const oc2 = corners[(oppEdgeIdx + 1) % 4];
        anchor = [(oc1[0] + oc2[0]) / 2, (oc1[1] + oc2[1]) / 2];
        const c1 = corners[handle.index];
        const c2 = corners[(handle.index + 1) % 4];
        uAxis = normalize(sub(c2, c1));
        const draggedMid: Pt = [(c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2];
        vAxis = normalize(sub(draggedMid, anchor));
      }

      const pending = new ModifyGeometryCommand([handle.feature], 'Redimensionar rectángulo');
      pending.captureBefore();

      this.dragging = {
        feature: handle.feature,
        handle,
        anchor,
        uAxis,
        vAxis,
        startCorners: corners,
        pending,
      };
      this.hostMap.getViewport().style.cursor = 'move';
      return false;
    }

    if (type === 'pointermove' && this.dragging) {
      const { feature, handle, anchor, uAxis, vAxis, startCorners } = this.dragging;
      const rel = sub(evt.coordinate as Pt, anchor);

      let newCorners: Pt[];
      if (handle.kind === 'corner') {
        let lu = dot(rel, uAxis);
        let lv = dot(rel, vAxis);
        if (Math.abs(lu) < MIN_SIZE_MAP_UNITS) lu = Math.sign(lu || 1) * MIN_SIZE_MAP_UNITS;
        if (Math.abs(lv) < MIN_SIZE_MAP_UNITS) lv = Math.sign(lv || 1) * MIN_SIZE_MAP_UNITS;
        newCorners = [...startCorners];
        newCorners[handle.index] = add(anchor, add(scale(uAxis, lu), scale(vAxis, lv)));
        newCorners[(handle.index + 1) % 4] = add(anchor, scale(uAxis, lu));
        newCorners[(handle.index + 3) % 4] = add(anchor, scale(vAxis, lv));
        newCorners[(handle.index + 2) % 4] = anchor;
      } else {
        let lv = dot(rel, vAxis);
        if (Math.abs(lv) < MIN_SIZE_MAP_UNITS) lv = Math.sign(lv || 1) * MIN_SIZE_MAP_UNITS;
        const c1 = startCorners[handle.index];
        const c2 = startCorners[(handle.index + 1) % 4];
        const half = scale(uAxis, len(sub(c2, c1)) / 2);
        const newMid = add(anchor, scale(vAxis, lv));
        newCorners = [...startCorners];
        newCorners[handle.index] = sub(newMid, half);
        newCorners[(handle.index + 1) % 4] = add(newMid, half);
      }

      feature.setGeometry(new Polygon([[...newCorners, newCorners[0]] as number[][]]));
      this.refreshHandles();
      return false;
    }

    if (type === 'pointerup' && this.dragging) {
      const { pending } = this.dragging;
      this.dragging = null;
      this.hostMap.getViewport().style.cursor = '';
      void runCommand(pending);
      this.refreshHandles();
      return false;
    }

    if (type === 'pointercancel' && this.dragging) {
      this.dragging = null;
      this.hostMap.getViewport().style.cursor = '';
      this.refreshHandles();
      return false;
    }

    return true;
  }
}
