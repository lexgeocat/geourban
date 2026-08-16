import { useEffect, useRef, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { useLeftSidebarStore, LEFT_SIDEBAR_LIMITS, type LeftSidebarTab } from '../../store/leftSidebarStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { IconLots, IconStreet, IconRoundabout } from '../../layout/topbar/icons';
import ManzanoPanel from '@manzanos-engine/ui/ManzanoPanel';
import StreetPanel from '@vias-engine/ui/StreetPanel';
import RoundaboutPanel from '@vias-engine/ui/RoundaboutPanel';

const TABS: { id: LeftSidebarTab; label: string }[] = [
  { id: 'manzanos', label: 'Manzanos' },
  { id: 'vias', label: 'Vías' },
  { id: 'rotondas', label: 'Rotondas' },
];

export default function LeftSidebar() {
  const activeTab = useLeftSidebarStore((s) => s.activeTab);
  const toggleTab = useLeftSidebarStore((s) => s.toggleTab);
  const panelWidth = useLeftSidebarStore((s) => s.panelWidth);
  const setPanelWidth = useLeftSidebarStore((s) => s.setPanelWidth);
  const streetCount = useStreetStore((s) => s.streets.length);
  const roundaboutCount = useRoundaboutStore((s) => s.roundabouts.length);

  const badgeFor = (id: LeftSidebarTab): number | undefined => {
    if (id === 'vias') return streetCount || undefined;
    if (id === 'rotondas') return roundaboutCount || undefined;
    return undefined;
  };

  const activeTabDef = TABS.find((t) => t.id === activeTab);

  /* Resize handle: arrastra el borde derecho del panel */
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const railRef = useRef<HTMLElement>(null);

  /* El ancho del rail se ajusta al texto rotado más ancho: medimos el rail
     real y sincronizamos --cad-leftbar-rail-width (usado por el panel) */
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => {
      document.documentElement.style.setProperty('--cad-leftbar-rail-width', `${rail.offsetWidth}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(rail);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const next = drag.startWidth + dx;
      setPanelWidth(next);
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setPanelWidth]);

  const startResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startWidth: panelWidth };
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div className="leftbar-root" style={{ '--cad-leftbar-panel-width': `${panelWidth}px` } as CSSProperties}>
      <nav ref={railRef} className="leftbar-rail" aria-label="Paneles laterales">
        {TABS.map((tab) => {
          const badge = badgeFor(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              className={`leftbar-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => toggleTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              aria-label={tab.label}
              title={tab.label}
            >
              <span className="leftbar-tab-icon" aria-hidden="true">
                {tab.id === 'manzanos' && <IconLots />}
                {tab.id === 'vias' && <IconStreet />}
                {tab.id === 'rotondas' && <IconRoundabout />}
              </span>
              <span className="leftbar-tab-label">{tab.label}</span>
              {badge != null && <span className="leftbar-tab-badge">{badge}</span>}
            </button>
          );
        })}
      </nav>

      {activeTab && activeTabDef && (
        <aside
          className="leftbar-panel cad-panel-glass animate-fade-in"
          aria-label={`Panel ${activeTabDef.label}`}
        >
          <header className="leftbar-panel-header">
            <span className="leftbar-panel-title">
              <span className="leftbar-panel-title-icon" aria-hidden="true">
                {activeTabDef.id === 'manzanos' && <IconLots />}
                {activeTabDef.id === 'vias' && <IconStreet />}
                {activeTabDef.id === 'rotondas' && <IconRoundabout />}
              </span>
              {activeTabDef.label}
            </span>
            <button
              className="cad-panel-header-close"
              onClick={() => toggleTab(activeTab)}
              aria-label={`Cerrar panel de ${activeTabDef.label}`}
              title={`Cerrar panel de ${activeTabDef.label}`}
            >
              ✕
            </button>
          </header>
          <div className="leftbar-panel-body">
            {activeTab === 'manzanos' && <ManzanoPanel />}
            {activeTab === 'vias' && <StreetPanel />}
            {activeTab === 'rotondas' && <RoundaboutPanel />}
          </div>
          <div
            className="leftbar-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Ajustar ancho del panel"
            aria-valuenow={panelWidth}
            aria-valuemin={LEFT_SIDEBAR_LIMITS.min}
            aria-valuemax={LEFT_SIDEBAR_LIMITS.max}
            onMouseDown={startResize}
            title="Arrastrar para ajustar el ancho del panel"
          />
        </aside>
      )}
    </div>
  );
}
