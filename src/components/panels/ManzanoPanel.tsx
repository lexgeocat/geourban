// src/components/panels/ManzanoPanel.tsx
import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useMapStore } from '../../store/map/mapStore';
import { useManzanoStore } from '../../store/entities/manzanoStore';
import { useIncrementalRender } from '../../hooks/useIncrementalRender';
import { useDrawSourceTick } from '../../hooks/useDrawSourceTick';
import { useViewportWidth } from '../../hooks/useViewportWidth';
import { useManzanoActions } from '../../hooks/useManzanoActions';
import { readManzanoRows } from '../../geo/selectors/manzanoRows';
import { useSubdivisionPreviewStore } from '../../store/ui/subdivisionPreviewStore';
import { formatMetricArea } from '../../geo/metrics';
import LotParamsCard from './manzano/LotParamsCard';
import ManzanoCard from './manzano/ManzanoCard';

const DEFAULT_POSITION = { top: 90, left: 10 };

export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);
  const rows = useMemo(() => readManzanoRows(drawSource), [drawSource, tick]);

  const panelVisible = useManzanoStore((s) => s.panelVisible);
  const setPanelVisible = useManzanoStore((s) => s.setPanelVisible);

  const viewportWidth = useViewportWidth();
  const panelWidth = Math.min(280, viewportWidth - 20);

  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(rows.length, 40, panelRef);

  const actions = useManzanoActions(drawSource);

  // ─── Drag & drop (panel movible) ───────────────────────────────
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0, startTop: 0, startLeft: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startTop: position.top,
      startLeft: position.left,
    };
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
    e.stopPropagation();
  }, [position]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragRef.current.isDragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const newTop = dragRef.current.startTop + dy;
    const newLeft = dragRef.current.startLeft + dx;
    // Mantener el panel dentro del viewport
    const maxTop = window.innerHeight - 60;
    const maxLeft = window.innerWidth - 60;
    setPosition({
      top: Math.max(0, Math.min(maxTop, newTop)),
      left: Math.max(0, Math.min(maxLeft, newLeft)),
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.isDragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

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
        top: position.top,
        left: position.left,
        width: panelWidth,
        maxHeight: 'calc(100vh - 140px)',
        overflowY: 'auto',
        zIndex: 900,
        padding: '10px 10px',
        fontSize: '0.72rem',
      }}
    >
      <div
        onMouseDown={handleMouseDown}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
          borderBottom: '1px solid var(--cad-border)',
          paddingBottom: 6,
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <span style={{ fontWeight: 700, color: 'var(--cad-text)', letterSpacing: '0.03em' }}>
          Manzanos y Lotes {rows.length > 0 && <span style={{ color: 'var(--cad-text-muted)', fontWeight: 400 }}>({rows.length})</span>}
        </span>
        <button
          onClick={() => setPanelVisible(false)}
          onMouseDown={(e) => e.stopPropagation()}
          style={{ background: 'none', border: 'none', color: 'var(--cad-text-dim)', cursor: 'pointer', fontSize: '0.85rem' }}
          title="Cerrar"
        >
          ✕
        </button>
      </div>

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