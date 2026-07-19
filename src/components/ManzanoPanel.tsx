// src/components/ManzanoPanel.tsx
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import Feature from 'ol/Feature.js';
import type Geometry from 'ol/geom/Geometry.js';
import Polygon from 'ol/geom/Polygon.js';
import { useMapStore } from '../store/mapStore';
import { useManzanoStore, type ManzanoLoteMethod } from '../store/manzanoStore';
import { useCommandStack } from '../commands/CommandStack';
import { RecomputeManzanoLotsCommand } from '../commands/RecomputeManzanoLotsCommand';
import { GenerateLotsCommand } from '../commands/GenerateLotsCommand';
import { polyArea, type Pt } from '../geo/polygonEngine';

const MZN_COLORS = [
  '#58a6ff', '#3fb950', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16',
];

const METHOD_BTNS: { key: ManzanoLoteMethod; label: string }[] = [
  { key: 'auto', label: 'Auto' },
  { key: 'exact', label: 'Modo 1' },
  { key: 'modo2', label: 'Modo 2' },
];

interface ManzanoRow {
  id: string | number;
  colorIdx: number;
  areaM2: number;
  isEquip: boolean;
  lotCount: number;
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
    const areaM2 =
      (f.get('areaM2') as number | undefined) ??
      (geom instanceof Polygon
        ? polyArea(((geom.getCoordinates()[0] ?? []) as number[][]).map((c) => [c[0], c[1]] as Pt))
        : 0);
    let lotCount = 0;
    drawSource.forEachFeature((g: Feature<Geometry>) => {
      if (g.get('lotGroupId') === String(id)) lotCount++;
    });
    const colorIdx = (f.get('colorIdx') as number | undefined) ?? fallbackIdx;
    rows.push({ id, colorIdx: colorIdx % MZN_COLORS.length, areaM2, isEquip: type === 'equipamiento', lotCount });
    fallbackIdx++;
  });
  return rows;
}

export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const map = useMapStore((s) => s.mapInstance);
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
  const openCards = useManzanoStore((s) => s.openCards);
  const toggleCardOpen = useManzanoStore((s) => s.toggleCardOpen);
  const pickingId = useManzanoStore((s) => s.pickingId);
  const setPickingId = useManzanoStore((s) => s.setPickingId);

  // ── "Rotar lotes": 2 clics en el mapa definen la dirección manual ──────
  const pickBufRef = useRef<[number, number][]>([]);
  useEffect(() => {
    if (!map || pickingId == null) return;
    pickBufRef.current = [];
    const handler = (evt: any) => {
      pickBufRef.current.push([evt.coordinate[0], evt.coordinate[1]]);
      if (pickBufRef.current.length >= 2) {
        const [a, b] = pickBufRef.current;
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy) || 1;
        setRotateDir(pickingId, { ax: dx / len, ay: dy / len });
        setPickingId(null);
        void runRecompute(pickingId);
      }
    };
    map.on('singleclick', handler);
    return () => { map.un('singleclick', handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pickingId]);

  const runRecompute = useCallback(
    async (id: string | number) => {
      const method = useManzanoStore.getState().getMethod(id);
      const dirPref = useManzanoStore.getState().getRotateDir(id);
      await useCommandStack
        .getState()
        .run(new RecomputeManzanoLotsCommand({ manzanoId: id, targetAreaM2, frontMinM, method, dirPref }));
    },
    [targetAreaM2, frontMinM],
  );

  const handleMethodClick = (id: string | number, method: ManzanoLoteMethod) => {
    setMethod(id, method);
    void runRecompute(id);
  };

  const handleToggleEquip = (id: string | number) => {
    if (!drawSource) return;
    const feat = drawSource.getFeatureById(id) as Feature<Geometry> | null;
    if (!feat) return;
    const wasEquip = feat.get('type') === 'equipamiento';
    feat.set('type', wasEquip ? 'manzana' : 'equipamiento', true);
    if (!wasEquip) {
      const toRemove: Feature<Geometry>[] = [];
      drawSource.forEachFeature((f) => {
        if (f.get('lotGroupId') === String(id)) toRemove.push(f as Feature<Geometry>);
      });
      toRemove.forEach((f) => drawSource.removeFeature(f));
    }
    drawSource.changed();
  };

  const handleGenerarTodos = async () => {
    await useCommandStack.getState().run(new GenerateLotsCommand({ targetAreaM2, frontMinM }));
  };

  if (!panelVisible || rows.length === 0) return null;

  return (
    <div
      className="cad-panel-glass"
      style={{
        position: 'fixed',
        top: 90,
        right: 10,
        width: 272,
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
        <span style={{ fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.03em' }}>Manzanos</span>
        <button
          onClick={() => setPanelVisible(false)}
          style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }}
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
        <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          PARÁMETROS DE LOTES
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
        <button onClick={handleGenerarTodos} className="cad-icon-btn" style={{ width: '100%', marginTop: 8, height: 28 }}>
          ▶ Generar todos
        </button>
      </div>

      {rows.map((row) => {
        const isOpen = !!openCards[String(row.id)];
        const color = MZN_COLORS[row.colorIdx];
        const method = getMethod(row.id);
        const hasDir = !!getRotateDir(row.id);
        const isPicking = pickingId === row.id;

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
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 8px',
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, color }}>
                  {row.isEquip ? 'Equipamiento' : `Mzo. ${row.colorIdx + 1}`}
                </div>
                <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>
                  {row.areaM2.toFixed(1)} m²{row.lotCount ? ` · ${row.lotCount} lotes` : ''}
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
                  onClick={() => handleToggleEquip(row.id)}
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
                          onClick={() => handleMethodClick(row.id, m.key)}
                          className="cad-icon-btn"
                          style={{
                            flex: 1,
                            height: 24,
                            fontSize: '0.62rem',
                            borderColor: method === m.key ? 'var(--cad-accent)' : undefined,
                            color: method === m.key ? 'var(--cad-accent)' : undefined,
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => setPickingId(isPicking ? null : row.id)}
                        className="cad-icon-btn"
                        style={{
                          flex: 1,
                          height: 24,
                          fontSize: '0.62rem',
                          borderColor: isPicking ? 'var(--cad-accent-amber)' : undefined,
                          color: isPicking ? 'var(--cad-accent-amber)' : undefined,
                        }}
                      >
                        {isPicking ? 'Clic en 2 puntos…' : '↻ Rotar lotes'}
                      </button>
                      {hasDir && (
                        <button
                          onClick={() => {
                            setRotateDir(row.id, undefined);
                            void runRecompute(row.id);
                          }}
                          className="cad-icon-btn"
                          style={{ height: 24, fontSize: '0.62rem', color: 'var(--cad-accent-red)' }}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
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