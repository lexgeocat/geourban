import React, { useState } from 'react';
import { useManzanoStore, type ManzanoLoteMethod } from '../../../store/entities/manzanoStore';
import { useSelectionStore } from '../../../store/map/selectionStore';
import { formatMetricArea } from '../../../geo/metrics';
import { SUBDIVISION_METHOD_INFO } from '../../../geo/subdivision/subdivisionMethodLabels';
import { useLayersStore } from '../../../store/entities/layersRegistryStore';
import { useLabelConfigModalStore } from '../../../store/ui/labelConfigModalStore';
import { defaultLabelStyleConfig, defaultColorForKind } from '../../../core/labelModel';
import type { ManzanoRow } from '../../../geo/selectors/manzanoRows';

const METHOD_BTNS = (['auto', 'exact', 'modo2'] as ManzanoLoteMethod[]).map((key) => ({
  key,
  label: SUBDIVISION_METHOD_INFO[key].shortLabel,
  color: SUBDIVISION_METHOD_INFO[key].color,
}));

export interface ManzanoCardProps {
  row: ManzanoRow;
  isRecomputing: boolean;
  onMethodClick: (row: ManzanoRow, method: ManzanoLoteMethod) => void;
  onPreviewLots: (row: ManzanoRow) => void;
  onStartRotate: (row: ManzanoRow) => void;
  onResetRotate: (row: ManzanoRow) => void;
  onManualAngleApply: (row: ManzanoRow, deg: number) => void;
  onRunRecompute: (row: ManzanoRow) => void;
}

/** Cuenta lotes normales vs. remanentes en un único recorrido del array. */
function countLots(lots: ManzanoRow['lots']): { normalLots: number; remLots: number } {
  let normalLots = 0;
  let remLots = 0;
  for (const l of lots) {
    if (l.isRemnant) remLots++;
    else normalLots++;
  }
  return { normalLots, remLots };
}

export default function ManzanoCard({
  row, isRecomputing, onMethodClick, onPreviewLots,
  onStartRotate, onResetRotate, onManualAngleApply, onRunRecompute,
}: ManzanoCardProps) {
  const openCards = useManzanoStore((s) => s.openCards);
  const toggleCardOpen = useManzanoStore((s) => s.toggleCardOpen);
  const getMethod = useManzanoStore((s) => s.getMethod);
  const getRotateDir = useManzanoStore((s) => s.getRotateDir);
  const hasGeomChanged = useManzanoStore((s) => s.hasGeomChanged);
  const rotatingId = useManzanoStore((s) => s.rotatingId);
  const cancelRotateLots = useManzanoStore((s) => s.cancelRotateLots);
  const isSelected = useSelectionStore((s) => s.selectedIds.has(row.id));
  const selectOnMap = useSelectionStore((s) => s.setSelection);
  const openLotsBatch = useLabelConfigModalStore((s) => s.openForLotsBatch);
  const lastLotsConfig = useLabelConfigModalStore((s) => s.lastLotsConfig);
  const handleLabelLots = () => {
    openLotsBatch(row.id, lastLotsConfig ?? defaultLabelStyleConfig({ prefix: 'Lote', color: defaultColorForKind('lote') }));
  };

  const [lotsOpen, setLotsOpen] = useState(false);
  const [manualAngleOpen, setManualAngleOpen] = useState(false);
  const [manualAngleValue, setManualAngleValue] = useState('');

  const isOpen = !!openCards[String(row.id)];
  const color = useLayersStore((s) => s.getLayerForKind('manzana')?.color ?? '#f59e0b');
  const method = getMethod(row.id);
  const rotateDir = getRotateDir(row.id);
  const isRotatingThis = rotatingId === row.id;
  const geomChanged = rotateDir != null && hasGeomChanged(row.id, { area: row.areaM2, perimeter: row.perimeterM, centroid: row.centroid });
  const { normalLots, remLots } = countLots(row.lots);

  return (
    <div
      data-manzano-row-id={row.id}
      style={{
        border: `1px solid ${isSelected ? 'var(--cad-accent-amber)' : `${color}55`}`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        marginBottom: 6,
        background: `${color}14`,
        boxShadow: isSelected ? '0 0 0 1px var(--cad-accent-amber)' : 'none',
        transition: 'box-shadow 120ms ease, border-color 120ms ease',
      }}
    >
      <div
        onClick={() => {
          toggleCardOpen(row.id);
          selectOnMap([row.id], row.id);
        }}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', cursor: 'pointer' }}
        title="Click: resalta este manzano en el mapa"
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, color }}>{`Mzo. ${row.code}`}</div>
          <div style={{ color: 'var(--cad-text-muted)', fontSize: '0.65rem' }}>
            {formatMetricArea(row.areaM2)}{row.lots.length ? ` · ${row.lots.length} lotes` : ''}
            {geomChanged && <span style={{ color: 'var(--cad-accent-amber)' }}> · ⚠ desactualizado</span>}
            {row.lotStatus === 'pending' && <span style={{ color: 'var(--cad-accent-red)' }}> · ⏳ pendiente</span>}
            {isRecomputing && <span style={{ color: 'var(--cad-accent)' }}> · ⏳ calculando…</span>}
          </div>
        </div>
        <span style={{ fontSize: '0.65rem', color: 'var(--cad-text-dim)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
      </div>

      {isOpen && (
        <div style={{ padding: '0 8px 8px 8px' }}>
          {row.lotStatus === 'pending' && (
                <div style={{ padding: '6px 8px', marginBottom: 6, background: 'rgba(239,68,68,0.10)', border: '1px solid var(--cad-accent-red)', borderRadius: 4, fontSize: '0.62rem', color: 'var(--cad-accent-red)' }}>
                  <div style={{ marginBottom: 4 }}>Una vía nueva recortó este manzano — el sistema no pudo re-lotizarlo solo.</div>
                  <button onClick={() => onRunRecompute(row)} className="cad-icon-btn" style={{ width: '100%', height: 24, fontSize: '0.62rem', color: 'var(--cad-accent-red)', borderColor: 'var(--cad-accent-red)' }}>
                    ⏳ Generar lotes ahora
                  </button>
                </div>
              )}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {METHOD_BTNS.map((m) => (
                  <button
                    key={m.key} onClick={() => onMethodClick(row, m.key)} className="cad-icon-btn"
                    style={{ flex: 1, height: 24, fontSize: '0.62rem', borderColor: method === m.key ? m.color : undefined, color: method === m.key ? m.color : undefined }}
                  >
                    {m.label}
                  </button>
                ))}
                <button onClick={() => onPreviewLots(row)} className="cad-icon-btn" style={{ width: '100%', height: 24, fontSize: '0.62rem', marginBottom: 6 }}>
                  👁 Vista previa de corte
                </button>
              </div>

              {isRotatingThis ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '5px 8px', marginBottom: 6, background: 'rgba(39,174,96,0.12)', border: '1px solid #27ae60', borderRadius: 4, color: '#27ae60', fontSize: '0.62rem' }}>
                  <span>▶ Arrastrá el punto amarillo en el mapa…</span>
                  <button onClick={() => cancelRotateLots()} style={{ background: 'none', border: 'none', color: 'var(--cad-accent-red)', cursor: 'pointer' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => onStartRotate(row)} className="cad-icon-btn" style={{ flex: 1, height: 24, fontSize: '0.62rem' }}>↻ Rotar lotes</button>
                    {rotateDir && (
                      <button onClick={() => onResetRotate(row)} className="cad-icon-btn" style={{ height: 24, fontSize: '0.62rem', color: 'var(--cad-accent-red)' }}>Reset</button>
                    )}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <button
                      onClick={() => setManualAngleOpen((v) => !v)} className="cad-icon-btn"
                      style={{ width: '100%', height: 22, fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}
                      aria-label="Alternativa por teclado: ingresar ángulo de rotación manualmente"
                    >
                      {manualAngleOpen ? '▲ Ocultar ángulo manual' : '⌨ Ángulo manual (accesible)'}
                    </button>
                    {manualAngleOpen && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <input
                          type="number" step={1} placeholder="grados" value={manualAngleValue}
                          onChange={(e) => setManualAngleValue(e.target.value)} className="cad-input"
                           aria-label={`Ángulo de rotación de lotes para Mzo. ${row.code}, en grados`}
                        />
                        <button onClick={() => onManualAngleApply(row, parseFloat(manualAngleValue))} className="cad-icon-btn" style={{ height: 'auto', fontSize: '0.6rem', padding: '0 8px' }}>
                          Aplicar
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {row.lots.length > 0 && (
                <button onClick={handleLabelLots} className="cad-icon-btn" style={{ width: '100%', height: 24, marginTop: 6, fontSize: '0.62rem' }}>
                  🏷 Etiquetar lotes de este manzano
                </button>
              )}

              {geomChanged && (
                <button onClick={() => onRunRecompute(row)} className="cad-icon-btn" style={{ width: '100%', height: 24, marginTop: 6, fontSize: '0.62rem', borderColor: 'var(--cad-accent-amber)', color: 'var(--cad-accent-amber)' }}>
                  ↺ Regenerar (el manzano cambió)
                </button>
              )}

              {row.lots.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div onClick={() => setLotsOpen((v) => !v)} style={{ display: 'flex', justifyContent: 'space-between', cursor: 'pointer', fontSize: '0.63rem', color: 'var(--cad-text-dim)' }}>
                    <span>{normalLots} lotes · {remLots} remanentes</span>
                    <span style={{ transform: lotsOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>▶</span>
                  </div>
                  {lotsOpen && (
                    <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: 4 }}>
                      {row.lots.map((l, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', padding: '2px 4px', color: l.isRemnant ? 'var(--cad-accent-amber)' : 'var(--cad-text-dim)' }}>
                          <span>{l.label}</span>
                          <span>{formatMetricArea(l.areaM2)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
        </div>
      )}
    </div>
  );
}