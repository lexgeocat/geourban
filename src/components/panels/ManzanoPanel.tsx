import React, { useMemo, useEffect, useRef } from 'react';
import { useMapStore } from '../../store/map/mapStore';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { useDrawStore } from '../../store/map/drawStore';
import { useIncrementalRender } from '../../hooks/useIncrementalRender';
import { useDrawSourceTick } from '../../hooks/useDrawSourceTick';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useManzanoActions } from '../../hooks/useManzanoActions';
import { readManzanoRows } from '../../geo/selectors/manzanoRows';
import { useSubdivisionPreviewStore } from '../../store/ui/subdivisionPreviewStore';
import { formatMetricArea } from '../../geo/metrics';
import StreetParamsCard from './manzano/StreetParamsCard';
import RoundaboutParamsCard from './manzano/RoundaboutParamsCard';
import LotParamsCard from './manzano/LotParamsCard';
import ManzanoCard from './manzano/ManzanoCard';

export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);
  const rows = useMemo(() => readManzanoRows(drawSource), [drawSource, tick]);

  const panelVisible = useManzanoStore((s) => s.panelVisible);
  const setPanelVisible = useManzanoStore((s) => s.setPanelVisible);

  const drawMode = useDrawStore((s) => s.mode);
  const viewportWidth = useViewportWidth();
  const panelWidth = Math.min(280, viewportWidth - 20);

  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(rows.length, 40, panelRef);

  const actions = useManzanoActions(drawSource);

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
      style={{ position: 'fixed', top: 90, left: 10, width: panelWidth, maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', zIndex: 900, padding: '10px 10px', fontSize: '0.72rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderBottom: '1px solid var(--cad-border)', paddingBottom: 6 }}>
        <span style={{ fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.03em' }}>
          Manzanos {rows.length > 0 && <span style={{ color: 'var(--cad-text-muted)', fontWeight: 400 }}>({rows.length})</span>}
        </span>
        <button onClick={() => setPanelVisible(false)} style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }} title="Cerrar">✕</button>
      </div>

      {drawMode === 'street' && <StreetParamsCard />}
      {drawMode === 'roundabout' && <RoundaboutParamsCard />}

      <LotParamsCard
        lotsBusy={actions.lotsBusy}
        hasRows={rows.length > 0}
        onGenerarTodos={actions.handleGenerarTodos}
        onCancelGenerarTodos={actions.handleCancelGenerarTodos}
      />

      {rows.length === 0 ? (
        <p style={{ fontSize: '0.68rem', color: 'var(--cad-text-muted)' }}>
          Todavía no hay manzanos. Trazá vías que crucen la parcela para generarlos.
        </p>
      ) : (
        <>
          {rows.slice(0, visibleCount).map((row) => (
            <ManzanoCard
              key={String(row.id)}
              row={row}
              isRecomputing={actions.recomputingIds.has(String(row.id))}
              onMethodClick={actions.handleMethodClick}
              onPreviewLots={actions.handlePreviewLots}
              onToggleEquip={actions.handleToggleEquip}
              onStartRotate={actions.handleStartRotate}
              onResetRotate={actions.handleResetRotate}
              onManualAngleApply={actions.handleManualAngleApply}
              onRunRecompute={actions.runRecompute}
            />
          ))}

          {rows.length > visibleCount && <div ref={sentinelRef} style={{ height: 1 }} />}

          <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--cad-border)', fontSize: '0.63rem', color: 'var(--cad-text-muted)' }}>
            Manzanos: {formatMetricArea(totalMznArea)} · {totalLotes} lotes en total
          </div>
        </>
      )}
    </div>
  );
}