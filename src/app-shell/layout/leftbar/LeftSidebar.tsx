import React from 'react';
import { useLeftSidebarStore, type LeftSidebarTab } from '../../store/leftSidebarStore';
import { useStreetStore } from '@vias-engine/store/streetStore';
import { useRoundaboutStore } from '@vias-engine/store/roundaboutStore';
import { IconLots, IconStreet, IconRoundabout } from '../../layout/topbar/icons';
import ManzanoPanel from '@manzanos-engine/ui/ManzanoPanel';
import StreetPanel from '@vias-engine/ui/StreetPanel';
import RoundaboutPanel from '@vias-engine/ui/RoundaboutPanel';

const TABS: { id: LeftSidebarTab; label: string; icon: React.ReactNode }[] = [
  { id: 'manzanos', label: 'Manzanos', icon: <IconLots /> },
  { id: 'vias', label: 'Vías', icon: <IconStreet /> },
  { id: 'rotondas', label: 'Rotondas', icon: <IconRoundabout /> },
];

export default function LeftSidebar() {
  const activeTab = useLeftSidebarStore((s) => s.activeTab);
  const toggleTab = useLeftSidebarStore((s) => s.toggleTab);
  const streetCount = useStreetStore((s) => s.streets.length);
  const roundaboutCount = useRoundaboutStore((s) => s.roundabouts.length);

  const badgeFor = (id: LeftSidebarTab): number | undefined => {
    if (id === 'vias') return streetCount || undefined;
    if (id === 'rotondas') return roundaboutCount || undefined;
    return undefined;
  };

  const activeLabel = TABS.find((t) => t.id === activeTab)?.label;

  return (
    <div className="leftbar-root">
      <div className="leftbar-rail">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`leftbar-tab cad-tooltip ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => toggleTab(tab.id)}
            data-tooltip={tab.label}
            aria-pressed={activeTab === tab.id}
            aria-label={tab.label}
          >
            {tab.icon}
            {badgeFor(tab.id) != null && <span className="leftbar-tab-badge">{badgeFor(tab.id)}</span>}
          </button>
        ))}
      </div>

      {activeTab && (
        <div className="leftbar-panel cad-panel-glass animate-fade-in">
          <div className="leftbar-panel-header">
            <span>{activeLabel}</span>
            <button
              className="cad-panel-header-close"
              onClick={() => toggleTab(activeTab)}
              aria-label={`Cerrar panel de ${activeLabel}`}
            >
              ✕
            </button>
          </div>
          <div className="leftbar-panel-body">
            {activeTab === 'manzanos' && <ManzanoPanel />}
            {activeTab === 'vias' && <StreetPanel />}
            {activeTab === 'rotondas' && <RoundaboutPanel />}
          </div>
        </div>
      )}
    </div>
  );
}