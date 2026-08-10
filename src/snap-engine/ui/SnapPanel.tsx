import { useEffect, useRef, useState } from 'react';
import { Power, Magnet, ChevronDown } from 'lucide-react';
import { useSnapSettingsStore } from '../store/snapSettingsStore';
import { useSnapLiveStore } from '../store/snapLiveStore';
import { SNAP_COLORS, SNAP_LABELS, SNAP_GROUPS, type SnapType } from '../geometry/advancedSnap';
import { SnapIcon as DomainSnapIcon } from '@shared-ui/icons/domainIcons';

const IconSnap = () => <Magnet size={13} />;
const IconPower = () => <Power size={12} />;

const SnapIcon = DomainSnapIcon;

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
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="cad-panel-glass animate-fade-in"
          style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, minWidth: 210, padding: 8, borderRadius: 6, zIndex: 'var(--z-dropdown)' }}
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