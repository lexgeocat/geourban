import React, { useState } from 'react';
import { useLayerStore } from '../store/layerStore';
import { useStreetStore } from '../store/streetStore';

const IconLayerGroup = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

const IconPolygon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
  </svg>
);

const IconLine = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M3 3h18v18H3z" />
    <path d="m9 9 6 6" />
    <path d="m15 9-6 6" />
  </svg>
);

const IconRuler = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
    <path d="M4 19h16" />
    <path d="M6 16V8" />
    <path d="M18 16V8" />
    <path d="M6 12h12" />
  </svg>
);

const IconChevron = ({ open, onClick }: { open: boolean; onClick?: (e: React.MouseEvent) => void }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 11, height: 11, transition: 'transform 150ms ease', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }} onClick={onClick}>
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const IconEye = ({ visible }: { visible: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={visible ? "2" : "1.5"} strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13, opacity: visible ? 1 : 0.4, cursor: 'pointer', transition: 'opacity 150ms ease' }}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconLayers = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 14, height: 14 }}>
    <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </svg>
);

function LayerItem({
  label,
  icon,
  visible,
  onToggle,
  children,
  expanded,
  onToggleExpand,
  level = 0,
}: {
  label: string;
  icon: React.ReactNode;
  visible: boolean;
  onToggle: (v: boolean) => void;
  children?: React.ReactNode;
  expanded?: boolean;
  onToggleExpand?: () => void;
  level?: number;
}) {
  const hasChildren = !!children;

  return (
    <div style={{ paddingLeft: level * 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, cursor: 'pointer' }}>
        {hasChildren && <IconChevron open={expanded ?? false} onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggleExpand?.(); }} />}
        {!hasChildren && <span style={{ width: 11 }} />}
        <span onClick={(e: React.MouseEvent) => { e.stopPropagation(); onToggle(!visible); }} style={{ display: 'flex', alignItems: 'center' }}>
          <IconEye visible={visible} />
        </span>
        <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span>
        <span style={{ fontSize: '0.72rem', color: visible ? 'var(--cad-text)' : 'var(--cad-text-muted)', userSelect: 'none', flex: 1 }}>{label}</span>
      </div>
      {hasChildren && expanded && <div>{children}</div>}
    </div>
  );
}

export default function LayerPanel() {
  const [open, setOpen] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({ work: true });

  const workVisibility = useLayerStore((s) => s.workVisibility);
  const setWorkVisibility = useLayerStore((s) => s.setWorkVisibility);
  const streetVisible = useStreetStore((s) => s.visible);
  const setStreetVisible = useStreetStore((s) => s.setVisible);

  const toggleWorkGroup = () => setExpandedGroups((prev) => ({ ...prev, work: !prev.work }));

  return (
    <div
      style={{
        position: 'absolute',
        top: 'calc(var(--cad-topbar-height) + 12px)',
        right: 12,
        zIndex: 90,
        minWidth: open ? 220 : 'auto',
      }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="cad-icon-btn cad-tooltip"
        data-tooltip="Capas"
        style={{
          marginLeft: 'auto',
          display: 'flex',
          marginBottom: open ? 6 : 0,
          background: open ? 'var(--cad-bg-active)' : 'rgba(26, 34, 54, 0.85)',
          backdropFilter: 'blur(16px)',
          border: '1px solid var(--cad-border)',
          color: open ? 'var(--cad-accent)' : 'var(--cad-text-dim)',
        }}
      >
        <IconLayers />
      </button>

      {/* Panel body */}
      {open && (
        <div className="cad-panel-glass animate-fade-in" style={{ padding: '10px 12px', minWidth: 220 }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
              paddingBottom: 8,
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
              Capas de trabajo
            </span>
          </div>

          {/* Working layers group */}
          <LayerItem
            label="Capas de trabajo"
            icon={<IconLayerGroup />}
            visible={true}
            onToggle={() => {}}
            expanded={expandedGroups.work}
            onToggleExpand={toggleWorkGroup}
            level={0}
          >
            {/* Lotes / Manzanas */}
            <LayerItem
              label="Lotes / Manzanos"
              icon={<IconPolygon />}
              visible={workVisibility.lots}
              onToggle={(v) => setWorkVisibility('lots', v)}
              level={1}
            />
            {/* Calles / Viales */}
            <LayerItem
              label="Calles / Viales"
              icon={<IconLine />}
              visible={streetVisible}
              onToggle={setStreetVisible}
              level={1}
            />
            {/* Cotas / Mediciones */}
            <LayerItem
              label="Cotas / Mediciones"
              icon={<IconRuler />}
              visible={workVisibility.measurements}
              onToggle={(v) => setWorkVisibility('measurements', v)}
              level={1}
            />
          </LayerItem>

          {/* Legend / Info */}
          <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--cad-border)', fontSize: '0.6rem', color: 'var(--cad-text-muted)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, background: 'rgba(88,166,255,0.4)', border: '1px solid #58a6ff', borderRadius: 2 }} />
              <span>Manzanos</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{ width: 10, height: 10, background: 'rgba(255,166,87,0.2)', border: '1px solid #ffa657', borderRadius: 2 }} />
              <span>Calles</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <IconRuler />
              <span>Cotas</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}