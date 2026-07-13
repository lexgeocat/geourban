import React, { useEffect, useRef, useState } from 'react';
import { useSnapSettingsStore } from '../store/snapSettingsStore';
import { useSnapLiveStore } from '../store/snapStateStore';
import { SNAP_COLORS, SNAP_LABELS, SNAP_GROUPS, type SnapType } from '../map/advancedSnap';

const IconSnap = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M15.7 3.7a2.5 2.5 0 0 1 3.5 0l4 4a2.5 2.5 0 0 1 0 3.5l-4 4a2.5 2.5 0 0 1-3.5 0l-4-4a2.5 2.5 0 0 1 0-3.5z" />
    <path d="M8.3 11.3a2.5 2.5 0 0 0 0 3.5l4 4a2.5 2.5 0 0 0 3.5 0l4-4a2.5 2.5 0 0 0 0-3.5l-4-4a2.5 2.5 0 0 0-3.5 0z" />
  </svg>
);

const IconPower = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
    <path d="M12 2v10" />
    <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
  </svg>
);

const SnapIcon = ({ type, color, size = 12 }: { type: SnapType; color: string; size?: number }) => {
  const s = size;
  const props = { fill: 'none', stroke: color, strokeWidth: '1.5', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, style: { width: s, height: s, flexShrink: 0 } as const };
  switch (type) {
    case 'endpoint':
      return <svg viewBox="0 0 12 12" {...props}><rect x="2" y="2" width="8" height="8" /></svg>;
    case 'midpoint':
      return <svg viewBox="0 0 12 12" {...props}><polygon points="6,1.5 9.9,8.3 2.1,8.3" /></svg>;
    case 'intersection':
      return <svg viewBox="0 0 12 12" {...props}><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>;
    case 'apparentIntersection':
      return <svg viewBox="0 0 12 12" {...props}><polygon points="6,1 11,6 6,11 1,6" /></svg>;
    case 'extension':
      return <svg viewBox="0 0 12 12" {...props}><line x1="6" y1="2" x2="6" y2="10" /><line x1="2" y1="6" x2="10" y2="6" /></svg>;
    case 'perpendicular':
      return <svg viewBox="0 0 12 12" {...props}><polygon points="6,1.5 10.3,4.6 8.6,9.6 3.4,9.6 1.7,4.6" /></svg>;
    case 'parallel':
      return <svg viewBox="0 0 12 12" {...props}><polygon points="6,1.5 9.9,3.8 9.9,8.3 6,10.5 2.1,8.3 2.1,3.8" /></svg>;
    case 'nearest':
      return <svg viewBox="0 0 12 12" {...props}><circle cx="6" cy="6" r="4.5" /></svg>;
    default:
      return <svg viewBox="0 0 12 12" {...props}><circle cx="6" cy="6" r="4.5" /></svg>;
  }
};

export default function SnapPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const enabled = useSnapSettingsStore((s) => s.enabled);
  const settings = useSnapSettingsStore((s) => s.settings);
  const toggle = useSnapSettingsStore((s) => s.toggle);
  const setAll = useSnapSettingsStore((s) => s.setAll);
  const toggleEnabled = useSnapSettingsStore((s) => s.toggleEnabled);
  const active = useSnapLiveStore((s) => s.active);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const anyEnabled = enabled && Object.values(settings).some(Boolean);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="OSNAP — tipos de snap (F3 activa/desactiva)"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '2px 6px',
          borderRadius: 4,
          background: open || anyEnabled ? 'var(--cad-bg-active)' : 'transparent',
          border: '1px solid var(--cad-border)',
          color: anyEnabled ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
          fontSize: '0.65rem',
          opacity: enabled ? 1 : 0.45,
        }}
      >
        <IconSnap />
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>OSNAP</span>
        {active && <SnapIcon type={active.type} color={SNAP_COLORS[active.type]} size={10} />}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 10, height: 10 }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="cad-panel-glass animate-fade-in"
          style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, minWidth: 210, padding: 8, borderRadius: 6, zIndex: 200 }}
        >
          <button
            onClick={toggleEnabled}
            className="cad-icon-btn"
            style={{
              width: '100%',
              height: 'auto',
              padding: '6px 8px',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: enabled ? 'var(--cad-bg-active)' : 'var(--cad-bg-surface)',
              border: `1px solid ${enabled ? 'var(--cad-accent)' : 'var(--cad-border)'}`,
              color: enabled ? 'var(--cad-accent)' : 'var(--cad-text-muted)',
              borderRadius: 4,
              fontSize: '0.68rem',
              fontWeight: 600,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconPower /> OSNAP {enabled ? 'activado' : 'desactivado'}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.6rem', opacity: 0.7 }}>F3</span>
          </button>

          <div style={{ opacity: enabled ? 1 : 0.4, pointerEvents: enabled ? 'auto' : 'none' }}>
            {SNAP_GROUPS.map((group) => (
              <div key={group.label} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    padding: '2px 6px 4px',
                    fontSize: '0.55rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--cad-text-muted)',
                  }}
                >
                  {group.label}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {group.types.map((key: SnapType) => (
                    <label
                      key={key}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '4px 6px', borderRadius: 4 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--cad-bg-hover)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <input type="checkbox" checked={settings[key]} onChange={() => toggle(key)} className="cad-toggle" />
                      <SnapIcon type={key} color={SNAP_COLORS[key]} size={11} />
                      <span style={{ fontSize: '0.7rem', color: settings[key] ? 'var(--cad-text)' : 'var(--cad-text-muted)' }}>
                        {SNAP_LABELS[key]}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, marginTop: 4, borderTop: '1px solid var(--cad-border)', paddingTop: 6 }}>
            <button onClick={() => setAll(true)} className="cad-icon-btn" style={{ flex: 1, height: 'auto', padding: '4px 0', fontSize: '0.62rem', color: 'var(--cad-text-dim)' }}>
              Todo
            </button>
            <button onClick={() => setAll(false)} className="cad-icon-btn" style={{ flex: 1, height: 'auto', padding: '4px 0', fontSize: '0.62rem', color: 'var(--cad-text-dim)' }}>
              Ninguno
            </button>
          </div>
        </div>
      )}
    </div>
  );
}