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
