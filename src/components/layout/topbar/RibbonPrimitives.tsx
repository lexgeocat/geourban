import React from 'react';
import type { DrawMode } from '../../../store/map/drawStore';
import { useRibbonCtx } from './RibbonContext';

type RibbonToolProps = {
  mode?: DrawMode;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  active?: boolean;
  badge?: number;
  tooltip?: string;
  onClick?: () => void;
};

export function RibbonTool({
  mode: tMode,
  icon,
  label,
  shortcut,
  disabled,
  active,
  badge,
  onClick,
  tooltip,
}: RibbonToolProps) {
  const { currentMode, setMode } = useRibbonCtx();
  const isActive = active ?? (tMode ? currentMode === tMode : false);
  const tip = tooltip ?? (shortcut ? `${label} (${shortcut})` : label);
  const handle = () => {
    if (onClick) onClick();
    else if (tMode) setMode(tMode);
  };
  return (
    <button
      onClick={handle}
      disabled={disabled}
      className={`ribbon-tool ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
      data-tooltip={tip}
      aria-label={tip}
      title={tip}
    >
      {icon}
      <span className="ribbon-tool-label">{label}</span>
      {badge != null && badge > 0 && <span className="ribbon-tool-badge">{badge}</span>}
    </button>
  );
}

export function RibbonGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ribbon-group">
      <div className="ribbon-group-items">{children}</div>
      <div className="ribbon-group-label">{label}</div>
    </div>
  );
}

export interface RibbonDropdownOption {
  mode: DrawMode;
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onSelect?: () => void;
}

export function RibbonToolDropdown({
  icon,
  label,
  options,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  options: RibbonDropdownOption[];
  tooltip?: string;
}) {
  const { currentMode, setMode } = useRibbonCtx();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState<{ top: number; left: number } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const isActive = options.some((o) => o.mode === currentMode);
  const tip = tooltip ?? label;

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((v) => !v);
  };

  const handleSelect = (opt: RibbonDropdownOption) => {
    opt.onSelect?.();
    setMode(opt.mode);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={handleToggle}
        className={`ribbon-tool ${isActive ? 'active' : ''}`}
        data-tooltip={tip}
        aria-label={tip}
        aria-haspopup="true"
        aria-expanded={open}
        title={tip}
      >
        {icon}
        <span className="ribbon-tool-label" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {label}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ width: 7, height: 7, flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="cad-panel-glass animate-fade-in"
          role="menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 170, padding: 4, zIndex: 'var(--z-ribbon-dropdown)', display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {options.map((opt) => (
            <button
              key={opt.mode}
              type="button"
              role="menuitem"
              onClick={() => handleSelect(opt)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '7px 10px',
                background: currentMode === opt.mode ? 'var(--cad-bg-active)' : 'transparent',
                border: 'none', borderRadius: 4,
                color: currentMode === opt.mode ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
                fontSize: '0.72rem', fontWeight: 500, textAlign: 'left', cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', width: 14, height: 14 }}>{opt.icon}</span>
              <span style={{ flex: 1 }}>{opt.label}</span>
              {opt.shortcut && <span style={{ fontSize: '0.6rem', color: 'var(--cad-text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{opt.shortcut}</span>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}