import { useMemo, useEffect, useRef } from 'react';
import { useMapStore } from '@map-core/store/mapStore';
import { useDrawSourceTick } from '@shared-ui/hooks/useDrawSourceTick';
import { useIncrementalRender } from '@shared-ui/hooks/useIncrementalRender';
import { useManzanoActions } from '@lotificacion-engine/hooks/useManzanoActions';
import { MANZANO_FOCUS_EVENT, type ManzanoFocusEventDetail } from '@lotificacion-engine/hooks/useLotsWorkflow';
import { readManzanoRows } from '../selectors/manzanoRows';
import { useSubdivisionPreviewStore } from '@lotificacion-engine/store/subdivisionPreviewStore';
import { formatMetricArea } from '@georef-engine/metrics';
import LotParamsCard from '@lotificacion-engine/ui/LotParamsCard';
import ManzanoCard from '@lotificacion-engine/ui/ManzanoCard';
import ManzanoLabelingCard from '@label-engine/ui/cards/ManzanoLabelingCard';
import LoteLabelingCard from '@label-engine/ui/cards/LoteLabelingCard';

export default function ManzanoPanel() {
  const drawSource = useMapStore((s) => s.drawSource);
  const tick = useDrawSourceTick(drawSource);
  const rows = useMemo(() => readManzanoRows(drawSource),
    // tick refleja cambios internos del drawSource
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawSource, tick]);

  const panelRef = useRef<HTMLDivElement>(null);
  const { visibleCount, sentinelRef } = useIncrementalRender(rows.length, 40, panelRef);
  const actions = useManzanoActions(drawSource);

  useEffect(() => () => { useSubdivisionPreviewStore.getState().clear(); }, []);

  useEffect(() => {
    const onFocus = (e: Event) => {
      const { id } = (e as CustomEvent<ManzanoFocusEventDetail>).detail;
      document
        .querySelector(`[data-manzano-row-id="${CSS.escape(String(id))}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    window.addEventListener(MANZANO_FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(MANZANO_FOCUS_EVENT, onFocus);
  }, []);

  const totalLotes = rows.reduce((a, r) => a + r.lots.length, 0);
  const totalMznArea = rows.reduce((a, r) => a + r.areaM2, 0);

  return (
    <div ref={panelRef} style={{ height: '100%', overflowY: 'auto', fontSize: '0.72rem' }}>
      <LotParamsCard
        lotsBusy={actions.lotsBusy}
        hasRows={rows.length > 0}
        onGenerarTodos={actions.handleGenerarTodos}
        onCancelGenerarTodos={actions.handleCancelGenerarTodos}
      />
      <ManzanoLabelingCard />
      <LoteLabelingCard />

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