import React, { useState } from 'react';
import { useMapStore } from '../store/mapStore';

export default function TopologyValidator() {
  const validate = useMapStore((s) => s.validateProjectTopology);
  const [result, setResult] = useState<{ valid: boolean; issues: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const r = await validate();
      setResult(r);
    } catch (err) {
      setResult({ valid: false, issues: [err instanceof Error ? err.message : String(err)] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--cad-border)' }}>
      <button
        onClick={run}
        disabled={busy}
        style={{
          width: '100%',
          padding: '6px 10px',
          fontSize: '0.7rem',
          fontWeight: 500,
          background: busy ? 'var(--cad-bg-deepest)' : 'var(--cad-bg-surface)',
          border: '1px solid var(--cad-border)',
          color: busy ? 'var(--cad-text-muted)' : 'var(--cad-text-dim)',
          borderRadius: 4,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Validando...' : 'Validar topología'}
      </button>
      {result && (
        <div
          style={{
            marginTop: 6,
            padding: 6,
            background: 'var(--cad-bg-deepest)',
            border: `1px solid ${
              result.valid ? 'var(--cad-accent-green)' : 'var(--cad-accent-red)'
            }`,
            borderRadius: 4,
            fontSize: '0.65rem',
            color: result.valid ? 'var(--cad-accent-green)' : 'var(--cad-accent-red)',
            maxHeight: 180,
            overflowY: 'auto',
          }}
        >
          {result.valid ? (
            <span>✓ Todas las geometrías son válidas.</span>
          ) : (
            <>
              <strong>✗ {result.issues.length} issue(s):</strong>
              <ul style={{ marginTop: 4, paddingLeft: 16, color: 'var(--cad-text-dim)' }}>
                {result.issues.map((issue, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {issue}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
