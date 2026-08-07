import { useCallback, useState } from 'react';
import type Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import type VectorSource from 'ol/source/Vector.js';
import { useManzanoStore, type ManzanoLoteMethod } from '../store/entities/manzanoStore';
import { useCommandStack } from '../commands/core/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/lots/RecomputeManzanoLotsCommand';
import { centroid, type Pt } from '../geo/math/polygonEngine';
import { getFeatureKind, ensureKind, setLotStatus } from '../core/objectModel';
import { useSubdivisionPreviewStore } from '../store/ui/subdivisionPreviewStore';
import { subdivideManzanoInWorker } from '../workers/geoWorkerClient';
import type { ManzanoRow } from '../geo/selectors/manzanoRows';
import { requireLayerForKind } from '../store/ui/layerPickerStore';
import { useLotsWorkflow } from './useLotsWorkflow';

export function useManzanoActions(drawSource: VectorSource | null) {
  const targetAreaM2 = useManzanoStore((s) => s.targetAreaM2);
  const frontMinM = useManzanoStore((s) => s.frontMinM);
  const getMethod = useManzanoStore((s) => s.getMethod);
  const setMethod = useManzanoStore((s) => s.setMethod);
  const getRotateDir = useManzanoStore((s) => s.getRotateDir);
  const setRotateDir = useManzanoStore((s) => s.setRotateDir);
  const startRotateLots = useManzanoStore((s) => s.startRotateLots);

  // Fuente única para "generar todos los lotes" — compartida con el TopBar.
  const { lotsBusy, runGenerateAllLots, cancelGenerateAllLots } = useLotsWorkflow();
  const [recomputingIds, setRecomputingIds] = useState<Set<string>>(new Set());

  const runRecompute = useCallback(
    async (row: ManzanoRow) => {
      const layerId = await requireLayerForKind('lote');
      if (!layerId) return;
      const key = String(row.id);
      setRecomputingIds((s) => new Set(s).add(key));
      useSubdivisionPreviewStore.getState().clear();
      try {
        const method = getMethod(row.id);
        const dirPref = getRotateDir(row.id);
        await useCommandStack.getState().run(
          new RecomputeManzanoLotsCommand({ manzanoId: row.id, targetAreaM2, frontMinM, method, dirPref, layerId }),
        );
      } finally {
        setRecomputingIds((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    },
    [targetAreaM2, frontMinM, getMethod, getRotateDir],
  );

  const handleMethodClick = useCallback(
    (row: ManzanoRow, method: ManzanoLoteMethod) => {
      setMethod(row.id, method);
      void runRecompute(row);
    },
    [setMethod, runRecompute],
  );

  const handlePreviewLots = useCallback(
    async (row: ManzanoRow) => {
      if (!drawSource) return;
      const feat = drawSource.getFeatureById(row.id) as Feature<Geometry> | null;
      const geom = feat?.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const ring = ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);
      const method = getMethod(row.id);
      const dirPref = getRotateDir(row.id);
      try {
        const lots = await subdivideManzanoInWorker(ring, method, targetAreaM2, frontMinM, dirPref);
        useSubdivisionPreviewStore.getState().setRings(lots.map((l) => l.pts));
      } catch (err) {
        console.error('Preview de lotes falló', err);
      }
    },
    [drawSource, getMethod, getRotateDir, targetAreaM2, frontMinM],
  );

  const handleToggleEquip = useCallback(
    (row: ManzanoRow) => {
      if (!drawSource) return;
      const feat = drawSource.getFeatureById(row.id) as Feature<Geometry> | null;
      if (!feat) return;
      const wasEquip = getFeatureKind(feat) === 'equipamiento';
      const nextKind = wasEquip ? 'manzana' : 'equipamiento';
      feat.setProperties(ensureKind({ ...feat.getProperties(), kind: nextKind }, nextKind));
      if (!wasEquip) {
        const toRemove: Feature<Geometry>[] = [];
        drawSource.forEachFeature((f) => {
          if (f.get('lotGroupId') === String(row.id)) toRemove.push(f as Feature<Geometry>);
        });
        toRemove.forEach((f) => drawSource.removeFeature(f));
        feat.unset('lotStatus', true);
      } else {
        setLotStatus(feat, 'none');
      }
      drawSource.changed();
    },
    [drawSource],
  );

  const handleStartRotate = useCallback(
    (row: ManzanoRow) => {
      if (!drawSource) return;
      const feat = drawSource.getFeatureById(row.id) as Feature<Geometry> | null;
      const geom = feat?.getGeometry();
      if (!(geom instanceof Polygon)) return;
      const ring = ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt);
      const cen = centroid(ring);
      const existing = getRotateDir(row.id);
      const R = Math.max(6, Math.min(60, Math.sqrt(Math.max(1, row.areaM2)) * 0.45));
      const dir = existing ?? { ax: 1, ay: 0 };
      const anchor: [number, number] = [cen[0], cen[1]];
      const handle: [number, number] = [anchor[0] + dir.ax * R, anchor[1] + dir.ay * R];
      startRotateLots(row.id, anchor, handle);
    },
    [drawSource, getRotateDir, startRotateLots],
  );

  const handleResetRotate = useCallback(
    (row: ManzanoRow) => {
      setRotateDir(row.id, undefined);
      void runRecompute(row);
    },
    [setRotateDir, runRecompute],
  );

  const handleManualAngleApply = useCallback(
    (row: ManzanoRow, deg: number) => {
      if (!Number.isFinite(deg)) return;
      const rad = (deg * Math.PI) / 180;
      setRotateDir(row.id, { ax: Math.cos(rad), ay: Math.sin(rad) });
      void runRecompute(row);
    },
    [setRotateDir, runRecompute],
  );

  return {
    lotsBusy,
    recomputingIds,
    runRecompute,
    handleMethodClick,
    handlePreviewLots,
    handleToggleEquip,
    handleStartRotate,
    handleResetRotate,
    handleManualAngleApply,
    handleGenerarTodos: runGenerateAllLots,
    handleCancelGenerarTodos: cancelGenerateAllLots,
  };
}