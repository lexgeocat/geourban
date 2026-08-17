import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import LineString from 'ol/geom/LineString.js';
import { Command, type CommandContext } from '@kernel/command/Command';
import { updateFeatureMetrics } from '@georef-engine/metrics';
import { newId } from '@kernel/id/id';
import type { Pt } from '@kernel/geometry/polygonEngine';
import { estimateGeometryBytes } from '@kernel/command/memoryEstimate';

export class SplitFeatureCommand extends Command {
  readonly label = 'Dividir elemento';
  private readonly sourceId: string | number;
  private readonly parts: Pt[][];
  private readonly isPolygon: boolean;

  private originalSnapshot: { geometry: Geometry; props: Record<string, unknown> } | null = null;
  private newIds: Array<string | number> = [];

  constructor(sourceId: string | number, parts: Pt[][], isPolygon: boolean) {
    super();
    this.sourceId = sourceId;
    this.parts = parts;
    this.isPolygon = isPolygon;
  }

  execute(ctx: CommandContext): void {
    const source = ctx.drawSource.getFeatureById(this.sourceId) as Feature<Geometry> | null;
    if (!source) return;
    const geom = source.getGeometry();
    if (!geom) return;

    if (!this.originalSnapshot) {
      const props = { ...source.getProperties() };
      delete props.geometry;
      this.originalSnapshot = { geometry: geom.clone(), props };
    }

    ctx.drawSource.removeFeature(source);

    this.newIds = [];
    this.parts.forEach((partPts, idx) => {
      const newGeom: Geometry = this.isPolygon
        ? new Polygon([partPts as number[][]])
        : new LineString(partPts as number[][]);
      const feature = new Feature<Geometry>({ geometry: newGeom });
      const id = newId(`split-${this.sourceId}`);
      feature.setId(id);

      const props = { ...this.originalSnapshot!.props };
      const suffix = String.fromCharCode(65 + idx); // A, B, ...
      if (typeof props.code === 'string') props.code = `${props.code}${suffix}`;
      if (typeof props.label === 'string') props.label = `${props.label} ${suffix}`;
      feature.setProperties(props, true);

      ctx.drawSource.addFeature(feature);
      updateFeatureMetrics(feature);
      this.newIds.push(id);
    });
    ctx.drawSource.changed();
  }

  override undo(ctx: CommandContext): void {
    for (const id of this.newIds) {
      const f = ctx.drawSource.getFeatureById(id);
      if (f) ctx.drawSource.removeFeature(f);
    }
    this.newIds = [];
    if (this.originalSnapshot && ctx.drawSource.getFeatureById(this.sourceId) == null) {
      const restored = new Feature<Geometry>({ geometry: this.originalSnapshot.geometry.clone() });
      restored.setId(this.sourceId);
      restored.setProperties(this.originalSnapshot.props, true);
      ctx.drawSource.addFeature(restored);
      updateFeatureMetrics(restored);
    }
    ctx.drawSource.changed();
  }

  override redo(ctx: CommandContext): void {
    this.execute(ctx);
  }

  override approxMemoryBytes(): number {
    return this.originalSnapshot ? estimateGeometryBytes(this.originalSnapshot.geometry) : 256;
  }
}
