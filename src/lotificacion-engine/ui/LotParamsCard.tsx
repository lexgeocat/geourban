import { useManzanoStore } from '../store/manzanoLotConfigStore';
import { useGenerateLotsProgressStore } from '../store/generateLotsProgressStore';

export interface LotParamsCardProps {
  lotsBusy: boolean;
  hasRows: boolean;
  onGenerarTodos: () => void;
  onCancelGenerarTodos: () => void;
}

export default function LotParamsCard({ lotsBusy, hasRows, onGenerarTodos, onCancelGenerarTodos }: LotParamsCardProps) {
  const targetAreaM2 = useManzanoStore((s) => s.targetAreaM2);
  const setTargetAreaM2 = useManzanoStore((s) => s.setTargetAreaM2);
  const frontMinM = useManzanoStore((s) => s.frontMinM);
  const setFrontMinM = useManzanoStore((s) => s.setFrontMinM);
  const genProgress = useGenerateLotsProgressStore();

  return (
    <div style={{ background: 'var(--cad-bg-surface)', borderRadius: 6, padding: 8, marginBottom: 8 }}>
      <div style={{ fontSize: '0.62rem', color: 'var(--cad-accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
        ◼ PARÁMETROS DE LOTES
      </div>
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)' }}>Área objetivo (m²)</label>
      <input type="number" value={targetAreaM2} onChange={(e) => setTargetAreaM2(parseFloat(e.target.value) || 0)} className="cad-input" />
      <label style={{ display: 'block', fontSize: '0.65rem', color: 'var(--cad-text-dim)', marginTop: 6 }}>Frente mínimo (m)</label>
      <input type="number" value={frontMinM} onChange={(e) => setFrontMinM(parseFloat(e.target.value) || 0)} className="cad-input" />
      <button
        onClick={onGenerarTodos}
        disabled={lotsBusy || !hasRows}
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
              onClick={onCancelGenerarTodos}
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
  );
}