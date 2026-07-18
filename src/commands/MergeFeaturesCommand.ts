import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { Command, type CommandContext } from './Command';
import { useSelectionStore } from '../store/selectionStore';
import { refreshSourceMetrics } from '../geo/metrics';
import { mergePolygonsInWorker } from '../workers/geoWorkerClient';
import type { FeatureCollection } from 'geojson';

const geoJsonFormat = new GeoJSON();

/** Fusiona los features seleccionados vía JSTS union (worker). */
export class MergeFeaturesCommand extends Command {
  readonly label = 'Fusionar selección';
  private readonly selectedIds: Array<string | number>;
  private newId: string | null = null;
  private originals: Array<Feature<Geometry>> = [];
  private originalSelPrimary: string | number | null = null;

  constructor(selectedIds?: Array<string | number>) {
    super();
    this.selectedIds =
      selectedIds ??
      Array.from(useSelectionStore.getState().selectedIds);
  }

  async execute(ctx: CommandContext): Promise<void> {
    this.originals = [];
    for (const id of this.selectedIds) {
      const f = ctx.drawSource.getFeatureById(id) as Feature<Geometry> | null;
      if (f) this.originals.push(f);
    }
    if (this.originals.length < 2) return;

    this.originalSelPrimary = useSelectionStore.getState().primaryId;

    const collection: FeatureCollection = {
      type: 'FeatureCollection',
      features: this.originals.map((f) =>
        geoJsonFormat.writeFeatureObject(f, {
          featureProjection: 'EPSG:3857',
          dataProjection: 'EPSG:3857',
        }),
      ),
    };

    const merged = await mergePolygonsInWorker(collection);
    if (!merged.features.length) {
      this.originals = [];
      return;
    }
    const olFeats = geoJsonFormat.readFeatures(merged, {
      featureProjection: 'EPSG:3857',
      dataProjection: 'EPSG:3857',
    }) as Feature<Geometry>[];
    if (olFeats.length === 0) {
      this.originals = [];
      return;
    }
    const target = olFeats[0];
    if (target.getGeometry()?.getType() === 'MultiPolygon') {
      // No contiguos: como antes, se considera fallo.
      this.originals = [];
      return;
    }

    this.newId = `merged-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    target.setId(this.newId);
    target.set('mergedFrom', this.selectedIds);
    target.set('mergedAt', new Date().toISOString());

    for (const f of this.originals) ctx.drawSource.removeFeature(f);
    useSelectionStore.getState().clear();
    ctx.drawSource.addFeature(target);
    refreshSourceMetrics(ctx.drawSource);
    ctx.drawSource.changed();

    if (this.newId) {
      useSelectionStore.getState().setSelection([this.newId], this.newId);
    }
  }

  override undo(ctx: CommandContext): void {
    if (this.newId) {
      const f = ctx.drawSource.getFeatureById(this.newId);
      if (f) ctx.drawSource.removeFeature(f);
    }
    for (const f of this.originals) {
      const id = f.getId();
      if (id != null && ctx.drawSource.getFeatureById(id) == null) {
        ctx.drawSource.addFeature(f);
      }
    }
    ctx.drawSource.changed();
    refreshSourceMetrics(ctx.drawSource);
    useSelectionStore.getState().clear();
    if (this.originalSelPrimary != null) {
      useSelectionStore
        .getState()
        .setSelection([this.originalSelPrimary], this.originalSelPrimary);
    }
  }
}
