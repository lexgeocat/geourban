import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useMapStore } from '../store/mapStore';
import { useManzanoStore, type ManzanoLoteMethod } from '../store/manzanoStore';
import { useCommandStack } from '../commands/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/RecomputeManzanoLotsCommand';
import { GenerateLotsCommand } from '../commands/GenerateLotsCommand';
import { polyArea, centroid, ringPerimeter, type Pt } from '../geo/polygonEngine';
import { useDrawStore } from '../store/drawStore';
import { useStreetStore } from '../store/streetStore';
import { useRoundaboutStore } from '../store/roundaboutStore';
import { getFeatureKind, ensureKind, getLotStatus, setLotStatus, type LotStatus } from '../core/objectModel';
import { useIncrementalRender } from '../hooks/useIncrementalRender';
import { useDrawSourceTick } from '../hooks/useDrawSourceTick';
import { useViewportWidth } from '../hooks/useViewportWidth';
import { setMaxFilletRadius, getMaxFilletRadius } from '../geo/streetEngine';
import { SUBDIVISION_METHOD_INFO } from '../geo/subdivisionMethodLabels';
import { useTopologyWarningsStore } from '../store/topologyWarningsStore';
import { useSubdivisionPreviewStore } from '../store/subdivisionPreviewStore';
import { formatMetricArea } from '../geo/metrics';
import { subdivideManzanoInWorker } from '../workers/geoWorkerClient';
import { useGenerateLotsProgressStore } from '../store/generateLotsProgressStore';

const MZN_COLORS = [
  '#58a6ff',
  '#3fb950',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#84cc16',
];

const METHOD_BTNS = (['auto', 'exact', 'modo2'] as ManzanoLoteMethod[]).map((key) => ({
  key,
  label: SUBDIVISION_METHOD_INFO[key].shortLabel,
  color: SUBDIVISION_METHOD_INFO[key].color,
}));

interface LotInfo {
  label: string;
  areaM2: number;
  isRemnant: boolean;
}

interface ManzanoRow {
  id: string | number;
  colorIdx: number;
  areaM2: number;
  perimeterM: number;
  centroid: Pt;
  isEquip: boolean;
  lots: LotInfo[];
  lotStatus: LotStatus;
}

function readManzanoRows(drawSource: any): ManzanoRow[] {
  if (!drawSource) return [];
  const rows: ManzanoRow[] = [];
  let fallbackIdx = 0;
  drawSource.forEachFeature((f: Feature<Geometry>) => {
    const kind = getFeatureKind(f);
    if (kind !== 'manzana' && kind !== 'equipamiento') return;
    const id = f.getId();
    if (id == null) return;
    const geom = f.getGeometry();
    const ring: Pt[] = geom instanceof Polygon
      ? ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
      : [];
    const areaM2 = (f.get('areaM2') as number | undefined) ?? (ring.length ? polyArea(ring) : 0);
    const perimeterM = ring.length ? ringPerimeter(ring) : 0;
    const centroidPt: Pt = ring.length ? centroid(ring) : [0, 0];
    const lots: LotInfo[] = [];
    drawSource.forEachFeature((g: Feature<Geometry>) => {
      if (g.get('lotGroupId') !== String(id)) return;
      lots.push({
        label: (g.get('label') as string) ?? 'Lote',
        areaM2: (g.get('areaM2') as number) ?? 0,
        isRemnant: !!g.get('isRemnant'),
      });
    });
    const colorIdx = (f.get('colorIdx') as number | undefined) ?? fallbackIdx;
    rows.push({
      id,
      colorIdx: colorIdx % MZN_COLORS.length,
      areaM2,
      perimeterM,
      centroid: centroidPt,
      isEquip: kind === 'equipamiento',
      lots,
      lotStatus: getLotStatus(f),
    });
    fallbackIdx++;
  });
  return rows;
}
export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);

  const rows = useMemo(() => readManzanoRows(drawSource), [drawSource, tick]);
  const panelVisible = useManzanoStore((s) => s.panelVisible);
  const setPanelVisible = useManzanoStore((s) => s.setPanelVisible);
  const targetAreaM2 = useManzanoStore((s) => s.targetAreaM2);
  const frontMinM = useManzanoStore((s) => s.frontMinM);
  const setTargetAreaM2 = useManzanoStore((s) => s.setTargetAreaM2);
  const setFrontMinM = useManzanoStore((s) => s.setFrontMinM);
  const getMethod = useManzanoStore((s) => s.getMethod);
  const setMethod = useManzanoStore((s) => s.setMethod);
  const getRotateDir = useManzanoStore((s) => s.getRotateDir);
  const setRotateDir = useManzanoStore((s) => s.setRotateDir);
  const hasGeomChanged = useManzanoStore((s) => s.hasGeomChanged);
  const openCards = useManzanoStore((s) => s.openCards);
  const toggleCardOpen = useManzanoStore((s) => s.toggleCardOpen);
  const rotatingId = useManzanoStore((s) => s.rotatingId);
  const startRotateLots = useManzanoStore((s) => s.startRotateLots);
  const cancelRotateLots = useManzanoStore((s) => s.cancelRotateLots);
  const affectedManzanoIds = useTopologyWarningsStore((s) => s.affectedManzanoIds);

  const [lotsBusy, setLotsBusy] = useState(false);
  const genProgress = useGenerateLotsProgressStore();
  const [expandedLots, setExpandedLots] = useState<Record<string, boolean>>({});
  const [recomputingIds, setRecomputingIds] = useState<Set<string>>(new Set());
  const [manualAngleOpen, setManualAngleOpen] = useState<Record<string, boolean>>({});
  const [manualAngleValue, setManualAngleValue] = useState<Record<string, string>>({});
  const [maxFilletR, setMaxFilletR] = useState(() => getMaxFilletRadius());

  // Fase 6 (H18): renderizado incremental de tarjetas de manzano.
  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(rows.length, 40, panelRef);

  // ── Parámetros contextuales de vía / rotonda: se muestran acá (panel
  // fijo a la izquierda) mientras esas herramientas están activas — igual
  // que las tarjetas "vias-params-card" / "rotonda-params-card" de
  // index_modelo.html — en vez de vivir solo en un input suelto del ribbon.
  const drawMode = useDrawStore((s) => s.mode);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const defaultSideWidthM = useStreetStore((s) => s.defaultSideWidthM);
  const setDefaultSideWidth = useStreetStore((s) => s.setDefaultSideWidth);
  const rbRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const setRbRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const rbSides = useRoundaboutStore((s) => s.defaultSides);
  const setRbSides = useRoundaboutStore((s) => s.setDefaultSides);
  const rbRoadWidthM = useRoundaboutStore((s) => s.defaultRoadWidthM);
  const setRbRoadWidth = useRoundaboutStore((s) => s.setDefaultRoadWidth);
  const rbSidewalkM = useRoundaboutStore((s) => s.defaultSidewalkWidthM);
  const setRbSidewalk = useRoundaboutStore((s) => s.setDefaultSidewalkWidth);

  const viewportWidth = useViewportWidth();
  const panelWidth = Math.min(280, viewportWidth - 20);
  const showStreetParams = drawMode === 'street';
  const showRoundaboutParams = drawMode === 'roundabout';

  const runRecompute = useCallback(
    async (row: ManzanoRow) => {
      const key = String(row.id);
      setRecomputingIds((s) => new Set(s).add(key));
      useSubdivisionPreviewStore.getState().clear();
      try {
        const method = getMethod(row.id);
        const dirPref = getRotateDir(row.id);
        await useCommandStack
          .getState()
          .run(
            new RecomputeManzanoLotsCommand({
              manzanoId: row.id,
              targetAreaM2,
              frontMinM,
              method,
              dirPref,
            }),
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

  const handleMethodClick = (row: ManzanoRow, method: ManzanoLoteMethod) => {
    setMethod(row.id, method);
    void runRecompute(row);
  };

  const handlePreviewLots = async (row: ManzanoRow) => {
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
  };

  const handleToggleEquip = (row: ManzanoRow) => {
    if (!drawSource) return;
    const feat = drawSource.getFeatureById(row.id) as Feature<Geometry> | null;
    if (!feat) return;
    const wasEquip = getFeatureKind(feat) === 'equipamiento';
    const nextKind = wasEquip ? 'manzana' : 'equipamiento';
    feat.setProperties(ensureKind(
      { ...feat.getProperties(), kind: nextKind },
      nextKind,
    ));
    if (!wasEquip) {
      // Pasa a equipamiento: borra lotes hijos vivos y limpia lotStatus
      // (Fase 1 — solo aplica a kind:'manzana').
      const toRemove: Feature<Geometry>[] = [];
      drawSource.forEachFeature((f) => {
        if (f.get('lotGroupId') === String(row.id)) toRemove.push(f as Feature<Geometry>);
      });
      toRemove.forEach((f) => drawSource.removeFeature(f));
      feat.unset('lotStatus', true);
    } else {
      // Vuelve a manzana: sus lotes ya se borraron al marcarla equipamiento
      // — no arrastrar un lotStatus viejo del spread de arriba.
      setLotStatus(feat, 'none');
    }
    drawSource.changed();
  };

  const handleStartRotate = (row: ManzanoRow) => {
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
  };

  const handleResetRotate = (row: ManzanoRow) => {
    setRotateDir(row.id, undefined);
    void runRecompute(row);
  };

  const handleGenerarTodos = async () => {
    useSubdivisionPreviewStore.getState().clear();
    setLotsBusy(true);
    try {
      await useCommandStack.getState().run(new GenerateLotsCommand({ targetAreaM2, frontMinM }));
    } finally {
      setLotsBusy(false);
    }
  };

  const handleCancelGenerarTodos = () => {
    useGenerateLotsProgressStore.getState().requestCancel();
  };

  // Antes el panel entero desaparecía hasta que hubiera manzanos
  // (rows.length === 0), lo que en la práctica lo ocultaba siempre hasta
  // trazar una vía. Ahora queda visible mientras el usuario no lo cierre
  // explícitamente con ✕ — igual que la tarjeta "Manzanos" del sidebar de
  // referencia, siempre presente aunque esté vacía.
  useEffect(() => {
    if (!panelVisible) useSubdivisionPreviewStore.getState().clear();
  }, [panelVisible]);

  if (!panelVisible) return null;

  const totalLotes = rows.reduce((a, r) => a + r.lots.length, 0);
  const totalMznArea = rows.filter((r) => !r.isEquip).reduce((a, r) => a + r.areaM2, 0);

  return (
    <div
      ref={panelRef}
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        top: 90,
        left: 10,
        width: panelWidth,
        maxHeight: 'calc(100vh - 140px)',
        overflowY: 'auto',
        zIndex: 900,
        padding: '10px 10px',
        fontSize: '0.72rem',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          borderBottom: '1px solid var(--cad-border)',
          paddingBottom: 6,
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.03em' }}>
          Manzanos{' '}
          {rows.length > 0 && (
            <span style={{ color: 'var(--cad-text-muted)', fontWeight: 400 }}>({rows.length})</span>
          )}
        </span>
        <button
          onClick={() => setPanelVisible(false)}
          style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }}
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      {showStreetParams && (
        <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
            ◼ PARÁMETROS DE VÍA
          </div>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Ancho de vía (m)</label>
          <input
            type="number"
            min={1}
            value={defaultWidthM}
            onChange={(e) => setDefaultWidth(parseFloat(e.target.value) || defaultWidthM)}
            className="cad-input"
          />
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>
            Ancho de vereda (m)
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={defaultSideWidthM}
            onChange={(e) => setDefaultSideWidth(Math.max(0, parseFloat(e.target.value) || 0))}
            className="cad-input"
          />
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>
            Radio máx. de ochave (m)
          </label>
          <input
            type="number"
            min={1}
            step={0.5}
            value={maxFilletR}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || maxFilletR;
              setMaxFilletR(v);
              setMaxFilletRadius(v);
            }}
            className="cad-input"
          />
        </div>
      )}

      {showRoundaboutParams && (
        <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
          <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
            ◼ PARÁMETROS DE ROTONDA
          </div>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Radio al eje (m)</label>
          <input
            type="number"
            min={3}
            value={rbRadiusM}
            onChange={(e) => setRbRadius(parseFloat(e.target.value) || rbRadiusM)}
            className="cad-input"
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Calzada (m)</label>
              <input
                type="number"
                min={1}
                step={0.5}
                value={rbRoadWidthM}
                onChange={(e) => setRbRoadWidth(parseFloat(e.target.value) || rbRoadWidthM)}
                className="cad-input"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Vereda (m)</label>
              <input
                type="number"
                min={0}
                step={0.5}
                value={rbSidewalkM}
                onChange={(e) => setRbSidewalk(parseFloat(e.target.value) || 0)}
                className="cad-input"
              />
            </div>
          </div>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Forma</label>
          <select
            value={rbSides}
            onChange={(e) => setRbSides(parseInt(e.target.value, 10))}
            className="cad-input" style={{ cursor: 'pointer' }}
          >
            <option value={0}>Círculo</option>
            <option value={3}>Triángulo</option>
            <option value={4}>Cuadrado</option>
            <option value={5}>Pentágono</option>
            <option value={6}>Hexágono</option>
            <option value={7}>Heptágono</option>
            <option value={8}>Octógono</option>
          </select>
        </div>
      )}

      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ◼ PARÁMETROS DE LOTES
        </div>
        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Área objetivo (m²)</label>
        <input
          type="number"
          value={targetAreaM2}
          onChange={(e) => setTargetAreaM2(parseFloat(e.target.value) || 0)}
          className="cad-input"
        />
        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>
          Frente mínimo (m)
        </label>
        <input
          type="number"
          value={frontMinM}
          onChange={(e) => setFrontMinM(parseFloat(e.target.value) || 0)}
          className="cad-input"
        />
        <button
          onClick={handleGenerarTodos}
          disabled={lotsBusy || rows.length === 0}
          className="cad-icon-btn"
          style={{ width: '100%', marginTop: 8, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {lotsBusy ? (<><span className="cad-spinner" /> Generando…</>) : '▶ Generar todos'}
        </button>
        {genProgress.active && (
          <div style={{ marginTop: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--cad-text-muted)', marginBottom: 3 }}>
              <span>{genProgress.processed}/{genProgress.total} manzanos</span>
              <button
                onClick={handleCancelGenerarTodos}
                disabled={genProgress.cancelRequested}
                style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: genProgress.cancelRequested ? 'default' : 'pointer', fontSize: '0.6rem' }}
              >
                {genProgress.cancelRequested ? 'Cancelando…' : 'Cancelar'}
              </button>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: 'var(--cad-bg-deepest)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${genProgress.total > 0 ? (genProgress.processed / genProgress.total) * 100 : 0}%`,
                  background: 'var(--cad-accent)',
                  transition: 'width 150ms ease',
                }}
              />
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>
          Todavía no hay manzanos. Trazá vías que crucen la parcela para generarlos.
        </p>
      ) : (
        <>
          {rows.slice(0, visibleCount).map((row) => {
            const isOpen = !!openCards[String(row.id)];
            const color = MZN_COLORS[row.colorIdx];
            const method = getMethod(row.id);
            const rotateDir = getRotateDir(row.id);
            const isRotatingThis = rotatingId === row.id;
            const geomChanged = rotateDir != null && hasGeomChanged(row.id, { area: row.areaM2, perimeter: row.perimeterM, centroid: row.centroid });
            const lotsOpen = !!expandedLots[String(row.id)];
            const normalLots = row.lots.filter((l) => !l.isRemnant).length;
            const remLots = row.lots.filter((l) => l.isRemnant).length;

            return (
              <div
                key={String(row.id)}
                style={{
                  border: `1px solid ${color}55`,
                  borderLeft: `3px solid ${color}`,
                  borderRadius: 4,
                  marginBottom: 6,
                  background: row.isEquip ? 'rgba(77,208,196,0.08)' : `${color}14`,
                }}
              >
                <div
                  onClick={() => toggleCardOpen(row.id)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', cursor: 'pointer' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color }}>
                      {row.isEquip ? '★ Equipamiento' : `Mzo. ${row.colorIdx + 1}`}
                    </div>
                    <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>
                      {formatMetricArea(row.areaM2)}{row.lots.length ? ` · ${row.lots.length} lotes` : ''}
                      {geomChanged && <span style={{ color: 'var(--cad-accent-amber)' }}> · ⚠ desactualizado</span>}
                      {row.lotStatus === 'pending' && <span style={{ color: 'var(--cad-accent-red)' }}> · ⏳ pendiente</span>}
                      {affectedManzanoIds.has(String(row.id)) && (
                        <span style={{ color: 'var(--cad-accent-red)' }}> · ⚠ topología</span>
                      )}
                      {recomputingIds.has(String(row.id)) && (
                        <span style={{ color: 'var(--cad-accent)' }}> · ⏳ calculando…</span>
                      )}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      color: 'var(--cad-text-dim)',
                      transform: isOpen ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.15s',
                    }}
                  >
                    ▶
                  </span>
                </div>

                {isOpen && (
                  <div style={{ padding: '0 8px 8px 8px' }}>
                    <button
                      onClick={() => handleToggleEquip(row)}
                      className="cad-icon-btn"
                      style={{
                        width: '100%',
                        height: 26,
                        marginBottom: 6,
                        borderColor: row.isEquip ? 'var(--cad-accent)' : undefined,
                        color: row.isEquip ? 'var(--cad-accent)' : undefined,
                      }}
                    >
                      {row.isEquip ? '▼ Quitar equipamiento' : '▲ Marcar como equipamiento'}
                    </button>

                    {!row.isEquip && (
                      <>
                        {row.lotStatus === 'pending' && (
                          <div
                            style={{
                              padding: '6px 8px',
                              marginBottom: 6,
                              background: 'rgba(239,68,68,0.10)',
                              border: '1px solid var(--cad-accent-red)',
                              borderRadius: 4,
                              fontSize: '0.62rem',
                              color: 'var(--cad-accent-red)',
                            }}
                          >
                            <div style={{ marginBottom: 4 }}>
                              Una vía nueva recortó este manzano — el sistema no pudo re-lotizarlo solo.
                            </div>
                            <button
                              onClick={() => runRecompute(row)}
                              className="cad-icon-btn"
                              style={{ width: '100%', height: 24, fontSize: '0.62rem', color: 'var(--cad-accent-red)', borderColor: 'var(--cad-accent-red)' }}
                            >
                              ⏳ Generar lotes ahora
                            </button>
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                          {METHOD_BTNS.map((m) => (
                            <button
                              key={m.key}
                              onClick={() => handleMethodClick(row, m.key)}
                              className="cad-icon-btn"
                              style={{
                                flex: 1,
                                height: 24,
                                fontSize: '0.62rem',
                                borderColor: method === m.key ? m.color : undefined,
                                color: method === m.key ? m.color : undefined,
                              }}
                            >
                              {m.label}
                            </button>
                          ))}
                          <button
                            onClick={() => void handlePreviewLots(row)}
                            className="cad-icon-btn"
                            style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 6 }}
                          >
                            👁 Vista previa de corte
                          </button>
                        </div>

                        {isRotatingThis ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 4,
                              padding: '5px 8px',
                              marginBottom: 6,
                              background: 'rgba(39,174,96,0.12)',
                              border: '1px solid #27ae60',
                              borderRadius: 4,
                              color: '#27ae60',
                              fontSize: '0.62rem',
                            }}
                          >
                            <span>▶ Arrastrá el punto amarillo en el mapa…</span>
                            <button
                              onClick={() => cancelRotateLots()}
                              style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer' }}
                            >
                              ✕
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button onClick={() => handleStartRotate(row)} className="cad-icon-btn" style={{ flex: 1, height: 24, fontSize: '0.62rem' }}>
                                ↻ Rotar lotes
                              </button>
                              {rotateDir && (
                                <button
                                  onClick={() => handleResetRotate(row)}
                                  className="cad-icon-btn"
                                  style={{ height: 24, fontSize: '0.62rem', color: 'var(--cad-accent-red)' }}
                                >
                                  Reset
                                </button>
                              )}
                            </div>
                            <div style={{ marginTop: 4 }}>
                              <button
                                onClick={() => setManualAngleOpen((s) => ({ ...s, [String(row.id)]: !s[String(row.id)] }))}
                                className="cad-icon-btn"
                                style={{ width: '100%', height: 22, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}
                                aria-label="Alternativa por teclado: ingresar ángulo de rotación manualmente"
                              >
                                {manualAngleOpen[String(row.id)] ? '▲ Ocultar ángulo manual' : '⌨ Ángulo manual (accesible)'}
                              </button>
                              {manualAngleOpen[String(row.id)] && (
                                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                                  <input
                                    type="number"
                                    step={1}
                                    placeholder="grados"
                                    value={manualAngleValue[String(row.id)] ?? ''}
                                    onChange={(e) => setManualAngleValue((s) => ({ ...s, [String(row.id)]: e.target.value }))}
                                    className="cad-input"
                                    aria-label={`Ángulo de rotación de lotes para Mzo. ${row.colorIdx + 1}, en grados`}
                                  />
                                  <button
                                    onClick={() => {
                                      const deg = parseFloat(manualAngleValue[String(row.id)] ?? '');
                                      if (!Number.isFinite(deg)) return;
                                      const rad = (deg * Math.PI) / 180;
                                      setRotateDir(row.id, { ax: Math.cos(rad), ay: Math.sin(rad) });
                                      void runRecompute(row);
                                    }}
                                    className="cad-icon-btn"
                                    style={{ height: 'auto', fontSize: '0.6rem', padding: '0 8px' }}
                                  >
                                    Aplicar
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {geomChanged && (
                          <button
                            onClick={() => runRecompute(row)}
                            className="cad-icon-btn"
                            style={{
                              width: '100%',
                              height: 24,
                              marginTop: 6,
                              fontSize: '0.62rem',
                              borderColor: 'var(--cad-accent-amber)',
                              color: 'var(--cad-accent-amber)',
                            }}
                          >
                            ↺ Regenerar (el manzano cambió)
                          </button>
                        )}

                        {row.lots.length > 0 && (
                          <div style={{ marginTop: 6 }}>
                            <div
                              onClick={() =>
                                setExpandedLots((s) => ({
                                  ...s,
                                  [String(row.id)]: !s[String(row.id)],
                                }))
                              }
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                fontSize: '0.63rem',
                                color: 'var(--cad-text-dim)',
                              }}
                            >
                              <span>
                                {normalLots} lotes · {remLots} remanentes
                              </span>
                              <span
                                style={{
                                  transform: lotsOpen ? 'rotate(90deg)' : 'none',
                                  transition: 'transform 0.15s',
                                }}
                              >
                                ▶
                              </span>
                            </div>
                            {lotsOpen && (
                              <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 4 }}>
                                {row.lots.map((l, i) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      fontSize: '0.6rem',
                                      padding: '2px 4px',
                                      color: l.isRemnant ? 'var(--cad-accent-amber)' : 'var(--cad-text-dim)',
                                    }}
                                  >
                                    <span>{l.label}</span>
                                    <span>{formatMetricArea(l.areaM2)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {rows.length > visibleCount && (
            <div ref={sentinelRef} style={{ height: 1 }} />
          )}

          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--cad-border)',
              fontSize: '0.63rem',
              color: 'var(--cad-text-muted)',
            }}
          >
            Manzanos: {formatMetricArea(totalMznArea)} · {totalLotes} lotes en total
          </div>
        </>
      )}
    </div>
  );
}