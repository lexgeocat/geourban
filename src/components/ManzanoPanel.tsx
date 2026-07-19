import React, { useEffect, useMemo, useState, useCallback } from 'react';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useMapStore } from '../store/mapStore';
import { useManzanoStore, type ManzanoLoteMethod } from '../store/manzanoStore';
import { useCommandStack } from '../commands/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/RecomputeManzanoLotsCommand';
import { GenerateLotsCommand } from '../commands/GenerateLotsCommand';
import { polyArea, centroid, type Pt } from '../geo/polygonEngine';
import { useDrawStore } from '../store/drawStore';
import { useStreetStore } from '../store/streetStore';
import { useRoundaboutStore } from '../store/roundaboutStore';

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

const METHOD_BTNS: { key: ManzanoLoteMethod; label: string; color: string }[] = [
  { key: 'auto', label: '▣ Auto', color: 'var(--cad-accent)' },
  { key: 'exact', label: '◈ Modo 1', color: 'var(--cad-accent-green)' },
  { key: 'modo2', label: '◆ Modo 2', color: '#4dd0c4' },
];

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
  isEquip: boolean;
  lots: LotInfo[];
}

function ringPerimeter(pts: Pt[]): number {
  let per = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    per += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return per;
}

function readManzanoRows(drawSource: any): ManzanoRow[] {
  if (!drawSource) return [];
  const rows: ManzanoRow[] = [];
  let fallbackIdx = 0;
  drawSource.forEachFeature((f: Feature<Geometry>) => {
    const type = f.get('type');
    if (type !== 'manzana' && type !== 'equipamiento') return;
    const id = f.getId();
    if (id == null) return;
    const geom = f.getGeometry();
    const ring: Pt[] = geom instanceof Polygon
      ? ((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt)
      : [];
    const areaM2 = (f.get('areaM2') as number | undefined) ?? (ring.length ? polyArea(ring) : 0);
    const perimeterM = ring.length ? ringPerimeter(ring) : 0;
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
    rows.push({ id, colorIdx: colorIdx % MZN_COLORS.length, areaM2, perimeterM, isEquip: type === 'equipamiento', lots });
    fallbackIdx++;
  });
  return rows;
}

export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!drawSource) return;
    const bump = () => setTick((n) => n + 1);
    drawSource.on('addfeature', bump);
    drawSource.on('removefeature', bump);
    drawSource.on('change', bump);
    return () => {
      drawSource.un('addfeature', bump);
      drawSource.un('removefeature', bump);
      drawSource.un('change', bump);
    };
  }, [drawSource]);

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
  const setGeomSnapshot = useManzanoStore((s) => s.setGeomSnapshot);
  const hasGeomChanged = useManzanoStore((s) => s.hasGeomChanged);
  const openCards = useManzanoStore((s) => s.openCards);
  const toggleCardOpen = useManzanoStore((s) => s.toggleCardOpen);
  const rotatingId = useManzanoStore((s) => s.rotatingId);
  const startRotateLots = useManzanoStore((s) => s.startRotateLots);
  const cancelRotateLots = useManzanoStore((s) => s.cancelRotateLots);

  const [lotsBusy, setLotsBusy] = useState(false);
  const [expandedLots, setExpandedLots] = useState<Record<string, boolean>>({});

  // ── Parámetros contextuales de vía / rotonda: se muestran acá (panel
  // fijo a la izquierda) mientras esas herramientas están activas — igual
  // que las tarjetas "vias-params-card" / "rotonda-params-card" de
  // index_modelo.html — en vez de vivir solo en un input suelto del ribbon.
  const drawMode = useDrawStore((s) => s.mode);
  const defaultWidthM = useStreetStore((s) => s.defaultWidthM);
  const setDefaultWidth = useStreetStore((s) => s.setDefaultWidth);
  const defaultCurvatureM = useStreetStore((s) => s.defaultCurvatureM);
  const setDefaultCurvature = useStreetStore((s) => s.setDefaultCurvature);
  const rbRadiusM = useRoundaboutStore((s) => s.defaultRadiusM);
  const setRbRadius = useRoundaboutStore((s) => s.setDefaultRadius);
  const rbSides = useRoundaboutStore((s) => s.defaultSides);
  const setRbSides = useRoundaboutStore((s) => s.setDefaultSides);
  const rbRoadWidthM = useRoundaboutStore((s) => s.defaultRoadWidthM);
  const setRbRoadWidth = useRoundaboutStore((s) => s.setDefaultRoadWidth);
  const rbSidewalkM = useRoundaboutStore((s) => s.defaultSidewalkWidthM);
  const setRbSidewalk = useRoundaboutStore((s) => s.setDefaultSidewalkWidth);

  const showStreetParams = drawMode === 'street';
  const showRoundaboutParams = drawMode === 'roundabout';

  const runRecompute = useCallback(
    async (row: ManzanoRow) => {
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
      if (dirPref) setGeomSnapshot(row.id, { area: row.areaM2, perimeter: row.perimeterM });
    },
    [targetAreaM2, frontMinM, getMethod, getRotateDir, setGeomSnapshot],
  );

  const handleMethodClick = (row: ManzanoRow, method: ManzanoLoteMethod) => {
    setMethod(row.id, method);
    void runRecompute(row);
  };

  const handleToggleEquip = (row: ManzanoRow) => {
    if (!drawSource) return;
    const feat = drawSource.getFeatureById(row.id) as Feature<Geometry> | null;
    if (!feat) return;
    const wasEquip = feat.get('type') === 'equipamiento';
    feat.set('type', wasEquip ? 'manzana' : 'equipamiento', true);
    if (!wasEquip) {
      const toRemove: Feature<Geometry>[] = [];
      drawSource.forEachFeature((f) => {
        if (f.get('lotGroupId') === String(row.id)) toRemove.push(f as Feature<Geometry>);
      });
      toRemove.forEach((f) => drawSource.removeFeature(f));
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
    setLotsBusy(true);
    try {
      await useCommandStack.getState().run(new GenerateLotsCommand({ targetAreaM2, frontMinM }));
    } finally {
      setLotsBusy(false);
    }
  };

  // Antes el panel entero desaparecía hasta que hubiera manzanos
  // (rows.length === 0), lo que en la práctica lo ocultaba siempre hasta
  // trazar una vía. Ahora queda visible mientras el usuario no lo cierre
  // explícitamente con ✕ — igual que la tarjeta "Manzanos" del sidebar de
  // referencia, siempre presente aunque esté vacía.
  if (!panelVisible) return null;

  const totalLotes = rows.reduce((a, r) => a + r.lots.length, 0);
  const totalMznArea = rows.filter((r) => !r.isEquip).reduce((a, r) => a + r.areaM2, 0);

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        top: 90,
        left: 10,
        width: 280,
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
            style={inputStyle}
          />
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>
            Radio de ochava (m) — 0 = automático
          </label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={defaultCurvatureM}
            onChange={(e) => setDefaultCurvature(Math.max(0, parseFloat(e.target.value) || 0))}
            style={inputStyle}
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
            style={inputStyle}
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
                style={inputStyle}
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
                style={inputStyle}
              />
            </div>
          </div>
          <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Forma</label>
          <select
            value={rbSides}
            onChange={(e) => setRbSides(parseInt(e.target.value, 10))}
            style={{ ...inputStyle, cursor: 'pointer' }}
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
          style={inputStyle}
        />
        <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>
          Frente mínimo (m)
        </label>
        <input
          type="number"
          value={frontMinM}
          onChange={(e) => setFrontMinM(parseFloat(e.target.value) || 0)}
          style={inputStyle}
        />
        <button
          onClick={handleGenerarTodos}
          disabled={lotsBusy || rows.length === 0}
          className="cad-icon-btn"
          style={{ width: '100%', marginTop: 8, height: 28 }}
        >
          {lotsBusy ? 'Generando…' : '▶ Generar todos'}
        </button>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>
          Todavía no hay manzanos. Trazá vías que crucen la parcela para generarlos.
        </p>
      ) : (
        <>
          {rows.map((row) => {
            const isOpen = !!openCards[String(row.id)];
            const color = MZN_COLORS[row.colorIdx];
            const method = getMethod(row.id);
            const rotateDir = getRotateDir(row.id);
            const isRotatingThis = rotatingId === row.id;
            const geomChanged = rotateDir != null && hasGeomChanged(row.id, { area: row.areaM2, perimeter: row.perimeterM });
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
                      {row.areaM2.toFixed(1)} m²{row.lots.length ? ` · ${row.lots.length} lotes` : ''}
                      {geomChanged && <span style={{ color: 'var(--cad-accent-amber)' }}> · ⚠ desactualizado</span>}
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
                                    <span>{l.areaM2.toFixed(1)} m²</span>
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

          <div
            style={{
              marginTop: 6,
              paddingTop: 6,
              borderTop: '1px solid var(--cad-border)',
              fontSize: '0.63rem',
              color: 'var(--cad-text-muted)',
            }}
          >
            Manzanos: {totalMznArea.toFixed(1)} m² · {totalLotes} lotes en total
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '5px 8px',
  background: 'var(--cad-bg-deepest)',
  border: '1px solid var(--cad-border)',
  borderRadius: 4,
  color: 'var(--cad-text)',
  fontSize: '0.72rem',
  fontFamily: 'JetBrains Mono, monospace',
};