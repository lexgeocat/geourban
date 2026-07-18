import React, { useEffect, useRef, useState } from 'react';
import {
  useSelectionStore,
  ALL_FEATURE_KINDS,
  type SelectMode,
} from '../store/selectionStore';
import type { GeoUrbanFeatureKind } from '../core/objectModel';

/* ─── SVG icons ─── */

const IconFilter = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  </svg>
);

const IconPointer = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
  </svg>
);

const IconRect = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <rect x="4" y="6" width="16" height="12" strokeDasharray="3 2" />
  </svg>
);

const IconLasso = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <path d="M4 18 Q12 4 20 18" strokeDasharray="3 2" />
    <circle cx="4" cy="18" r="1.5" fill="currentColor" />
  </svg>
);

const KIND_META: Record<GeoUrbanFeatureKind, { label: string; color: string; hint: string }> = {
  lote:         { label: 'Lotes',          color: '#58a6ff', hint: 'Parcelas resultantes de subdivisión' },
  manzana:      { label: 'Manzanas',       color: '#ffa657', hint: 'Bloques delimitados por calles' },
  calle:        { label: 'Calles / Vías',  color: '#a371f7', hint: 'Ejes de vialidad' },
  equipamiento: { label: 'Equipamiento',   color: '#10b981', hint: 'Plazas, edificios públicos, etc.' },
  area_verde:   { label: 'Áreas verdes',   color: '#22c55e', hint: 'Espacios verdes / parques' },
  linea:        { label: 'Líneas',         color: '#94a3b8', hint: 'Líneas auxiliares / acotaciones' },
  texto:        { label: 'Textos',         color: '#e2e8f0', hint: 'Anotaciones de texto' },
  cota:         { label: 'Cotas',          color: '#f59e0b', hint: 'Acotamientos manuales' },
};

export default function SelectionFilterPanel() {
  const [open, setOpen] = useState(true); // default open cuando está en el DOM
  const ref = useRef<HTMLDivElement>(null);

  const selectMode = useSelectionStore((s) => s.selectMode);
  const setSelectMode = useSelectionStore((s) => s.setSelectMode);
  const kindFilter = useSelectionStore((s) => s.kindFilter);
  const toggleKind = useSelectionStore((s) => s.toggleKind);
  const setAllKinds = useSelectionStore((s) => s.setAllKinds);
  const selectedCount = useSelectionStore((s) => s.selectedIds.size);
  const clearSelection = useSelectionStore((s) => s.clear);
  const isKindEnabled = useSelectionStore((s) => s.isKindEnabled);
  const setFilterPanelVisible = useSelectionStore((s) => s.setFilterPanelVisible);

  useEffect(() => {
    setFilterPanelVisible(open);
  }, [open, setFilterPanelVisible]);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const anyDisabled = ALL_FEATURE_KINDS.some((k) => !kindFilter[k]);

  const modeButton = (mode: SelectMode, icon: React.ReactNode, label: string, shortcut?: string) => {
    const active = selectMode === mode;
    return (
      <button
        key={mode}
        onClick={() => setSelectMode(mode)}
        className="cad-icon-btn"
        title={shortcut ? `${label} (${shortcut})` : label}
        style={{
          flex: 1,
          height: 'auto',
          padding: '6px 4px',
          flexDirection: 'column',
          gap: 2,
          background: active ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
          border: `1px solid ${active ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
          color: active ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
          borderRadius: 4,
          fontSize: '0.6rem',
          fontWeight: 600,
        }}
      >
        {icon}
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: '0.55rem' }}>
          {label}
        </span>
        {shortcut && (
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.5rem', opacity: 0.6 }}>
            {shortcut}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        top: 'calc(var(--cad-topbar-height) + 12px)',
        left: 12,
        zIndex: 90,
        minWidth: open ? 240 : 'auto',
      }}
    >
      {/* Toggle button (always visible) */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="Selección — modo y filtros"
        aria-label="Selección"
        title="Selección"
        style={{
          display: 'flex',
          marginBottom: open ? 6 : 0,
          background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--cad-border)',
          color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
        }}
      >
        <IconFilter />
        {selectedCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              padding: '0 4px',
              borderRadius: 8,
              background: 'var(--cad-accent)',
              color: '#0d1117',
              fontSize: '0.6rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {selectedCount}
          </span>
        )}
      </button>

      {/* Panel body */}
      {open && (
        <div
          className="cad-panel-glass animate-fade-in"
          style={{ padding: '10px 12px', minWidth: 240 }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
              paddingBottom: 6,
              borderBottom: '1px solid var(--cad-border)',
            }}
          >
            <span
              style={{
                fontSize: '0.6rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--cad-text-dim)',
              }}
            >
              Selección
            </span>
            {selectedCount > 0 && (
              <button
                onClick={clearSelection}
                className="cad-icon-btn"
                style={{
                  width: 'auto',
                  height: 'auto',
                  padding: '2px 6px',
                  fontSize: '0.6rem',
                  color: 'var(--cad-accent-red)',
                }}
                title="Limpiar selección (Esc)"
              >
                Limpiar ({selectedCount})
              </button>
            )}
          </div>

          {/* Mode selector */}
          <div style={{ marginBottom: 10 }}>
            <div
              style={{
                fontSize: '0.55rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--cad-text-muted)',
                marginBottom: 4,
              }}
            >
              Modo
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {modeButton('click', <IconPointer />, 'Click', 'V')}
              {modeButton('rect', <IconRect />, 'Rect', 'R')}
              {modeButton('lasso', <IconLasso />, 'Lazo', 'L')}
            </div>
            {selectMode !== 'click' && (
              <div
                style={{
                  fontSize: '0.6rem',
                  color: 'var(--cad-text-muted)',
                  marginTop: 5,
                  fontStyle: 'italic',
                }}
              >
                {selectMode === 'rect'
                  ? 'Drag con el mouse para框 selección rectangular.'
                  : 'Drag con el mouse para dibujar el contorno libre.'}
              </div>
            )}
          </div>

          {/* Kind filters */}
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.55rem',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: 'var(--cad-text-muted)',
                marginBottom: 4,
              }}
            >
              <span>Filtrar por tipo</span>
              {anyDisabled && (
                <button
                  onClick={() => setAllKinds(true)}
                  className="cad-icon-btn"
                  style={{
                    width: 'auto',
                    height: 'auto',
                    padding: '1px 5px',
                    fontSize: '0.55rem',
                    color: 'var(--cad-accent)',
                    textTransform: 'none',
                    letterSpacing: 0,
                  }}
                >
                  Todos
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {ALL_FEATURE_KINDS.map((k) => {
                const meta = KIND_META[k];
                const on = isKindEnabled(k);
                return (
                  <label
                    key={k}
                    title={meta.hint}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 6px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      background: on ? 'transparent' : 'var(--cad-bg-deepest)',
                      opacity: on ? 1 : 0.55,
                      transition: 'all var(--cad-transition)',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cad-bg-hover)')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = on ? 'transparent' : 'var(--cad-bg-deepest)')
                    }
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: meta.color,
                        opacity: on ? 1 : 0.35,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '0.65rem',
                        color: on ? 'var(--cad-text)' : 'var(--cad-text-muted)',
                        flex: 1,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {meta.label}
                    </span>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleKind(k)}
                      className="cad-toggle"
                      style={{ width: 22, height: 12 }}
                    />
                  </label>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
